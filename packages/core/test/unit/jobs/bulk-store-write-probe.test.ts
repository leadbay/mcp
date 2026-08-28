/**
 * createDefaultBulkStore must PROVE the store is writable, not infer it
 * (leadbay/product#4005).
 *
 * The probe used to be `stat(dirname(path))`. Statting a directory says nothing
 * about being able to write into it, and the gap is not theoretical: a freshly
 * provisioned Kubernetes PVC mounts root-owned, a container running as a
 * non-root uid stats it happily, and the first real launch dies with EACCES
 * inside `writeAll`. Verified against the actual image — a mount owned
 * `root:root 0755` passed the old probe and reported `durability: "file"`,
 * while a plain `writeFile` to the same path returned EACCES.
 *
 * That is the worst possible shape for this bug: the hosted server would boot
 * announcing `bulk_store=file`, and every bulk launch would fail exactly the
 * way product#4005 failed — with the boot line insisting all was well.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultBulkStore } from "../../../src/jobs/bulk-store.js";

let dir: string;
const env = (over: Record<string, string | undefined> = {}) => ({
  LEADBAY_BULK_STORE_PATH: join(dir, "bulks.json"),
  LEADBAY_BULK_STORE_PATH_UNSAFE: "1",
  ...over,
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "leadbay-write-probe-"));
});
afterEach(async () => {
  await chmod(dir, 0o700).catch(() => {});
  await rm(dir, { recursive: true, force: true });
});

describe("createDefaultBulkStore write probe (product#4005)", () => {
  it("a writable directory yields a file-backed store", async () => {
    const store = await createDefaultBulkStore({ env: env() });
    expect(store.durability).toBe("file");
  });

  it("leaves no probe file behind", async () => {
    await createDefaultBulkStore({ env: env() });
    expect(await readdir(dir)).not.toContain(".write-probe");
  });

  it("a read-only directory throws instead of claiming durability", async () => {
    // r-x: statable, listable, NOT writable — the shape a root-owned PVC
    // presents to a non-root container, and the case the old stat() probe
    // waved through.
    await chmod(dir, 0o500);
    await expect(createDefaultBulkStore({ env: env() })).rejects.toThrow(
      /bulk store init failed/
    );
  });

  it("a read-only directory falls back to MEMORY, never to a lying 'file'", async () => {
    await chmod(dir, 0o500);
    const store = await createDefaultBulkStore({
      env: env({ LEADBAY_BULK_STORE_ALLOW_MEMORY: "1" }),
    });
    // The point of the whole probe: durability reports what is actually true,
    // so the hosted boot line cannot announce a durability it does not have.
    expect(store.durability).toBe("memory");
  });
});

describe("write probe hardening (Codex review on leadbay/mcp#187)", () => {
  it("rejects a store path that is a directory, not a file", async () => {
    // A volume restored with the wrong shape, or a stray mkdir. Probing a
    // sibling path would succeed here and let the server announce
    // `bulk_store=file` over a store every readAll() will fail on.
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "bulks.json"));
    await expect(createDefaultBulkStore({ env: env() })).rejects.toThrow(
      /bulk store init failed/
    );
  });

  it("does not truncate an existing file the probe name might collide with", async () => {
    // The probe used to be a fixed `.write-probe` opened with O_TRUNC, so a
    // same-named file — or a symlink pointing anywhere — was destroyed just by
    // starting the server.
    const { writeFile, readFile } = await import("node:fs/promises");
    const bystander = join(dir, ".write-probe");
    await writeFile(bystander, "do not clobber me");

    const store = await createDefaultBulkStore({ env: env() });

    expect(store.durability).toBe("file");
    expect(await readFile(bystander, "utf8")).toBe("do not clobber me");
  });

  it("leaves no probe file behind under the new unique name either", async () => {
    await createDefaultBulkStore({ env: env() });
    expect((await readdir(dir)).filter((f) => f.startsWith(".write-probe"))).toEqual([]);
  });
});

describe("the probe exercises the real commit path", () => {
  // NOT covered by a test: create-allowed-but-rename-denied in isolation. It
  // needs a sticky-bit or ACL directory owned by another uid, which a unit test
  // cannot construct portably, and node:fs/promises is an ESM namespace so
  // rename cannot be spied. The probe does exercise rename (see
  // createDefaultBulkStore); the read-only-directory case above covers the
  // superset where neither create nor rename is permitted.
  it("cleans up both the probe and its tmp", async () => {
    await createDefaultBulkStore({ env: env() });
    expect((await readdir(dir)).filter((f) => f.includes("write-probe"))).toEqual([]);
  });
});
