/**
 * product#4007 — a poll-budget timeout stops being an error.
 *
 * The wizard's phases are bimodal (~7s or ~85s) and the MCP's 60s per-phase
 * budget sat in the gap, so the same input randomly succeeded or threw
 * IMPORT_BUDGET_EXHAUSTED. An error is a thing an agent retries: one user's
 * single instruction produced nine identical re-imports over eleven minutes.
 *
 * The import is still running server-side when the budget runs out, so these
 * lock the degraded contract: `{status:"running", timed_out:true, importIds}`,
 * plus the two things that must NOT change — a real backend error still
 * throws, and the happy path still returns the legacy blocking shape.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import {
  importLeads,
  isImportLeadsRunningResult,
  type ImportLeadsRunningResult,
} from "../../../src/composite/import-leads.js";

const BASE = "https://api-us.leadbay.app";
const IMPORT_ID = "imp-1";

const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

const ME = {
  method: "GET" as const,
  path: "/1.6/users/me",
  status: 200,
  body: { id: "u-1", email: "milstan@leadbay.ai", admin: true },
};

function importRow(over: Record<string, unknown> = {}) {
  return {
    id: IMPORT_ID,
    date: "2026-08-26T12:03:45Z",
    file_name: "mcp-import.csv",
    imported_records: 0,
    pending_imported_records: 1,
    total_records: 1,
    mappings: null,
    pre_processing: { finished: true, error: null, hints: null, samples: [], status_samples: null },
    processing: { progress: 0, finished: true, error: null },
    ...over,
  };
}

const PREPROCESS_STALLED = importRow({
  pre_processing: { finished: false, error: null, hints: null, samples: [], status_samples: null },
  processing: null,
});
const PROCESS_STALLED = importRow({ processing: { progress: 0, finished: false, error: null } });

// A record the wizard is still placing — neither matched nor NO_MATCH.
const TRANSIENT_RECORDS = {
  items: [
    {
      id: 1,
      records: [{ column_name: "MCP_ROW_ID", value: "r1" }],
      match_type: "AUTOMATIC_MATCH",
      status: "MATCHING",
      lead: null,
    },
  ],
  pagination: { page: 0, pages: 1, total: 1 },
};

const RECORDS_RE = new RegExp(`^/1\\.6/imports/${IMPORT_ID}/records\\?`);

const SETTLED_RECORDS = {
  items: [
    {
      id: 1,
      records: [
        { column_name: "MCP_ROW_ID", value: "r1" },
        { column_name: "LEAD_WEBSITE", value: "acme-imports.fr" },
      ],
      match_type: "AUTOMATIC_MATCH",
      status: "IMPORTED",
      lead: { id: "lead-777", name: "Acme Imports", website: "acme-imports.fr" },
    },
  ],
  pagination: { page: 0, pages: 1, total: 1 },
};

// Zero budgets make every deadline expire after exactly one poll, so these
// tests need a single GET per phase and never hit the 2s poll sleep — in the
// detached finisher as well as the main path.
const ZERO_BUDGET = { per_phase_budget_ms: 0, total_budget_ms: 0 };

// What the detached finisher consumes after a preprocess timeout. A preprocess
// timeout parks the import — `update_mappings` is the MCP's own POST, so if we
// walked away without sending it the wizard row would sit inert forever and
// `status:"running"` would be a lie. These scripts let the finisher run to
// completion inside the test so it can be asserted, and so it can't leak into
// the next one.
const RESUME_SCRIPTS = [
  { method: "GET" as const, path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: importRow() },
  { method: "POST" as const, path: `/1.6/imports/${IMPORT_ID}/update_mappings`, status: 200, body: { notification_id: "n-resumed" } },
];

// Let the detached finisher drain before the test ends.
const drain = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => resetHttpMock());

describe("leadbay_import_leads — timeout degrades to a resumable running result", () => {
  it("preprocess never finishes → status:running with the importId, no throw", async () => {
    mockHttp([
      ME,
      { method: "POST", path: /^\/1\.6\/imports\?file_name=/, status: 200, body: PREPROCESS_STALLED },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: PREPROCESS_STALLED },
      ...RESUME_SCRIPTS,
    ]);
    const out = await importLeads.execute(
      newClient(),
      { domains: [{ domain: "acme-imports.fr" }], ...ZERO_BUDGET }
    );
    expect(isImportLeadsRunningResult(out)).toBe(true);
    const running = out as ImportLeadsRunningResult;
    expect(running.timed_out).toBe(true);
    expect(running.importIds).toEqual([IMPORT_ID]);
    expect(running.progress.phase).toBe("preprocess");
    expect(running.progress.records_total).toBe(1);
    // The hosted MCP has no BulkTracker — importIds is the handle, not this.
    expect(running.handle_id).toBeUndefined();

    // …and `running` has to be TRUE. `update_mappings` is the MCP's own POST;
    // without it the wizard row is parked, not working. Live probe on
    // us-staging 2026-09-01: pre_processing.finished true, `processing`
    // absent, total_records 0, /records 400 `in_progress` — forever.
    // The tool returns before this lands, so the caller never waits on it.
    expect(
      getHttpRequests().some((r) => r.path.includes("/update_mappings"))
    ).toBe(false);
    await drain();
    expect(
      getHttpRequests().some((r) => r.path.includes("/update_mappings"))
    ).toBe(true);
  });

  it("process phase never finishes → status:running, phase 'process'", async () => {
    mockHttp([
      ME,
      { method: "POST", path: /^\/1\.6\/imports\?file_name=/, status: 200, body: importRow() },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: importRow() },
      { method: "POST", path: `/1.6/imports/${IMPORT_ID}/update_mappings`, status: 200, body: { notification_id: "n-1" } },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: PROCESS_STALLED },
    ]);
    const out = await importLeads.execute(
      newClient(),
      { domains: [{ domain: "acme-imports.fr" }], ...ZERO_BUDGET }
    );
    const running = out as ImportLeadsRunningResult;
    expect(running.timed_out).toBe(true);
    expect(running.progress.phase).toBe("process");
    // update_mappings already fired, so the notification id is worth keeping.
    expect(running.notification_ids).toEqual(["n-1"]);
  });

  it("records never settle → status:running, phase 'reconcile' (no IMPORT_NOT_TERMINAL)", async () => {
    mockHttp([
      ME,
      { method: "POST", path: /^\/1\.6\/imports\?file_name=/, status: 200, body: importRow() },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: importRow() },
      { method: "POST", path: `/1.6/imports/${IMPORT_ID}/update_mappings`, status: 200, body: { notification_id: null } },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: importRow() },
      { method: "GET", path: new RegExp(`^/1\\.6/imports/${IMPORT_ID}/records\\?`), status: 200, body: TRANSIENT_RECORDS },
    ]);
    const out = await importLeads.execute(
      newClient(),
      { domains: [{ domain: "acme-imports.fr" }], ...ZERO_BUDGET }
    );
    const running = out as ImportLeadsRunningResult;
    expect(running.timed_out).toBe(true);
    expect(running.progress.phase).toBe("reconcile");
  });

  it("multi-chunk: rows in chunks we never uploaded are reported, not dropped", async () => {
    const domains = Array.from({ length: 250 }, (_, i) => ({ domain: `co-${i}.fr` }));
    mockHttp([
      ME,
      { method: "POST", path: /^\/1\.6\/imports\?file_name=/, status: 200, body: PREPROCESS_STALLED },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: PREPROCESS_STALLED },
      ...RESUME_SCRIPTS,
    ]);
    const out = await importLeads.execute(newClient(), { domains, ...ZERO_BUDGET });
    const running = out as ImportLeadsRunningResult;
    expect(running.importIds).toEqual([IMPORT_ID]);
    // Chunk 1 (100 rows) started; chunks 2 and 3 never left the process.
    expect(running.rows_pending_upload).toBe(150);
    expect(running.progress.records_total).toBe(250);
    await drain();
  });

  it("malformed rows survive the timeout — nothing downstream can recover them", async () => {
    // Malformed inputs are rejected client-side and never reach the backend, so
    // `leadbay_import_status` can never reconstruct them. Dropping them here
    // would let the caller read the batch as fully accounted for.
    mockHttp([
      ME,
      { method: "POST", path: /^\/1\.6\/imports\?file_name=/, status: 200, body: PREPROCESS_STALLED },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: PREPROCESS_STALLED },
      ...RESUME_SCRIPTS,
    ]);
    const out = await importLeads.execute(newClient(), {
      domains: [{ domain: "acme-imports.fr" }, { domain: "no-tld" }, { domain: "also bad" }],
      ...ZERO_BUDGET,
    });
    const running = out as ImportLeadsRunningResult;
    expect(running.timed_out).toBe(true);
    expect(running.not_imported).toEqual([
      { domain: "no-tld", reason: "malformed" },
      { domain: "also bad", reason: "malformed" },
    ]);
    await drain();
  });

  it("a timed-out dry run carries `dry_run` so import_status can tell it apart", async () => {
    // A finished dry run and an import parked mid-commit are byte-identical on
    // `GET /imports/{id}` (probed us-staging 2026-09-01), so this bit is the
    // ONLY thing that distinguishes them downstream.
    mockHttp([
      ME,
      { method: "POST", path: /^\/1\.6\/imports\?file_name=/, status: 200, body: PREPROCESS_STALLED },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: PREPROCESS_STALLED },
      // No finisher scripts: a dry run is SUPPOSED to stop after preprocess,
      // so nothing may run on behind it. Committing its mappings would turn a
      // validation pass into a real import.
    ]);
    const out = await importLeads.execute(newClient(), {
      domains: [{ domain: "acme-imports.fr" }],
      dry_run: true,
      ...ZERO_BUDGET,
    });
    const running = out as ImportLeadsRunningResult;
    expect(running.timed_out).toBe(true);
    expect(running.dry_run).toBe(true);
    await drain();
    // A dry run must never commit the mapping, resumed or not.
    expect(
      getHttpRequests().some((r) => r.path.includes("/update_mappings"))
    ).toBe(false);
  });

  it("the finisher does not inherit a short caller budget", async () => {
    // A caller who passed a tiny total_budget_ms is exactly the caller most
    // likely to time out. Handing the finisher that same window would let it
    // fail the one job it exists to do, leaving the import parked — so it
    // carries its own generous budget and keeps polling preprocess.
    mockHttp([
      ME,
      { method: "POST", path: /^\/1\.6\/imports\?file_name=/, status: 200, body: PREPROCESS_STALLED },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: PREPROCESS_STALLED },
      // The finisher's FIRST poll still shows preprocess unfinished — with the
      // caller's 0ms budget it would give up right here.
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: PREPROCESS_STALLED },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: importRow() },
      { method: "POST", path: `/1.6/imports/${IMPORT_ID}/update_mappings`, status: 200, body: { notification_id: "n-late" } },
    ]);
    await importLeads.execute(newClient(), {
      domains: [{ domain: "acme-imports.fr" }],
      ...ZERO_BUDGET,
    });
    // One POLL_INTERVAL_MS (2s) plus slack: the finisher must still be going.
    await new Promise((r) => setTimeout(r, 2_200));
    expect(
      getHttpRequests().some((r) => r.path.includes("/update_mappings"))
    ).toBe(true);
  });

  it("records mode returns row_ids so recovered leads map back to source rows", async () => {
    // MCP_ROW_ID is a UUID minted inside this tool; the caller has never seen
    // it. leadbay_import_status reports recovered leads keyed by it, so a row
    // identified only by CRM_ID — no website to correlate on — would otherwise
    // be untraceable back to the leadId it produced.
    mockHttp([
      ME,
      { method: "POST", path: /^\/1\.6\/imports\?file_name=/, status: 200, body: PREPROCESS_STALLED },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: PREPROCESS_STALLED },
      ...RESUME_SCRIPTS,
    ]);
    const out = await importLeads.execute(newClient(), {
      records: [{ Ref: "CRM-1" }, { Ref: "CRM-2" }],
      mappings: { fields: { Ref: "CRM_ID" } },
      ...ZERO_BUDGET,
    });
    const running = out as ImportLeadsRunningResult;
    expect(running.row_ids).toHaveLength(2);
    expect(new Set(running.row_ids)).toHaveProperty("size", 2);
    await drain();
  });

  it("domains mode omits row_ids — `domain` already correlates", async () => {
    mockHttp([
      ME,
      { method: "POST", path: /^\/1\.6\/imports\?file_name=/, status: 200, body: PREPROCESS_STALLED },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: PREPROCESS_STALLED },
      ...RESUME_SCRIPTS,
    ]);
    const out = await importLeads.execute(newClient(), {
      domains: [{ domain: "acme-imports.fr" }],
      ...ZERO_BUDGET,
    });
    expect((out as ImportLeadsRunningResult).row_ids).toBeUndefined();
    await drain();
  });

  it("a real preprocess ERROR still throws — degradation is timeout-only", async () => {
    const broken = importRow({
      pre_processing: { finished: true, error: "bad encoding", hints: null, samples: [], status_samples: null },
    });
    mockHttp([
      ME,
      { method: "POST", path: /^\/1\.6\/imports\?file_name=/, status: 200, body: broken },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: broken },
    ]);
    await expect(
      importLeads.execute(newClient(), { domains: [{ domain: "acme-imports.fr" }], ...ZERO_BUDGET })
    ).rejects.toMatchObject({ error: true, code: "IMPORT_PREPROCESS_FAILED" });
  });

  it("happy path is untouched — legacy blocking shape, no `status` key", async () => {
    const records = {
      items: [
        {
          id: 1,
          records: [
            { column_name: "MCP_ROW_ID", value: "r1" },
            { column_name: "LEAD_WEBSITE", value: "acme-imports.fr" },
          ],
          match_type: "AUTOMATIC_MATCH",
          status: "IMPORTED",
          lead: { id: "lead-777", name: "Acme Imports", website: "acme-imports.fr" },
        },
      ],
      pagination: { page: 0, pages: 1, total: 1 },
    };
    mockHttp([
      ME,
      { method: "POST", path: /^\/1\.6\/imports\?file_name=/, status: 200, body: importRow() },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: importRow() },
      { method: "POST", path: `/1.6/imports/${IMPORT_ID}/update_mappings`, status: 200, body: { notification_id: null } },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: importRow() },
      { method: "GET", path: new RegExp(`^/1\\.6/imports/${IMPORT_ID}/records\\?`), status: 200, body: records },
      { method: "GET", path: new RegExp(`^/1\\.6/imports/${IMPORT_ID}/records\\?`), status: 200, body: records },
    ]);
    const out: any = await importLeads.execute(newClient(), {
      domains: [{ domain: "acme-imports.fr" }],
    });
    expect(isImportLeadsRunningResult(out)).toBe(false);
    expect(out.status).toBeUndefined();
    expect(out.leads).toEqual([
      { domain: "acme-imports.fr", leadId: "lead-777", name: "Acme Imports" },
    ]);
  });
});
