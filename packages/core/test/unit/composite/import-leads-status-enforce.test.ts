/**
 * Regression: leadbay_import_leads enforces the backend LeadStatus enum on
 * `default_status` / `statuses` values before they reach
 * POST /imports/{id}/update_mappings (product#3745).
 *
 * The backend MappingsPayload decodes `statuses: Map<String, LeadStatus>` and
 * `defaultStatus: LeadStatus?` strictly and case-sensitively (no
 * coerceInputValues). A value like "Won" instead of "WON" 400s at body-parse
 * with an opaque "JSON deserialization error". The MCP owns the canonical set
 * and only ever sends a value the backend can decode.
 *
 * The full-flow mocks mirror the records-mode happy path in import-leads.test.ts
 * (2 matched leads via the LEAD_WEBSITE reconciliation fallback) so the wizard
 * reaches update_mappings; the assertion is on the body it sends.
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
import { importLeads } from "../../../src/composite/import-leads.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

const adminMe = () => ({
  id: "u-1",
  email: "milstan@leadbay.ai",
  admin: true,
  organization: { id: "org-1", name: "Org" },
});

let importIdCounter = 0;
function importPayload(opts: { preFinished?: boolean; procFinished?: boolean }) {
  importIdCounter++;
  return {
    id: `imp-${importIdCounter}`,
    date: "2026-06-16T00:00:00.000Z",
    file_name: "mcp-import.csv",
    imported_records: 0,
    pending_imported_records: 0,
    total_records: 0,
    mappings: null,
    pre_processing: {
      finished: Boolean(opts.preFinished),
      error: null,
      hints: null,
      samples: [],
      status_samples: null,
    },
    processing:
      opts.procFinished !== undefined
        ? { progress: opts.procFinished ? 1 : 0, finished: Boolean(opts.procFinished), error: null }
        : null,
  };
}

// Two terminal (IMPORTED) records so pollRecordsToTerminal settles in one page,
// matching the proven happy-path test's mock shape.
function importedRecordsPage() {
  return {
    items: [
      {
        id: 1,
        records: [
          { column_name: "LEAD_WEBSITE", value: "apple.com" },
          { column_name: "LEAD_NAME", value: "Apple" },
        ],
        match_type: "AUTOMATIC_MATCH",
        status: "IMPORTED",
        lead: { id: "lead-apple", name: "Apple Inc.", website: "apple.com" },
      },
      {
        id: 2,
        records: [
          { column_name: "LEAD_WEBSITE", value: "stripe.com" },
          { column_name: "LEAD_NAME", value: "Stripe" },
        ],
        match_type: "AUTOMATIC_MATCH",
        status: "IMPORTED",
        lead: { id: "lead-stripe", name: "Stripe Inc.", website: "stripe.com" },
      },
    ],
    pagination: { page: 0, pages: 1, total: 2 },
  };
}

function fullFlowMocks() {
  return [
    { method: "GET", path: "/1.5/users/me", status: 200, body: adminMe() },
    {
      method: "POST",
      path: /\/1\.5\/imports\?file_name=/,
      status: 200,
      body: importPayload({ preFinished: true }),
    },
    {
      method: "GET",
      path: /\/1\.5\/imports\/[a-z0-9-]+$/,
      status: 200,
      body: importPayload({ preFinished: true }),
    },
    { method: "POST", path: /\/1\.5\/imports\/[a-z0-9-]+\/update_mappings/, status: 204 },
    {
      method: "GET",
      path: /\/1\.5\/imports\/[a-z0-9-]+$/,
      status: 200,
      body: importPayload({ preFinished: true, procFinished: true }),
    },
    // Two records polls: pollRecordsToTerminal requires STABILIZATION_POLLS
    // consecutive settled snapshots, so it fetches the page twice.
    {
      method: "GET",
      path: /\/1\.5\/imports\/[a-z0-9-]+\/records\?/,
      status: 200,
      body: importedRecordsPage(),
    },
    {
      method: "GET",
      path: /\/1\.5\/imports\/[a-z0-9-]+\/records\?/,
      status: 200,
      body: importedRecordsPage(),
    },
  ] as const;
}

const records = () => [
  { Brand: "Apple", Site: "apple.com" },
  { Brand: "Stripe", Site: "stripe.com" },
];

beforeEach(() => resetHttpMock());

describe("leadbay_import_leads — LeadStatus enforcement (product#3745)", () => {
  it("normalizes default_status + statuses values to the uppercase enum in the update_mappings body", async () => {
    mockHttp([...fullFlowMocks()]);

    await importLeads.execute(newClient(), {
      records: records(),
      mappings: {
        fields: { Brand: "LEAD_NAME", Site: "LEAD_WEBSITE" },
        statuses: { "Gagné": "won" },
        default_status: "Won",
      },
    });

    const mappingReq = getHttpRequests().find((r) => /update_mappings/.test(r.path));
    expect(mappingReq).toBeDefined();
    const body = JSON.parse(mappingReq!.body as string);
    // Case-insensitive normalization; map keys (raw CSV cell text) untouched.
    expect(body.default_status).toBe("WON");
    expect(body.statuses).toEqual({ "Gagné": "WON" });
  });

  it("treats an empty/whitespace default_status as no default (null)", async () => {
    mockHttp([...fullFlowMocks()]);

    await importLeads.execute(newClient(), {
      records: records(),
      mappings: { fields: { Brand: "LEAD_NAME", Site: "LEAD_WEBSITE" }, default_status: "  " },
    });

    const mappingReq = getHttpRequests().find((r) => /update_mappings/.test(r.path));
    const body = JSON.parse(mappingReq!.body as string);
    expect(body.default_status).toBeNull();
  });

  it("rejects an unrecognized status with IMPORT_INVALID_STATUS before any import is created", async () => {
    mockHttp([{ method: "GET", path: "/1.5/users/me", status: 200, body: adminMe() }]);

    await expect(
      importLeads.execute(newClient(), {
        records: records(),
        mappings: { fields: { Brand: "LEAD_NAME", Site: "LEAD_WEBSITE" }, default_status: "Customer" },
      })
    ).rejects.toMatchObject({ error: true, code: "IMPORT_INVALID_STATUS" });

    const reqs = getHttpRequests();
    // Enforcement runs before the wizard: no import row created, no mappings sent.
    expect(reqs.some((r) => /update_mappings/.test(r.path))).toBe(false);
    expect(reqs.some((r) => /\/imports\?file_name=/.test(r.path))).toBe(false);
  });
});
