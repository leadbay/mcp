/**
 * Codex round 9 (mcp#154): the file-backed LocalBulkStore dropped
 * notification_id when reloading an enrich record through validateRecord, so
 * after leadbay_enrich_titles wrote it, the next leadbay_bulk_enrich_status
 * reload saw record.notification_id as absent and always took the legacy
 * per-lead fallback instead of the notification fast path (bulk_progress). This
 * affected production too (the default store is file-backed). Guard: a launched
 * enrich record's notification_id must survive a disk round-trip.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { LocalBulkStore } from "../../../src/jobs/bulk-store.js";

// The store roots paths under $HOME unless allowUnsafePath — put the temp dir
// under HOME so validatePath passes without the unsafe override.
let dir: string;
let storePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(homedir(), ".bulkstore-test-"));
  storePath = join(dir, "bulks.json");
});
afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe("LocalBulkStore (file) — notification_id survives reload", () => {
  it("markLaunched(id, notif) is still present when a fresh store reads the file", async () => {
    const writer = new LocalBulkStore({ backend: "file", path: storePath });
    const { record } = await writer.findOrCreatePending({
      lead_ids: ["lead-a"],
      titles: ["CEO"],
      email: true,
      phone: false,
      lens_id: 7,
      selection_source: "explicit",
    });
    await writer.markLaunched(record.bulk_id, "notif-xyz");

    // Fresh instance on the SAME path → forces a read-back through validateRecord.
    const reader = new LocalBulkStore({ backend: "file", path: storePath });
    const reloaded: any = await reader.get(record.bulk_id);

    expect(reloaded).toBeTruthy();
    expect(reloaded.status).toBe("launched");
    expect(reloaded.notification_id).toBe("notif-xyz");
  });

  it("a record launched with a null notification_id reloads without one (no crash)", async () => {
    const writer = new LocalBulkStore({ backend: "file", path: storePath });
    const { record } = await writer.findOrCreatePending({
      lead_ids: ["lead-b"],
      titles: ["Owner"],
      email: true,
      phone: false,
      lens_id: 7,
      selection_source: "explicit",
    });
    await writer.markLaunched(record.bulk_id, null);

    const reader = new LocalBulkStore({ backend: "file", path: storePath });
    const reloaded: any = await reader.get(record.bulk_id);

    expect(reloaded.status).toBe("launched");
    expect(reloaded.notification_id ?? null).toBeNull();
  });
});
