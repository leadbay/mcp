/**
 * product#4007 — E2E through the real MCP surface, not the composite.
 *
 * The reported incident: a user issued ONE instruction and the
 * agent re-ran `leadbay_import_leads` nine times over eleven minutes, because
 * every timed-out call came back as an error and an error is a thing you
 * retry. The backend was fine — the import was still running server-side each
 * time.
 *
 * So this drives `tools/call` the way a host does, and asserts the two things
 * that actually stop the loop:
 *
 *   1. A poll-budget timeout is NOT an `isError` tool result. It is a
 *      `status:"running"` result carrying the importIds.
 *   2. Handing those importIds straight back to `leadbay_import_status`
 *      returns the leadIds the user came for — so the agent chains onward
 *      instead of re-importing to get them.
 *
 * Composite-level unit coverage lives in packages/core; this file exists
 * because the wiring between the two tools is the fix.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";
const IMPORT_ID = "imp-4007";
// MCP_ROW_ID is randomUUID() output in production, and the reconciler requires
// that shape so a foreign MCP_ROW_ID column can't pose as one.
const ROW_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROW_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function connect() {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(lbClient, { includeWrite: true });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return mcpClient;
}

const ME = {
  method: "GET" as const,
  path: "/1.6/users/me",
  status: 200,
  body: { id: "u1", admin: true, email: "milstan@leadbay.ai" },
};

// The wizard row as the backend reports it while preprocess is still chewing.
const STALLED_IMPORT = {
  id: IMPORT_ID,
  date: "2026-08-26T12:03:45Z",
  file_name: "mcp-import.csv",
  imported_records: 0,
  pending_imported_records: 2,
  total_records: 2,
  mappings: null,
  pre_processing: { finished: false, error: null, hints: null, samples: [], status_samples: null },
  processing: null,
};

// Same row ~85s later — the slow mode the MCP's 60s budget used to sit inside.
const FINISHED_IMPORT = {
  ...STALLED_IMPORT,
  imported_records: 1,
  pending_imported_records: 0,
  pre_processing: { finished: true, error: null, hints: null, samples: [], status_samples: null },
  processing: { progress: 1, finished: true, error: null },
};

const RECORDS_PAGE = {
  items: [
    {
      id: 1,
      records: [
        { column_name: "MCP_ROW_ID", value: ROW_A },
        { column_name: "LEAD_WEBSITE", value: "acme-imports.fr" },
      ],
      match_type: "AUTOMATIC_MATCH",
      status: "IMPORTED",
      lead: { id: "lead-777", name: "Acme Imports", website: "acme-imports.fr" },
    },
    {
      id: 2,
      records: [
        { column_name: "MCP_ROW_ID", value: ROW_B },
        { column_name: "LEAD_WEBSITE", value: "uncrawled-co.fr" },
      ],
      match_type: "NO_MATCH",
      status: "MATCHING",
      lead: null,
    },
  ],
  pagination: { page: 0, pages: 1, total: 2 },
};

beforeEach(() => resetHttpMock());

describe("product#4007 — a slow import returns a handle, not an error", () => {
  it("leadbay_import_leads: poll budget exhausted → status:running, not isError", async () => {
    mockHttp([
      ME,
      {
        method: "POST",
        path: /^\/1\.6\/imports\?file_name=/,
        status: 200,
        body: STALLED_IMPORT,
      },
      // budget 0 ⇒ exactly one poll, then the deadline has already passed.
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: STALLED_IMPORT },
      // …consumed by the detached finisher that commits update_mappings so
      // "still running server-side" is actually true. See the core unit test
      // `import-leads-timeout-degrade` for the assertion on it.
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: FINISHED_IMPORT },
      { method: "POST", path: `/1.6/imports/${IMPORT_ID}/update_mappings`, status: 200, body: { notification_id: null } },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: FINISHED_IMPORT },
      { method: "GET", path: new RegExp(`^/1\\.6/imports/${IMPORT_ID}/records\\?`), status: 200, body: RECORDS_PAGE },
    ]);

    const mcpClient = await connect();
    const res: any = await mcpClient.callTool({
      name: "leadbay_import_leads",
      arguments: {
        domains: [{ domain: "acme-imports.fr" }, { domain: "uncrawled-co.fr" }],
        per_phase_budget_ms: 0,
        total_budget_ms: 0,
        _triggered_by: "1 puis 2 stp",
      },
    });

    // The whole point: the host must not see this as a failed call.
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({
      status: "running",
      timed_out: true,
      importIds: [IMPORT_ID],
      progress: { phase: "preprocess" },
    });
    // Single-chunk input — every row reached the backend.
    expect(res.structuredContent.rows_pending_upload).toBeUndefined();
    // Let the detached finisher drain so it can't bleed into the next test.
    await new Promise((r) => setTimeout(r, 20));
  });

  it("leadbay_import_status(importIds) then returns the leadIds — no re-import", async () => {
    mockHttp([
      ME,
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: FINISHED_IMPORT },
      // The canonical lead-id set. Reconciliation asks for this FIRST and
      // treats anything but a 404 as fatal, so it must be scripted — a silent
      // fallback here would let a short `result` read as the whole answer.
      {
        method: "GET",
        path: `/1.6/imports/${IMPORT_ID}/leads`,
        status: 200,
        body: { lead_ids: ["lead-777"] },
      },
      {
        method: "GET",
        path: new RegExp(`^/1\\.6/imports/${IMPORT_ID}/records\\?`),
        status: 200,
        body: RECORDS_PAGE,
      },
    ]);

    const mcpClient = await connect();
    const res: any = await mcpClient.callTool({
      name: "leadbay_import_status",
      arguments: {
        importIds: [IMPORT_ID],
        _triggered_by: "1 puis 2 stp",
      },
    });

    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.status).toBe("complete");
    // The leadIds the user came for, recovered without re-running the import.
    expect(res.structuredContent.result.leads).toEqual([
      { rowId: ROW_A, domain: "acme-imports.fr", leadId: "lead-777", name: "Acme Imports" },
    ]);
    expect(res.structuredContent.result.not_imported).toEqual([
      { rowId: ROW_B, domain: "uncrawled-co.fr", reason: "uncrawled" },
    ]);
  });
});
