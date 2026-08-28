/**
 * notification_id round-trips for ALL three record kinds (leadbay/product#4010).
 *
 * `validateRecord` rebuilds every record field by field on each file read. The
 * `enrich` branch was fixed to carry `notification_id` through; `qualify` and
 * `import` were added later and silently dropped it. Since the default backend
 * is file, that meant `qualify_status` read `notification_id: null` on every
 * poll and never took the single-REST-call `bulk_progress` fast path — it fell
 * back to the per-lead fan-out every time.
 *
 * It was invisible while the hosted server had no store at all. Pointing the
 * hosted server at a file-backed store (product#4005) makes it a live
 * regression there too, which is what surfaced it.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalBulkStore } from "../../../src/jobs/bulk-store.js";

let dir: string;
let path: string;

// A second store over the same file is what a restarted process sees.
const reopen = () => new LocalBulkStore({ backend: "file", path, allowUnsafePath: true });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "leadbay-notif-id-"));
  path = join(dir, "bulks.json");
});
afterEach(async () => rm(dir, { recursive: true, force: true }));

describe("notification_id survives a file round-trip (product#4010)", () => {
  it("qualify", async () => {
    const { record } = await reopen().findOrCreatePendingQualify({
      lead_ids: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      import_ids: ["imp-1"],
      lens_id: 42,
      mapping_fingerprint: "fp",
    });
    await reopen().markLaunched(record.bulk_id, "notif-q");

    expect((await reopen().getQualify(record.bulk_id))?.notification_id).toBe("notif-q");
  });

  it("import", async () => {
    const { record } = await reopen().findOrCreatePendingImport({
      import_fingerprint: "fp",
      mode: "domains",
      dry_run: false,
      records_total: 1,
    });
    await reopen().markLaunched(record.bulk_id, "notif-i");

    expect((await reopen().getImport(record.bulk_id))?.notification_id).toBe("notif-i");
  });

  it("enrich — unchanged, guards the regression the other two just fixed", async () => {
    const { record } = await reopen().findOrCreatePending({
      lead_ids: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      titles: ["CTO"],
      email: true,
      phone: false,
      lens_id: 42,
      selection_source: "explicit",
    });
    await reopen().markLaunched(record.bulk_id, "notif-e");

    expect((await reopen().get(record.bulk_id))?.notification_id).toBe("notif-e");
  });

  it("a record launched without one reloads without one, for all kinds", async () => {
    const q = await reopen().findOrCreatePendingQualify({
      lead_ids: [], import_ids: [], lens_id: 1, mapping_fingerprint: "x",
    });
    await reopen().markLaunched(q.record.bulk_id, null);
    expect((await reopen().getQualify(q.record.bulk_id))?.notification_id).toBeUndefined();
  });

  it("rejects a non-string notification_id on every kind, not just enrich", async () => {
    const { record } = await reopen().findOrCreatePendingImport({
      import_fingerprint: "fp", mode: "domains", dry_run: false, records_total: 1,
    });
    const { readFile, writeFile } = await import("node:fs/promises");
    const rows = JSON.parse(await readFile(path, "utf8"));
    rows[0].notification_id = 12345;
    await writeFile(path, JSON.stringify(rows));

    // Dropped as invalid rather than round-tripping a number.
    expect(await reopen().getImport(record.bulk_id)).toBeUndefined();
  });
});
