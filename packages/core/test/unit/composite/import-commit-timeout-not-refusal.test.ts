/**
 * product#4007 follow-up — a finisher that runs out of time is not a refusal.
 *
 * When a blocking import times out during preprocess, a detached finisher
 * commits its mappings, and a commit the backend REFUSES is recorded so
 * `leadbay_import_status` can report `failed` instead of polling for ever
 * (see import-commit-failure.test.ts for that half).
 *
 * The finisher can also simply run out of its OWN budget, while preprocess is
 * merely still slow. That is not a refusal — the backend may yet finish — and
 * the registry has no expiry, so recording it would pin a healthy import to
 * `failed` for ever. Worse than the forever-polling the change set out to
 * remove, and the same class of defect: an answer the agent acts on that isn't
 * true.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import {
  importLeads,
  __setResumeCommitBudgetMsForTests,
} from "../../../src/composite/import-leads.js";
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
  __setResumeCommitBudgetMsForTests(null);
});

describe("a finisher that merely runs out of time is not a refusal", () => {
  it("leaves the status at committing, with no error", async () => {
    mockHttp([
      ME,
      { method: "POST", path: /^\/1\.6\/imports\?file_name=/, status: 200, body: STALLED },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: STALLED },
      // Every finisher poll still shows preprocess unfinished.
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: STALLED },
      // Then the status call.
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: row() },
      {
        method: "GET",
        path: `/1.6/imports/${IMPORT_ID}/leads`,
        status: 400,
        body: { error: { code: "bad_request", message: "in_progress" } },
      },
    ]);

    // Squeeze the finisher's own window so it gives up on its first poll. The
    // window is deliberately not caller-controllable — a caller shrinking it is
    // the bug that budget exists to prevent — so this goes through a named
    // module seam rather than a parameter that would leak into the tool schema.
    __setResumeCommitBudgetMsForTests(0);
    await importLeads.execute(newClient(), {
      domains: [{ domain: "acme-imports.fr" }],
      per_phase_budget_ms: 0,
      total_budget_ms: 0,
    });
    await new Promise((r) => setTimeout(r, 30));

    const st: any = await importStatus.execute(newClient(), { importIds: [IMPORT_ID] });
    expect(st.status).toBe("running");
    expect(st.progress.phase).toBe("committing");
    expect(st.error).toBeUndefined();
  });
});
