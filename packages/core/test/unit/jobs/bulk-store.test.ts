/**
 * Tests for LocalBulkStore (BulkTracker implementation).
 *
 * Covers store-layer scenarios from the plan: idempotency key ordering,
 * process restart, corrupt JSON resilience, symlink rejection, path-outside-
 * $HOME rejection, unwritable-path behavior, TTL boundary, UUID validation.
 * Composite-layer scenarios (launch wiring, partial failures) live in
 * bulk-enrich-flow.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, symlink, writeFile, chmod, stat } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve as resolvePath } from "node:path";

import {
  LocalBulkStore,
  InMemoryBulkStore,
  createDefaultBulkStore,
  isValidBulkId,
  type BulkRecord,
} from "../../../src/jobs/bulk-store.js";
import { createLogger } from "../../harness.js";

// ─── helpers ────────────────────────────────────────────────────────────────

async function mkTmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "leadbay-bulk-test-"));
}

const baseArgs = {
  lead_ids: ["l-a", "l-b", "l-c"],
  titles: ["CEO", "CTO"],
  email: true,
  phone: false,
  lens_id: 42,
  selection_source: "explicit" as const,
};

describe("bulk-store — isValidBulkId", () => {
  it("accepts a v4 UUID", () => {
    expect(isValidBulkId("e3b2c4a0-1234-4abc-8def-0123456789ab")).toBe(true);
  });
  it("rejects non-string, empty, and malformed values", () => {
    expect(isValidBulkId(undefined)).toBe(false);
    expect(isValidBulkId("")).toBe(false);
    expect(isValidBulkId("not-a-uuid")).toBe(false);
    expect(isValidBulkId("../../etc/passwd")).toBe(false);
    // v1 UUID (first digit of 3rd group is 1, not 4) — reject.
    expect(isValidBulkId("e3b2c4a0-1234-1abc-8def-0123456789ab")).toBe(false);
  });
});

// Qualify-kind helper inputs (mirror the import-and-qualify composite's
// findOrCreatePendingQualify call site). lead_ids + import_ids + lens_id +
// mapping_fingerprint are the idempotency dimensions.
const qualifyArgs = {
  lead_ids: ["l-a", "l-b"],
  import_ids: ["imp-1"],
  lens_id: 42,
  mapping_fingerprint: "abc123",
  per_lead_budget_ms: 90_000,
  total_budget_ms: 600_000,
};

describe("bulk-store — qualify branch", () => {
  it("findOrCreatePendingQualify mints a record with kind=qualify", async () => {
    const store = new InMemoryBulkStore();
    const { record, reused } = await store.findOrCreatePendingQualify(qualifyArgs);
    expect(reused).toBe(false);
    expect(record.kind).toBe("qualify");
    expect(record.status).toBe("pending");
    expect(record.lead_ids).toEqual(["l-a", "l-b"]); // sorted
    expect(record.import_ids).toEqual(["imp-1"]); // sorted
    expect(record.per_lead_budget_ms).toBe(90_000);
    expect(record.total_budget_ms).toBe(600_000);
    expect(isValidBulkId(record.bulk_id)).toBe(true);
  });

  it("findOrCreatePendingQualify reuses within idempotency window", async () => {
    const store = new InMemoryBulkStore();
    const { record: first } = await store.findOrCreatePendingQualify(qualifyArgs);
    const { record: second, reused } = await store.findOrCreatePendingQualify(qualifyArgs);
    expect(reused).toBe(true);
    expect(second.bulk_id).toBe(first.bulk_id);
  });

  it("getQualify returns the record only when kind=qualify", async () => {
    const store = new InMemoryBulkStore();
    const { record: q } = await store.findOrCreatePendingQualify(qualifyArgs);
    const { record: e } = await store.findOrCreatePending(baseArgs);
    expect((await store.getQualify(q.bulk_id))?.kind).toBe("qualify");
    expect(await store.getQualify(e.bulk_id)).toBeUndefined();
  });

  it("get returns either kind", async () => {
    const store = new InMemoryBulkStore();
    const { record: q } = await store.findOrCreatePendingQualify(qualifyArgs);
    const r = await store.get(q.bulk_id);
    expect(r?.kind).toBe("qualify");
  });

  it("markLaunched works on qualify records too", async () => {
    const store = new InMemoryBulkStore();
    const { record } = await store.findOrCreatePendingQualify(qualifyArgs);
    await store.markLaunched(record.bulk_id);
    const fetched = await store.getQualify(record.bulk_id);
    expect(fetched?.status).toBe("launched");
  });

  it("idempotency keys for enrich vs qualify are distinct", async () => {
    const store = new InMemoryBulkStore();
    const { record: e } = await store.findOrCreatePending({
      lead_ids: ["l-a"],
      titles: [],
      email: false,
      phone: false,
      lens_id: 42,
      selection_source: "explicit",
    });
    const { record: q } = await store.findOrCreatePendingQualify({
      lead_ids: ["l-a"],
      import_ids: [],
      lens_id: 42,
      mapping_fingerprint: "x",
    });
    expect(e.bulk_id).not.toBe(q.bulk_id);
    expect(e.idempotency_key).not.toBe(q.idempotency_key);
  });
});

describe("bulk-store — InMemoryBulkStore happy path", () => {
  it("findOrCreatePending mints a new record first time", async () => {
    const { logger, logs } = createLogger();
    const store = new InMemoryBulkStore({ logger });
    const { record, reused } = await store.findOrCreatePending(baseArgs);
    expect(reused).toBe(false);
    expect(record.status).toBe("pending");
    expect(isValidBulkId(record.bulk_id)).toBe(true);
    expect(record.lead_ids).toEqual(["l-a", "l-b", "l-c"]); // normalized
    expect(record.durability).toBe("memory");
    expect(logs.some((l) => l.msg.startsWith("bulk.registered"))).toBe(true);
  });

  it("markLaunched flips pending → launched", async () => {
    const store = new InMemoryBulkStore();
    const { record } = await store.findOrCreatePending(baseArgs);
    const launched = await store.markLaunched(record.bulk_id);
    expect(launched.status).toBe("launched");
    const fetched = await store.get(record.bulk_id);
    expect(fetched?.status).toBe("launched");
  });

  it("markFailed flips pending → failed", async () => {
    const store = new InMemoryBulkStore();
    const { record } = await store.findOrCreatePending(baseArgs);
    await store.markFailed(record.bulk_id);
    const fetched = await store.get(record.bulk_id);
    expect(fetched?.status).toBe("failed");
  });

  it("list returns records sorted by launched_at desc", async () => {
    let t = 1_000_000_000_000;
    const store = new InMemoryBulkStore({ now: () => t });
    await store.findOrCreatePending(baseArgs);
    t += 1000;
    await store.findOrCreatePending({ ...baseArgs, lead_ids: ["x", "y"] });
    const all = await store.list();
    expect(all.length).toBe(2);
    expect(Date.parse(all[0].launched_at)).toBeGreaterThan(
      Date.parse(all[1].launched_at)
    );
  });
});

describe("bulk-store — idempotency key (reuse guard)", () => {
  it("reuses record within window when fingerprint matches", async () => {
    let t = 1_000_000_000_000;
    const store = new InMemoryBulkStore({ now: () => t });
    const first = await store.findOrCreatePending(baseArgs);
    // Second call 30s later — within default 5min window.
    t += 30_000;
    const second = await store.findOrCreatePending(baseArgs);
    expect(second.reused).toBe(true);
    expect(second.record.bulk_id).toBe(first.record.bulk_id);
    expect(second.seconds_since_original).toBe(30);
  });

  it("does NOT reuse once window passes", async () => {
    let t = 1_000_000_000_000;
    const store = new InMemoryBulkStore({ now: () => t });
    const first = await store.findOrCreatePending(baseArgs);
    t += 6 * 60 * 1000; // 6 minutes > 5 min default window
    const second = await store.findOrCreatePending(baseArgs);
    expect(second.reused).toBe(false);
    expect(second.record.bulk_id).not.toBe(first.record.bulk_id);
  });

  it("does NOT reuse a failed record (re-launch allowed)", async () => {
    const store = new InMemoryBulkStore();
    const first = await store.findOrCreatePending(baseArgs);
    await store.markFailed(first.record.bulk_id);
    const second = await store.findOrCreatePending(baseArgs);
    expect(second.reused).toBe(false);
    expect(second.record.bulk_id).not.toBe(first.record.bulk_id);
  });

  it("reordered lead_ids and titles yield the same idempotency_key → reused", async () => {
    const store = new InMemoryBulkStore();
    const a = await store.findOrCreatePending({
      ...baseArgs,
      lead_ids: ["l-a", "l-b", "l-c"],
      titles: ["CEO", "CTO"],
    });
    const b = await store.findOrCreatePending({
      ...baseArgs,
      lead_ids: ["l-c", "l-b", "l-a"], // reversed
      titles: ["CTO", "CEO"], // reversed
    });
    expect(b.reused).toBe(true);
    expect(b.record.bulk_id).toBe(a.record.bulk_id);
    expect(a.record.idempotency_key).toBe(b.record.idempotency_key);
  });

  it("different email/phone flags yield different idempotency_key → not reused", async () => {
    const store = new InMemoryBulkStore();
    const a = await store.findOrCreatePending({ ...baseArgs, email: true, phone: false });
    const b = await store.findOrCreatePending({ ...baseArgs, email: true, phone: true });
    expect(b.reused).toBe(false);
    expect(a.record.bulk_id).not.toBe(b.record.bulk_id);
  });

  it("different lens_id yields different idempotency_key → not reused", async () => {
    const store = new InMemoryBulkStore();
    const a = await store.findOrCreatePending({ ...baseArgs, lens_id: 1 });
    const b = await store.findOrCreatePending({ ...baseArgs, lens_id: 2 });
    expect(b.reused).toBe(false);
    expect(a.record.bulk_id).not.toBe(b.record.bulk_id);
  });
});

describe("bulk-store — TTL boundary", () => {
  it("keeps records < 30 days old; drops records > 30 days old", async () => {
    let t = 1_000_000_000_000;
    const store = new InMemoryBulkStore({ now: () => t });
    const fresh = await store.findOrCreatePending(baseArgs);
    // Advance clock 29d 23h 59m — still within TTL.
    t += 29 * 24 * 60 * 60 * 1000 + 23 * 60 * 60 * 1000 + 59 * 60 * 1000;
    expect(await store.get(fresh.record.bulk_id)).toBeDefined();
    // Advance further to 30d + 1s — should drop.
    t += 2 * 60 * 1000;
    expect(await store.get(fresh.record.bulk_id)).toBeUndefined();
  });
});

// ─── File-backed tests ──────────────────────────────────────────────────────

describe("bulk-store — FileBulkStore persistence across instances", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkTmp();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("survives restart: write via one instance, read via another", async () => {
    const path = join(dir, "bulks.json");
    const a = new LocalBulkStore({
      backend: "file",
      path,
      allowUnsafePath: true,
    });
    const { record } = await a.findOrCreatePending(baseArgs);
    await a.markLaunched(record.bulk_id);

    // New instance, same path.
    const b = new LocalBulkStore({
      backend: "file",
      path,
      allowUnsafePath: true,
    });
    const fetched = await b.get(record.bulk_id);
    expect(fetched).toBeDefined();
    expect(fetched?.status).toBe("launched");
    expect(fetched?.durability).toBe("file");
  });

  it("file has mode 0600 after write", async () => {
    const path = join(dir, "bulks.json");
    const store = new LocalBulkStore({
      backend: "file",
      path,
      allowUnsafePath: true,
    });
    await store.findOrCreatePending(baseArgs);
    const st = await stat(path);
    // Check user-rw bits only (0600 = rw-------).
    expect(st.mode & 0o777).toBe(0o600);
  });

  it("concurrent register calls serialize via mutex (no lost writes)", async () => {
    const path = join(dir, "bulks.json");
    const store = new LocalBulkStore({
      backend: "file",
      path,
      allowUnsafePath: true,
    });
    // Fire 5 concurrent findOrCreatePending calls with DIFFERENT fingerprints.
    const results = await Promise.all([
      store.findOrCreatePending({ ...baseArgs, lens_id: 1 }),
      store.findOrCreatePending({ ...baseArgs, lens_id: 2 }),
      store.findOrCreatePending({ ...baseArgs, lens_id: 3 }),
      store.findOrCreatePending({ ...baseArgs, lens_id: 4 }),
      store.findOrCreatePending({ ...baseArgs, lens_id: 5 }),
    ]);
    for (const r of results) expect(r.reused).toBe(false);
    // Readback — exactly 5 distinct records.
    const list = await store.list();
    expect(list.length).toBe(5);
    const ids = new Set(list.map((r) => r.bulk_id));
    expect(ids.size).toBe(5);
  });

  it("concurrent identical register calls collapse to one record via reuse guard", async () => {
    const path = join(dir, "bulks.json");
    const store = new LocalBulkStore({
      backend: "file",
      path,
      allowUnsafePath: true,
    });
    // Fire 5 concurrent findOrCreatePending calls with SAME fingerprint.
    const results = await Promise.all([
      store.findOrCreatePending(baseArgs),
      store.findOrCreatePending(baseArgs),
      store.findOrCreatePending(baseArgs),
      store.findOrCreatePending(baseArgs),
      store.findOrCreatePending(baseArgs),
    ]);
    // Exactly one created (reused=false), the rest reused=true.
    const created = results.filter((r) => !r.reused).length;
    const reused = results.filter((r) => r.reused).length;
    expect(created).toBe(1);
    expect(reused).toBe(4);
    // All return the same bulk_id.
    const ids = new Set(results.map((r) => r.record.bulk_id));
    expect(ids.size).toBe(1);
  });

  it("drops a bad record from a corrupted file, keeps the good ones", async () => {
    const path = join(dir, "bulks.json");
    const { logger, logs } = createLogger();
    // Hand-craft a file with one valid record + one malformed entry.
    const valid = {
      bulk_id: "e3b2c4a0-1234-4abc-8def-0123456789ab",
      launched_at: new Date().toISOString(),
      lead_ids: ["l-1"],
      titles: ["CEO"],
      email: true,
      phone: false,
      lens_id: 1,
      selection_source: "explicit",
      status: "launched",
      idempotency_key: "deadbeef",
      durability: "file",
    };
    const bad = { bulk_id: "not-a-uuid", something: "else" };
    await writeFile(path, JSON.stringify([valid, bad]), {
      encoding: "utf8",
      mode: 0o600,
    });
    const store = new LocalBulkStore({
      backend: "file",
      path,
      allowUnsafePath: true,
      logger,
    });
    const all = await store.list();
    expect(all.length).toBe(1);
    expect(all[0].bulk_id).toBe(valid.bulk_id);
    expect(logs.some((l) => l.msg.startsWith("bulk.record_dropped"))).toBe(true);
  });

  it("rejects a symlink at the target path", async () => {
    const target = join(dir, "target.json");
    const link = join(dir, "bulks.json");
    await writeFile(target, "[]", { encoding: "utf8", mode: 0o600 });
    await symlink(target, link);
    const store = new LocalBulkStore({
      backend: "file",
      path: link,
      allowUnsafePath: true,
    });
    await expect(store.findOrCreatePending(baseArgs)).rejects.toThrow(/symlink/);
  });

  it("rejects a path outside $HOME by default (allowUnsafePath=false)", () => {
    // /tmp is outside $HOME on macOS/linux.
    const home = resolvePath(homedir());
    const outside = "/tmp/definitely-outside-home.json";
    // Only run this assertion if $HOME doesn't happen to alias /tmp.
    if (outside.startsWith(home + "/")) return;
    expect(
      () =>
        new LocalBulkStore({
          backend: "file",
          path: outside,
          allowUnsafePath: false,
        })
    ).toThrow(/outside \$HOME/);
  });
});

// ─── Factory tests ─────────────────────────────────────────────────────────

describe("bulk-store — createDefaultBulkStore", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkTmp();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("loud failure: unwritable path + no ALLOW_MEMORY → throws", async () => {
    const unwritable = "/nonexistent-root/oops/bulks.json";
    await expect(
      createDefaultBulkStore({
        env: {
          LEADBAY_BULK_STORE_PATH: unwritable,
          LEADBAY_BULK_STORE_PATH_UNSAFE: "1",
        },
      })
    ).rejects.toThrow(/bulk store init failed/);
  });

  it("loud failure: unwritable path + ALLOW_MEMORY=1 → returns memory store", async () => {
    const { logger, logs } = createLogger();
    const unwritable = "/nonexistent-root/oops/bulks.json";
    const store = await createDefaultBulkStore({
      logger,
      env: {
        LEADBAY_BULK_STORE_PATH: unwritable,
        LEADBAY_BULK_STORE_PATH_UNSAFE: "1",
        LEADBAY_BULK_STORE_ALLOW_MEMORY: "1",
      },
    });
    expect(store.durability).toBe("memory");
    expect(logs.some((l) => l.msg.startsWith("bulk.fallback_memory"))).toBe(true);
  });

  it("writable custom path → returns file store", async () => {
    const path = join(dir, "custom-bulks.json");
    const store = await createDefaultBulkStore({
      env: {
        LEADBAY_BULK_STORE_PATH: path,
        LEADBAY_BULK_STORE_PATH_UNSAFE: "1",
      },
    });
    expect(store.durability).toBe("file");
    expect(store.resolvedPath).toBe(path);
  });
});
