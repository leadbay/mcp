/**
 * product#4007 — a timed-out import surfaces as running, not as a fabricated
 * internal error.
 *
 * leadbay_import_and_qualify drives leadbay_import_leads with
 * wait_for_completion:true, and used to throw IMPORT_ASYNC_UNEXPECTED if the
 * import ever came back with an async shape. Once a poll timeout degrades to
 * `{status:"running"}` (product#4007) that branch would fire on the exact
 * incident we're fixing — turning a recoverable slow import into an error the
 * agent retries. It now returns the running shape this tool already has for
 * wait_for_completion:false.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { importAndQualify } from "../../../src/composite/import-and-qualify.js";
import { InMemoryBulkStore } from "../../../src/jobs/bulk-store.js";

const BASE = "https://api-us.leadbay.app";
const IMPORT_ID = "imp-1";

const STALLED = {
  id: IMPORT_ID,
  date: "2026-08-26T12:03:45Z",
  file_name: "mcp-import.csv",
  imported_records: 0,
  pending_imported_records: 1,
  total_records: 1,
  mappings: null,
  pre_processing: { finished: false, error: null, hints: null, samples: [], status_samples: null },
  processing: null,
};

beforeEach(() => resetHttpMock());

describe("leadbay_import_and_qualify — import timeout passes through as running", () => {
  it("returns {status:'running', import_ids} instead of IMPORT_ASYNC_UNEXPECTED", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/users/me",
        status: 200,
        body: { id: "u-1", email: "milstan@leadbay.ai", admin: true },
      },
      { method: "POST", path: /^\/1\.6\/imports\?file_name=/, status: 200, body: STALLED },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: STALLED },
      // Consumed by the detached finisher that commits update_mappings — a
      // preprocess timeout parks the import until it does.
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: { ...STALLED, pre_processing: { ...STALLED.pre_processing, finished: true } } },
      { method: "POST", path: `/1.6/imports/${IMPORT_ID}/update_mappings`, status: 200, body: { notification_id: null } },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: { ...STALLED, pre_processing: { ...STALLED.pre_processing, finished: true } } },
    ]);

    const out: any = await importAndQualify.execute(
      newClient(),
      {
        domains: [{ domain: "acme-imports.fr" }],
        lensId: 42,
        // 0 ⇒ the deadline expires after exactly one poll.
        per_phase_budget_ms: 0,
        total_budget_ms: 0,
        per_lead_budget_ms: 30_000,
      },
      { bulkTracker: new InMemoryBulkStore() }
    );

    expect(out.kind).toBe("result");
    expect(out.status).toBe("running");
    expect(out.import_ids).toEqual([IMPORT_ID]);
    // Nothing to qualify yet — there are no leadIds until the import lands.
    expect(out.qualify_id).toBeNull();
    expect(out.qualified).toEqual([]);
    // The rendering contract keys off `timed_out`; without it the agent can't
    // tell this from a deliberate async launch and has no cue to poll.
    expect(out.timed_out).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
  });

  it("carries rows_pending_upload and malformed rows through the wrapper", async () => {
    // 250 rows chunk to 3; a timeout on chunk 1 leaves 150 rows unsent. If the
    // wrapper drops that count the caller never learns to resubmit the subset.
    const domains = [
      ...Array.from({ length: 250 }, (_, i) => ({ domain: `co-${i}.fr` })),
      { domain: "no-tld" },
    ];
    mockHttp([
      {
        method: "GET",
        path: "/1.6/users/me",
        status: 200,
        body: { id: "u-1", email: "milstan@leadbay.ai", admin: true },
      },
      { method: "POST", path: /^\/1\.6\/imports\?file_name=/, status: 200, body: STALLED },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: STALLED },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: { ...STALLED, pre_processing: { ...STALLED.pre_processing, finished: true } } },
      { method: "POST", path: `/1.6/imports/${IMPORT_ID}/update_mappings`, status: 200, body: { notification_id: null } },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: { ...STALLED, pre_processing: { ...STALLED.pre_processing, finished: true } } },
    ]);

    const out: any = await importAndQualify.execute(
      newClient(),
      {
        domains,
        lensId: 42,
        per_phase_budget_ms: 0,
        total_budget_ms: 0,
        per_lead_budget_ms: 30_000,
      },
      { bulkTracker: new InMemoryBulkStore() }
    );

    expect(out.status).toBe("running");
    expect(out.timed_out).toBe(true);
    expect(out.rows_pending_upload).toBe(150);
    expect(out.not_imported).toEqual([
      { domain: "no-tld", reason: "malformed" },
    ]);
    await new Promise((r) => setTimeout(r, 20));
  });
});

function newClient() {
  return new LeadbayClient(BASE, "u.tok", "us");
}
