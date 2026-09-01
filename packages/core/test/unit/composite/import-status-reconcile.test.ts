/**
 * product#4007 — leadbay_import_status returns leads on the importIds path.
 *
 * Before this, `importIds[]` returned progress only. So an import that timed
 * out mid-poll could be observed as "complete" and STILL leave the agent with
 * no leadIds — and its only route to them was re-running the whole import,
 * which is the loop we're closing. This path exists specifically because the
 * hosted MCP has no BulkTracker, i.e. `handle_id` is not available to every
 * caller. `importIds` is.
 *
 * The load-bearing subtlety, probed on us-staging 2026-09-01: an import whose
 * mappings were never committed and a FINISHED DRY RUN are byte-identical on
 * `GET /imports/{id}` — `total_records: 0`, `pre_processing.finished: true`,
 * `processing` absent, `mappings` populated by the backend's own AI hints. The
 * row cannot tell them apart. The endpoints can: both `/leads` and `/records`
 * answer `400 in_progress` until the import is genuinely done. So completion is
 * decided by asking, not by reading the row.
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
import { importStatus } from "../../../src/composite/import-status.js";
import { InMemoryBulkStore } from "../../../src/jobs/bulk-store.js";

const BASE = "https://api-us.leadbay.app";
const IMPORT_ID = "imp-1";
const RECORDS_RE = new RegExp(`^/1\\.6/imports/${IMPORT_ID}/records\\?`);
const LEADS_PATH = `/1.6/imports/${IMPORT_ID}/leads`;

const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

// `total_records` is what the wizard says it holds. A snapshot short of it is
// not a final answer — see the deficit test.
function importRow(over: Record<string, unknown> = {}) {
  return {
    id: IMPORT_ID,
    date: "2026-08-26T12:03:45Z",
    file_name: "mcp-import.csv",
    imported_records: 1,
    pending_imported_records: 0,
    total_records: 3,
    mappings: null,
    pre_processing: { finished: true, error: null, hints: null, samples: [], status_samples: null },
    processing: { progress: 1, finished: true, error: null },
    ...over,
  };
}

// What the wizard answers on both endpoints until the mappings are committed.
const IN_PROGRESS = {
  status: 400,
  body: { error: { code: "bad_request", message: "in_progress" } },
};

function cell(col: string, value: string) {
  return { column_name: col, value };
}

beforeEach(() => resetHttpMock());

describe("leadbay_import_status — reconciles leads from importIds alone", () => {
  it("complete import: matched rows become leads, NO_MATCH becomes uncrawled", async () => {
    mockHttp([
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: importRow() },
      { method: "GET", path: LEADS_PATH, status: 200, body: { lead_ids: ["lead-1"] } },
      {
        method: "GET",
        path: RECORDS_RE,
        status: 200,
        body: {
          items: [
            {
              id: 1,
              records: [cell("MCP_ROW_ID", "r1"), cell("LEAD_WEBSITE", "https://Acme-Imports.fr/careers")],
              match_type: "AUTOMATIC_MATCH",
              status: "IMPORTED",
              lead: { id: "lead-1", name: "Acme Imports", website: "acme-imports.fr" },
            },
            {
              id: 2,
              records: [cell("MCP_ROW_ID", "r2"), cell("LEAD_WEBSITE", "acme-corp.fr")],
              match_type: "NO_MATCH",
              status: "MATCHING",
              lead: null,
            },
            {
              id: 3,
              records: [cell("MCP_ROW_ID", "r3"), cell("LEAD_WEBSITE", "gmail.com")],
              match_type: "NO_MATCH",
              status: "MATCHING",
              lead: null,
            },
          ],
          pagination: { page: 0, pages: 1, total: 3 },
        },
      },
    ]);

    const out: any = await importStatus.execute(newClient(), { importIds: [IMPORT_ID] });
    expect(out.status).toBe("complete");
    // URL noise is normalized, so the domain matches what the caller sent.
    expect(out.result.leads).toEqual([
      { rowId: "r1", domain: "acme-imports.fr", leadId: "lead-1", name: "Acme Imports" },
    ]);
    // A public mailbox domain is `no_match` (nothing to crawl); a real company
    // domain is `uncrawled` (Leadbay will get to it) — never both "failed".
    expect(out.result.not_imported).toEqual([
      { rowId: "r2", domain: "acme-corp.fr", reason: "uncrawled" },
      { rowId: "r3", domain: "gmail.com", reason: "no_match" },
    ]);
    expect(out.result.still_settling).toBeUndefined();
  });

  it("uncommitted mappings: /leads says in_progress → running, NOT complete", async () => {
    // The wizard row here is the one that used to read as `complete`:
    // preprocess finished, `processing` never created because update_mappings
    // was never sent. Reporting complete makes the agent stop polling with no
    // leadIds — the exact failure this change exists to prevent.
    mockHttp([
      {
        method: "GET",
        path: `/1.6/imports/${IMPORT_ID}`,
        status: 200,
        body: importRow({ total_records: 0, imported_records: 0, processing: undefined }),
      },
      { method: "GET", path: LEADS_PATH, ...IN_PROGRESS },
    ]);

    const out: any = await importStatus.execute(newClient(), { importIds: [IMPORT_ID] });
    expect(out.status).toBe("running");
    expect(out.progress.phase).toBe("committing");
    expect(out.result).toBeUndefined();
    // No point paginating records for an import that isn't ready.
    expect(getHttpRequests().some((r) => r.path.includes("/records"))).toBe(false);
  });

  it("dry_run:true is taken from the caller — a validation pass is complete, not running", async () => {
    // A finished dry run is indistinguishable from the parked import above, so
    // the caller carries the bit (leadbay_import_leads puts `dry_run` on its
    // timed-out running result). Without it we say "running" rather than risk
    // rendering a validation pass as a real import.
    mockHttp([
      {
        method: "GET",
        path: `/1.6/imports/${IMPORT_ID}`,
        status: 200,
        body: importRow({ total_records: 0, imported_records: 0, processing: undefined }),
      },
    ]);
    const out: any = await importStatus.execute(newClient(), {
      importIds: [IMPORT_ID],
      dry_run: true,
    });
    expect(out.status).toBe("complete");
    expect(out.result).toBeUndefined();
    // Nothing was committed, so there is nothing to reconcile.
    expect(getHttpRequests().some((r) => r.path.includes("/leads"))).toBe(false);
  });

  it("a lead /leads knows about but no record exposed is still reported", async () => {
    // GET /imports/{id}/leads is the canonical set — matched AND newly created.
    // Records only annotate. A lead the wizard created without a visible record
    // row must not silently vanish from downstream qualification.
    mockHttp([
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: importRow({ total_records: 1 }) },
      { method: "GET", path: LEADS_PATH, status: 200, body: { lead_ids: ["lead-1", "lead-created-late"] } },
      {
        method: "GET",
        path: RECORDS_RE,
        status: 200,
        body: {
          items: [
            {
              id: 1,
              records: [cell("MCP_ROW_ID", "r1"), cell("LEAD_WEBSITE", "acme-imports.fr")],
              match_type: "AUTOMATIC_MATCH",
              status: "IMPORTED",
              lead: { id: "lead-1", name: "Acme Imports", website: "acme-imports.fr" },
            },
          ],
          pagination: { page: 0, pages: 1, total: 1 },
        },
      },
    ]);
    const out: any = await importStatus.execute(newClient(), { importIds: [IMPORT_ID] });
    expect(out.result.leads).toEqual([
      { rowId: "r1", domain: "acme-imports.fr", leadId: "lead-1", name: "Acme Imports" },
      { leadId: "lead-created-late", name: null },
    ]);
  });

  it("records-mode: several rows on one lead all survive the canonical merge", async () => {
    // Records mode deliberately lets multiple rows target the same lead —
    // separate contacts on one company. Keying the merge by leadId would
    // collapse them and lose each row's rowId.
    mockHttp([
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: importRow({ total_records: 2 }) },
      { method: "GET", path: LEADS_PATH, status: 200, body: { lead_ids: ["lead-1"] } },
      {
        method: "GET",
        path: RECORDS_RE,
        status: 200,
        body: {
          items: [
            {
              id: 1,
              records: [cell("MCP_ROW_ID", "r1"), cell("LEAD_WEBSITE", "acme-imports.fr")],
              match_type: "AUTOMATIC_MATCH",
              status: "IMPORTED",
              lead: { id: "lead-1", name: "Acme Imports" },
            },
            {
              id: 2,
              records: [cell("MCP_ROW_ID", "r2"), cell("LEAD_WEBSITE", "acme-imports.fr")],
              match_type: "AUTOMATIC_MATCH",
              status: "IMPORTED",
              lead: { id: "lead-1", name: "Acme Imports" },
            },
          ],
          pagination: { page: 0, pages: 1, total: 2 },
        },
      },
    ]);
    const out: any = await importStatus.execute(newClient(), { importIds: [IMPORT_ID] });
    expect(out.result.leads).toEqual([
      { rowId: "r1", domain: "acme-imports.fr", leadId: "lead-1", name: "Acme Imports" },
      { rowId: "r2", domain: "acme-imports.fr", leadId: "lead-1", name: "Acme Imports" },
    ]);
    expect(out.result.still_settling).toBeUndefined();
  });

  it("a canonical id belonging to a non-terminal record does NOT come back in", async () => {
    // /leads reports every lead the import touched, including one whose record
    // is still MATCHING. Adding it as an id-only lead would undo the terminal
    // gate and hand the caller an answer that can still change.
    mockHttp([
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: importRow({ total_records: 1 }) },
      { method: "GET", path: LEADS_PATH, status: 200, body: { lead_ids: ["lead-mid-flight"] } },
      {
        method: "GET",
        path: RECORDS_RE,
        status: 200,
        body: {
          items: [
            {
              id: 1,
              records: [cell("MCP_ROW_ID", "r1")],
              match_type: "AUTOMATIC_MATCH",
              status: "MATCHING",
              lead: { id: "lead-mid-flight", name: "Acme Imports" },
            },
          ],
          pagination: { page: 0, pages: 1, total: 1 },
        },
      },
    ]);
    const out: any = await importStatus.execute(newClient(), { importIds: [IMPORT_ID] });
    expect(out.result.leads).toEqual([]);
    expect(out.result.still_settling).toBe(1);
  });

  it("a re-paged duplicate row does not mask a real shortfall", async () => {
    // The same MCP_ROW_ID can appear twice across a re-page. Measuring the
    // deficit on raw fetched length would count it twice and report the
    // 3-row import as fully seen.
    const row = (n: string) => ({
      id: n,
      records: [cell("MCP_ROW_ID", n)],
      match_type: "AUTOMATIC_MATCH",
      status: "IMPORTED",
      lead: { id: `lead-${n}`, name: "Acme Imports" },
    });
    mockHttp([
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: importRow() },
      { method: "GET", path: LEADS_PATH, status: 200, body: { lead_ids: [] } },
      {
        method: "GET",
        path: RECORDS_RE,
        status: 200,
        body: {
          items: [row("r1"), row("r1"), row("r2")],
          pagination: { page: 0, pages: 1, total: 3 },
        },
      },
    ]);
    const out: any = await importStatus.execute(newClient(), { importIds: [IMPORT_ID] });
    // 2 distinct rows out of a declared 3 → one still settling, not zero.
    expect(out.result.leads).toHaveLength(2);
    expect(out.result.still_settling).toBe(1);
  });

  it("a web-UI import (no MCP_ROW_ID) still dedupes, on the backend record id", async () => {
    // Nothing forces `importIds` to name an MCP-created import. A web-UI one
    // carries no MCP_ROW_ID, so keying the dedupe only on that would let a
    // re-paged row be counted twice while another went missing — and a raw
    // count matching `total_records` would then read as a complete snapshot.
    const row = (id: number, domain: string) => ({
      id,
      records: [cell("Company site", domain)],
      match_type: "MANUAL_MATCH",
      status: "IMPORTED",
      lead: { id: `lead-${id}`, name: "Acme Imports", website: domain },
    });
    mockHttp([
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: importRow() },
      { method: "GET", path: LEADS_PATH, status: 200, body: { lead_ids: [] } },
      {
        method: "GET",
        path: RECORDS_RE,
        status: 200,
        body: {
          items: [row(1, "acme-imports.fr"), row(1, "acme-imports.fr"), row(2, "acme-corp.fr")],
          pagination: { page: 0, pages: 1, total: 3 },
        },
      },
    ]);
    const out: any = await importStatus.execute(newClient(), { importIds: [IMPORT_ID] });
    expect(out.result.leads.map((l: any) => l.leadId)).toEqual(["lead-1", "lead-2"]);
    // 2 distinct rows against a declared 3 — the third is late, not absent.
    expect(out.result.still_settling).toBe(1);
  });

  it("a transient /leads 500 downgrades to status-only, never to a short result", async () => {
    // Only a 404 (backend predates the endpoint) is benign. Anything else
    // means the canonical set is unknown, and a records-only `result` would
    // silently omit whatever /leads would have added.
    mockHttp([
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: importRow({ total_records: 1 }) },
      { method: "GET", path: LEADS_PATH, status: 500, body: { message: "boom" } },
    ]);
    const out: any = await importStatus.execute(newClient(), { importIds: [IMPORT_ID] });
    expect(out.status).toBe("complete");
    expect(out.result).toBeUndefined();
    expect(getHttpRequests().some((r) => r.path.includes("/records"))).toBe(false);
  });

  it("/leads 404 on an older backend falls back to records-only", async () => {
    mockHttp([
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: importRow({ total_records: 1 }) },
      { method: "GET", path: LEADS_PATH, status: 404, body: { message: "not found" } },
      {
        method: "GET",
        path: RECORDS_RE,
        status: 200,
        body: {
          items: [
            {
              id: 1,
              records: [cell("MCP_ROW_ID", "r1"), cell("LEAD_WEBSITE", "acme-imports.fr")],
              match_type: "AUTOMATIC_MATCH",
              status: "IMPORTED",
              lead: { id: "lead-1", name: "Acme Imports", website: "acme-imports.fr" },
            },
          ],
          pagination: { page: 0, pages: 1, total: 1 },
        },
      },
    ]);
    const out: any = await importStatus.execute(newClient(), { importIds: [IMPORT_ID] });
    expect(out.status).toBe("complete");
    expect(out.result.leads).toEqual([
      { rowId: "r1", domain: "acme-imports.fr", leadId: "lead-1", name: "Acme Imports" },
    ]);
  });

  it("a record with a leadId but a non-terminal status stays pending", async () => {
    // `processing.finished` can flip before every row settles, and the wizard
    // may still re-match a row whose `lead.id` is already populated. Reporting
    // it as final would hand the caller an answer that can change.
    mockHttp([
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: importRow({ total_records: 1 }) },
      { method: "GET", path: LEADS_PATH, status: 200, body: { lead_ids: [] } },
      {
        method: "GET",
        path: RECORDS_RE,
        status: 200,
        body: {
          items: [
            {
              id: 1,
              records: [cell("MCP_ROW_ID", "r1")],
              match_type: "AUTOMATIC_MATCH",
              status: "IMPORTING",
              lead: { id: "lead-1", name: "Acme Imports" },
            },
          ],
          pagination: { page: 0, pages: 1, total: 1 },
        },
      },
    ]);
    const out: any = await importStatus.execute(newClient(), { importIds: [IMPORT_ID] });
    expect(out.result.leads).toEqual([]);
    expect(out.result.not_imported).toEqual([]);
    expect(out.result.still_settling).toBe(1);
  });

  it("a snapshot short of total_records reports the shortfall as settling", async () => {
    // The import declares 3 rows; the snapshot exposes 1. The other 2 are not
    // missing, they are late — and must never read as "we saw everything".
    mockHttp([
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: importRow() },
      { method: "GET", path: LEADS_PATH, status: 200, body: { lead_ids: ["lead-1"] } },
      {
        method: "GET",
        path: RECORDS_RE,
        status: 200,
        body: {
          items: [
            {
              id: 1,
              records: [cell("MCP_ROW_ID", "r1")],
              match_type: "AUTOMATIC_MATCH",
              status: "IMPORTED",
              lead: { id: "lead-1", name: "Acme Imports" },
            },
          ],
          pagination: { page: 0, pages: 1, total: 1 },
        },
      },
    ]);
    const out: any = await importStatus.execute(newClient(), { importIds: [IMPORT_ID] });
    expect(out.result.leads).toHaveLength(1);
    expect(out.result.still_settling).toBe(2);
  });

  it("still running → no reconciliation traffic at all", async () => {
    mockHttp([
      {
        method: "GET",
        path: `/1.6/imports/${IMPORT_ID}`,
        status: 200,
        body: importRow({ processing: { progress: 0, finished: false, error: null } }),
      },
    ]);
    const out: any = await importStatus.execute(newClient(), { importIds: [IMPORT_ID] });
    expect(out.status).toBe("running");
    expect(out.result).toBeUndefined();
    expect(
      getHttpRequests().some((r) => r.path.includes("/records") || r.path.endsWith("/leads"))
    ).toBe(false);
  });

  it("an unreadable records page downgrades to status-only, never to an error", async () => {
    mockHttp([
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: importRow() },
      { method: "GET", path: LEADS_PATH, status: 200, body: { lead_ids: ["lead-1"] } },
      { method: "GET", path: RECORDS_RE, status: 500, body: { message: "boom" } },
    ]);
    const out: any = await importStatus.execute(newClient(), { importIds: [IMPORT_ID] });
    expect(out.status).toBe("complete");
    expect(out.result).toBeUndefined();
  });

  it("handle_id with a stored result is unchanged — no reconciliation traffic", async () => {
    const store = new InMemoryBulkStore();
    const reservation = await store.findOrCreatePendingImport({
      import_fingerprint: "fp-1",
      mode: "domains",
      dry_run: false,
      records_total: 1,
    });
    await store.setImportIds(reservation.record.bulk_id, [IMPORT_ID]);
    await store.markImportComplete(reservation.record.bulk_id, {
      leads: [{ domain: "acme-imports.fr", leadId: "stored-lead", name: "Acme Imports" }],
      not_imported: [],
      importIds: [IMPORT_ID],
    });

    mockHttp([]);
    const out: any = await importStatus.execute(
      newClient(),
      { handle_id: reservation.record.bulk_id },
      { bulkTracker: store }
    );
    expect(out.status).toBe("complete");
    expect(out.result.leads).toEqual([
      { domain: "acme-imports.fr", leadId: "stored-lead", name: "Acme Imports" },
    ]);
    expect(getHttpRequests()).toEqual([]);
  });
});
