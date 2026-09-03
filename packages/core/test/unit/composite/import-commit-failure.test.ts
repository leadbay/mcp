/**
 * product#4007 — a rejected mapping commit must not poll forever.
 *
 * When a blocking import times out during preprocess, a detached finisher
 * sends `update_mappings` on its behalf. If the backend REJECTS that commit,
 * the wizard row it leaves behind is byte-identical to one still being
 * committed — `pre_processing.finished` true, `processing` absent,
 * `total_records` 0, and no error field anywhere (probed on us-staging
 * 2026-09-02, where an invalid mapping answers `400 missing LEAD_NAME field`
 * and the row records nothing).
 *
 * Before the timeout became a success result this surfaced as a plain error,
 * so leaving it silent would be a regression introduced by that very change:
 * `leadbay_import_status` would answer `phase:"committing"` for ever and the
 * agent would poll for ever, which is the failure class this whole change
 * exists to remove.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { importLeads } from "../../../src/composite/import-leads.js";
import { importStatus } from "../../../src/composite/import-status.js";
import { clearCommitFailures } from "../../../src/composite/_import-commit-log.js";

const BASE = "https://api-us.leadbay.app";
const IMPORT_ID = "imp-1";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

const ME = {
  method: "GET" as const,
  path: "/1.6/users/me",
  status: 200,
  body: { id: "u-1", email: "milstan@leadbay.ai", admin: true },
};

function row(over: Record<string, unknown> = {}) {
  return {
    id: IMPORT_ID,
    date: "2026-08-26T12:03:45Z",
    file_name: "mcp-import.csv",
    imported_records: 0,
    pending_imported_records: 0,
    total_records: 0,
    mappings: null,
    pre_processing: { finished: true, error: null, hints: null, samples: [], status_samples: null },
    // Exactly what a rejected commit leaves behind: no `processing`, no error.
    processing: undefined,
    ...over,
  };
}
const STALLED = row({
  pre_processing: { finished: false, error: null, hints: null, samples: [], status_samples: null },
});

beforeEach(() => {
  resetHttpMock();
  clearCommitFailures();
});

describe("a mapping commit the backend rejects surfaces as failed, not forever-committing", () => {
  it("records the rejection and reports it through leadbay_import_status", async () => {
    mockHttp([
      ME,
      { method: "POST", path: /^\/1\.6\/imports\?file_name=/, status: 200, body: STALLED },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: STALLED },
      // The finisher: preprocess lands, then the backend refuses the mapping.
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: row() },
      {
        method: "POST",
        path: `/1.6/imports/${IMPORT_ID}/update_mappings`,
        status: 400,
        body: { error: { code: "bad_request", message: "missing LEAD_NAME field" } },
      },
      // The void retry the composite makes on an API_ERROR fails the same way.
      {
        method: "POST",
        path: `/1.6/imports/${IMPORT_ID}/update_mappings`,
        status: 400,
        body: { error: { code: "bad_request", message: "missing LEAD_NAME field" } },
      },
      // The poll that follows.
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: row() },
    ]);

    const out: any = await importLeads.execute(newClient(), {
      domains: [{ domain: "acme-imports.fr" }],
      per_phase_budget_ms: 0,
      total_budget_ms: 0,
    });
    expect(out.status).toBe("running");
    await new Promise((r) => setTimeout(r, 30));

    const st: any = await importStatus.execute(newClient(), { importIds: [IMPORT_ID] });
    expect(st.status).toBe("failed");
    expect(st.error).toContain("missing LEAD_NAME field");
  });

  it("without a recorded failure the same row still reads as committing", async () => {
    // The registry is memory-only and best-effort — a restart loses it, and the
    // caller must then fall back to the pre-existing "still committing"
    // reading rather than to a wrong verdict.
    mockHttp([
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: row() },
      {
        method: "GET",
        path: `/1.6/imports/${IMPORT_ID}/leads`,
        status: 400,
        body: { error: { code: "bad_request", message: "in_progress" } },
      },
    ]);
    const st: any = await importStatus.execute(newClient(), { importIds: [IMPORT_ID] });
    expect(st.status).toBe("running");
    expect(st.progress.phase).toBe("committing");
  });
});
