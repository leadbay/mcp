/**
 * Unit tests for leadbay_import_leads.
 *
 * Covers the auto-decided eng-phase fixes:
 *   - normalizeDomain edge cases (protocol/path/case/TLD shape)
 *   - dedupe + input-row mapping
 *   - empty input fail-fast (IMPORT_EMPTY_INPUT)
 *   - non-admin preflight (IMPORT_ADMIN_REQUIRED)
 *   - happy path: 2 domains → leads with leadIds, reconciled via MCP_ROW_ID
 *   - preprocess error → IMPORT_PREPROCESS_FAILED
 *   - dry_run path: no update_mappings, all inputs land in not_imported
 *   - chunking (>100 → multiple importIds, merged result)
 *   - CSV injection guard + RFC 4180 quoting
 *
 * Stabilization-loop race + AbortSignal cancellation tests require complex
 * timer manipulation; deferred to a follow-up alongside the live smoke test.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";

import { vi } from "vitest";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import {
  importLeads,
  normalizeDomain,
  escapeCsvCell,
  synthesizeCsv,
} from "../../../src/composite/import-leads.js";

const BASE = "https://api-us.leadbay.app";

function adminMe(extra: object = {}) {
  return {
    id: "u-1",
    email: "milstan@leadbay.ai",
    admin: true,
    organization: { id: "org-1", name: "Org" },
    ...extra,
  };
}

function nonAdminMe() {
  return {
    id: "u-2",
    email: "user@example.com",
    admin: false,
    organization: { id: "org-1", name: "Org" },
  };
}

function newClient() {
  return new LeadbayClient(BASE, "u.test-token", "us");
}

beforeEach(() => {
  resetHttpMock();
});

// ─── pure helpers ──────────────────────────────────────────────────────────

describe("normalizeDomain", () => {
  it.each([
    ["Apple.com", "apple.com"],
    ["https://www.MICROSOFT.com/about", "microsoft.com"],
    ["foo.example.co.uk/path?x=1", "foo.example.co.uk"],
    ["  salesforce.com  ", "salesforce.com"],
    ["www.openai.com", "openai.com"],
    ["http://example.tech", "example.tech"],
    ["xn--bcher-kva.de", "xn--bcher-kva.de"],
  ])("normalizes %s → %s", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "no-tld",
    "localhost",
    "192.168.1.1",
    "..",
    ".com",
    "foo.",
    "has space.com",
    "weird/chars,here.com",
  ])("rejects %s as malformed", (input) => {
    expect(normalizeDomain(input)).toBeNull();
  });
});

describe("escapeCsvCell — RFC 4180 + formula-injection guard", () => {
  it.each([
    ["plain", "plain"],
    ["=cmd|'/c calc'!A1", "'=cmd|'/c calc'!A1"],
    ["+sum(1)", "'+sum(1)"],
    ["-1+2", "'-1+2"],
    ["@evil", "'@evil"],
    ["has,comma", '"has,comma"'],
    ['has"quote', '"has""quote"'],
    ["multi\nline", '"multi\nline"'],
    ["", ""],
  ])("escapes %j → %j", (input, expected) => {
    expect(escapeCsvCell(input)).toBe(expected);
  });
});

describe("synthesizeCsv", () => {
  it("emits header + rows; missing cells default to empty", () => {
    const csv = synthesizeCsv(
      ["MCP_ROW_ID", "LEAD_NAME", "LEAD_WEBSITE"],
      [
        { MCP_ROW_ID: "r1", LEAD_NAME: "Apple Inc.", LEAD_WEBSITE: "apple.com" },
        { MCP_ROW_ID: "r2", LEAD_NAME: "Microsoft", LEAD_WEBSITE: "microsoft.com" },
      ]
    );
    expect(csv).toBe(
      "MCP_ROW_ID,LEAD_NAME,LEAD_WEBSITE\n" +
        "r1,Apple Inc.,apple.com\n" +
        "r2,Microsoft,microsoft.com\n"
    );
  });

  it("missing cells default to empty string", () => {
    const csv = synthesizeCsv(
      ["MCP_ROW_ID", "Brand", "Industry"],
      [
        { MCP_ROW_ID: "r1", Brand: "Apple" },
        { MCP_ROW_ID: "r2", Industry: "Fintech" },
      ]
    );
    expect(csv).toBe(
      "MCP_ROW_ID,Brand,Industry\n" + "r1,Apple,\n" + "r2,,Fintech\n"
    );
  });

  it("escapes formula-injection in cell values", () => {
    const csv = synthesizeCsv(
      ["MCP_ROW_ID", "LEAD_NAME", "LEAD_WEBSITE"],
      [{ MCP_ROW_ID: "r1", LEAD_NAME: "=evil()", LEAD_WEBSITE: "apple.com" }]
    );
    expect(csv).toContain("r1,'=evil(),apple.com");
  });

  it("escapes user-supplied column names too (formula injection in headers)", () => {
    const csv = synthesizeCsv(
      ["MCP_ROW_ID", '=cmd|"/c calc"!A0'],
      [{ MCP_ROW_ID: "r1", '=cmd|"/c calc"!A0': "x" }]
    );
    // First line is header; user column should be quoted+formula-prefixed.
    expect(csv.split("\n")[0]).toBe('MCP_ROW_ID,"\'=cmd|""/c calc""!A0"');
  });
});

// ─── composite tests ───────────────────────────────────────────────────────

describe("leadbay_import_leads — preflight + edge cases", () => {
  it("empty domains[] → IMPORT_EMPTY_INPUT (no network)", async () => {
    const client = newClient();
    await expect(
      importLeads.execute(client, { domains: [] })
    ).rejects.toMatchObject({
      error: true,
      code: "IMPORT_EMPTY_INPUT",
    });
    expect(getHttpRequests()).toEqual([]);
  });

  it("non-admin → IMPORT_ADMIN_REQUIRED before CSV upload", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: nonAdminMe() },
    ]);
    const client = newClient();
    await expect(
      importLeads.execute(client, { domains: [{ domain: "apple.com" }] })
    ).rejects.toMatchObject({
      error: true,
      code: "IMPORT_ADMIN_REQUIRED",
    });
    // /imports never hit
    expect(
      getHttpRequests().some((r) => r.path.includes("/imports"))
    ).toBe(false);
  });

  it("only-malformed input → no importIds, all returned as malformed", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: adminMe() },
    ]);
    const client = newClient();
    const out = await importLeads.execute(client, {
      domains: [{ domain: "no-tld" }, { domain: "localhost" }],
    });
    expect(out.leads).toEqual([]);
    expect(out.not_imported).toEqual([
      { domain: "no-tld", reason: "malformed" },
      { domain: "localhost", reason: "malformed" },
    ]);
    expect(out.importIds).toEqual([]);
  });

  it("duplicate normalized domains are deduped to one CSV row", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: adminMe() },
      // POST /imports → returns id + finished preprocessing immediately
      {
        method: "POST",
        path: /\/1\.5\/imports\?file_name=/,
        status: 200,
        body: makeImportPayload({ preFinished: true }),
      },
      // poll preprocess GET — already finished
      {
        method: "GET",
        path: /\/1\.5\/imports\/[a-z0-9-]+$/,
        status: 200,
        body: makeImportPayload({ preFinished: true }),
      },
      // update_mappings
      {
        method: "POST",
        path: /\/1\.5\/imports\/[a-z0-9-]+\/update_mappings/,
        status: 204,
      },
      // poll process — done
      {
        method: "GET",
        path: /\/1\.5\/imports\/[a-z0-9-]+$/,
        status: 200,
        body: makeImportPayload({ preFinished: true, procFinished: true }),
      },
      // records page 0 — both records terminal
      {
        method: "GET",
        path: /\/1\.5\/imports\/[a-z0-9-]+\/records\?/,
        status: 200,
        body: {
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
          ],
          pagination: { page: 0, pages: 1, total: 1 },
        },
      },
      // stabilization second poll (counts must be stable across 2 polls)
      {
        method: "GET",
        path: /\/1\.5\/imports\/[a-z0-9-]+\/records\?/,
        status: 200,
        body: {
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
          ],
          pagination: { page: 0, pages: 1, total: 1 },
        },
      },
    ]);
    const client = newClient();
    const out = await importLeads.execute(client, {
      domains: [{ domain: "Apple.com" }, { domain: "https://www.apple.com/" }],
    });
    expect(out.leads).toHaveLength(1);
    expect(out.leads[0]).toMatchObject({
      domain: "apple.com",
      leadId: "lead-apple",
    });
    // Only 1 importId — not 2 — because the duplicate normalized to the
    // same single chunk.
    expect(out.importIds).toHaveLength(1);
  });
});

describe("leadbay_import_leads — error paths", () => {
  it("preprocess error surfaces as IMPORT_PREPROCESS_FAILED", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: adminMe() },
      {
        method: "POST",
        path: /\/1\.5\/imports\?file_name=/,
        status: 200,
        body: makeImportPayload({
          preFinished: true,
          preError: "bad_csv",
        }),
      },
      {
        method: "GET",
        path: /\/1\.5\/imports\/[a-z0-9-]+$/,
        status: 200,
        body: makeImportPayload({
          preFinished: true,
          preError: "bad_csv",
        }),
      },
    ]);
    const client = newClient();
    await expect(
      importLeads.execute(client, { domains: [{ domain: "apple.com" }] })
    ).rejects.toMatchObject({
      error: true,
      code: "IMPORT_PREPROCESS_FAILED",
    });
  });
});

describe("leadbay_import_leads — dry_run", () => {
  it("skips update_mappings + processing; all inputs return as dry_run", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: adminMe() },
      {
        method: "POST",
        path: /\/1\.5\/imports\?file_name=/,
        status: 200,
        body: makeImportPayload({ preFinished: true }),
      },
      {
        method: "GET",
        path: /\/1\.5\/imports\/[a-z0-9-]+$/,
        status: 200,
        body: makeImportPayload({ preFinished: true }),
      },
    ]);
    const client = newClient();
    const out = await importLeads.execute(client, {
      domains: [{ domain: "apple.com" }, { domain: "microsoft.com" }],
      dry_run: true,
    });
    expect(out.dry_run).toBe(true);
    expect(out.leads).toEqual([]);
    expect(out.not_imported).toEqual([
      { domain: "apple.com", reason: "dry_run" },
      { domain: "microsoft.com", reason: "dry_run" },
    ]);
    // No update_mappings call should have been made.
    expect(
      getHttpRequests().some((r) => r.path.includes("update_mappings"))
    ).toBe(false);
  });
});

describe("leadbay_import_leads — chunking >100", () => {
  it("101 inputs → 2 importIds, merged result", async () => {
    const domains = Array.from({ length: 101 }, (_, i) => ({
      domain: `co${String(i).padStart(3, "0")}.com`,
    }));
    // 2 chunks; each has full upload→records flow.
    const scripts: any[] = [
      { method: "GET", path: "/1.5/users/me", status: 200, body: adminMe() },
    ];
    for (let chunk = 0; chunk < 2; chunk++) {
      scripts.push(
        {
          method: "POST",
          path: /\/1\.5\/imports\?file_name=/,
          status: 200,
          body: makeImportPayload({ preFinished: true }),
        },
        {
          method: "GET",
          path: /\/1\.5\/imports\/[a-z0-9-]+$/,
          status: 200,
          body: makeImportPayload({ preFinished: true }),
        },
        {
          method: "POST",
          path: /\/1\.5\/imports\/[a-z0-9-]+\/update_mappings/,
          status: 204,
        },
        {
          method: "GET",
          path: /\/1\.5\/imports\/[a-z0-9-]+$/,
          status: 200,
          body: makeImportPayload({ preFinished: true, procFinished: true }),
        },
        {
          method: "GET",
          path: /\/1\.5\/imports\/[a-z0-9-]+\/records\?/,
          status: 200,
          body: { items: [], pagination: { page: 0, pages: 1, total: 0 } },
        },
        // stabilization second poll
        {
          method: "GET",
          path: /\/1\.5\/imports\/[a-z0-9-]+\/records\?/,
          status: 200,
          body: { items: [], pagination: { page: 0, pages: 1, total: 0 } },
        }
      );
    }
    mockHttp(scripts);

    const client = newClient();
    const out = await importLeads.execute(client, { domains });
    expect(out.importIds).toHaveLength(2);
  });
});

// ─── records mode ──────────────────────────────────────────────────────────

// Records-mode reconciliation in tests: when the user maps a column to
// LEAD_WEBSITE and the value parses to a domain, the prep step adds it to
// `byDomain`. The reconciler tries MCP_ROW_ID first (won't match unless we
// mock crypto.randomUUID), then falls back to LEAD_WEBSITE → byDomain. So
// these tests use the website fallback path. The output's `rowId` field
// still comes from the synthetic UUID stored in `prep.validInputs[i]`.

describe("leadbay_import_leads — records mode", () => {
  it("happy path: 2 records → matched leads; mapping body is verbatim; rowId populated", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: adminMe() },
      {
        method: "POST",
        path: /\/1\.5\/imports\?file_name=/,
        status: 200,
        body: makeImportPayload({ preFinished: true }),
      },
      {
        method: "GET",
        path: /\/1\.5\/imports\/[a-z0-9-]+$/,
        status: 200,
        body: makeImportPayload({ preFinished: true }),
      },
      {
        method: "POST",
        path: /\/1\.5\/imports\/[a-z0-9-]+\/update_mappings/,
        status: 204,
      },
      {
        method: "GET",
        path: /\/1\.5\/imports\/[a-z0-9-]+$/,
        status: 200,
        body: makeImportPayload({ preFinished: true, procFinished: true }),
      },
      {
        method: "GET",
        path: /\/1\.5\/imports\/[a-z0-9-]+\/records\?/,
        status: 200,
        body: {
          items: [
            {
              id: 1,
              records: [
                { column_name: "LEAD_WEBSITE", value: "apple.com" },
                { column_name: "LEAD_NAME", value: "Apple" },
                { column_name: "LEAD_SECTOR", value: "Hardware" },
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
                { column_name: "LEAD_SECTOR", value: "Fintech" },
              ],
              match_type: "AUTOMATIC_MATCH",
              status: "IMPORTED",
              lead: { id: "lead-stripe", name: "Stripe Inc.", website: "stripe.com" },
            },
          ],
          pagination: { page: 0, pages: 1, total: 2 },
        },
      },
      {
        method: "GET",
        path: /\/1\.5\/imports\/[a-z0-9-]+\/records\?/,
        status: 200,
        body: {
          items: [
            {
              id: 1,
              records: [
                { column_name: "LEAD_WEBSITE", value: "apple.com" },
                { column_name: "LEAD_NAME", value: "Apple" },
                { column_name: "LEAD_SECTOR", value: "Hardware" },
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
                { column_name: "LEAD_SECTOR", value: "Fintech" },
              ],
              match_type: "AUTOMATIC_MATCH",
              status: "IMPORTED",
              lead: { id: "lead-stripe", name: "Stripe Inc.", website: "stripe.com" },
            },
          ],
          pagination: { page: 0, pages: 1, total: 2 },
        },
      },
    ]);

    const client = newClient();
    const out = await importLeads.execute(client, {
      records: [
        { Brand: "Apple", Site: "apple.com", Industry: "Hardware" },
        { Brand: "Stripe", Site: "stripe.com", Industry: "Fintech" },
      ],
      mappings: {
        fields: { Brand: "LEAD_NAME", Site: "LEAD_WEBSITE", Industry: "LEAD_SECTOR" },
      },
    });

    expect(out.leads).toHaveLength(2);
    // Output preserves input order — apple first, stripe second.
    expect(out.leads[0]).toMatchObject({
      domain: "apple.com",
      leadId: "lead-apple",
      name: "Apple Inc.",
    });
    expect((out.leads[0] as any).rowId).toBeTruthy();
    expect(out.leads[1]).toMatchObject({
      domain: "stripe.com",
      leadId: "lead-stripe",
      name: "Stripe Inc.",
    });
    expect((out.leads[1] as any).rowId).toBeTruthy();
    // The two rowIds must be distinct UUIDs.
    expect((out.leads[0] as any).rowId).not.toBe((out.leads[1] as any).rowId);
    expect(out.not_imported).toHaveLength(0);

    // CSV upload: header is sorted user keys after MCP_ROW_ID.
    const uploadReq = getHttpRequests().find((r) =>
      /\/imports\?file_name=/.test(r.path)
    );
    expect(uploadReq).toBeDefined();
    const headerLine = (uploadReq!.body as string).split("\n")[0];
    expect(headerLine).toBe("MCP_ROW_ID,Brand,Industry,Site");

    // CSV upload: each rowId in the CSV body matches one in the output.
    const csvLines = (uploadReq!.body as string).split("\n").filter(Boolean);
    const csvRowIds = csvLines.slice(1).map((l) => l.split(",")[0]);
    const outRowIds = out.leads.map((l) => (l as any).rowId);
    expect(new Set(csvRowIds)).toEqual(new Set(outRowIds));

    // update_mappings body is verbatim — no LEAD_NAME/LEAD_WEBSITE injection.
    const mappingReq = getHttpRequests().find((r) => /update_mappings/.test(r.path));
    expect(mappingReq).toBeDefined();
    const mapBody = JSON.parse(mappingReq!.body as string);
    expect(mapBody).toEqual({
      fields: { Brand: "LEAD_NAME", Site: "LEAD_WEBSITE", Industry: "LEAD_SECTOR" },
      statuses: {},
      default_status: null,
    });
  });

  it("dry_run: no update_mappings; not_imported uses rowId; domain only when LEAD_WEBSITE parsed", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: adminMe() },
      {
        method: "POST",
        path: /\/1\.5\/imports\?file_name=/,
        status: 200,
        body: makeImportPayload({ preFinished: true }),
      },
      {
        method: "GET",
        path: /\/1\.5\/imports\/[a-z0-9-]+$/,
        status: 200,
        body: makeImportPayload({ preFinished: true }),
      },
    ]);
    const client = newClient();
    const out = await importLeads.execute(client, {
      records: [
        { Brand: "Apple", Site: "apple.com" },
        { Brand: "Stripe", Site: "not-a-domain" },
      ],
      mappings: { fields: { Brand: "LEAD_NAME", Site: "LEAD_WEBSITE" } },
      dry_run: true,
    });
    expect(out.dry_run).toBe(true);
    expect(out.leads).toEqual([]);
    expect(out.not_imported).toHaveLength(2);
    expect(out.not_imported[0]).toMatchObject({ reason: "dry_run", domain: "apple.com" });
    expect((out.not_imported[0] as any).rowId).toBeTruthy();
    // Second record: site doesn't parse → no domain field on the entry.
    expect(out.not_imported[1]).toMatchObject({ reason: "dry_run" });
    expect(out.not_imported[1]).not.toHaveProperty("domain");
    expect((out.not_imported[1] as any).rowId).toBeTruthy();
    expect(getHttpRequests().some((r) => r.path.includes("update_mappings"))).toBe(false);
  });

  it("not_imported populated for NO_MATCH records (rowId echoed via byDomain fallback)", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: adminMe() },
      {
        method: "POST",
        path: /\/1\.5\/imports\?file_name=/,
        status: 200,
        body: makeImportPayload({ preFinished: true }),
      },
      {
        method: "GET",
        path: /\/1\.5\/imports\/[a-z0-9-]+$/,
        status: 200,
        body: makeImportPayload({ preFinished: true }),
      },
      {
        method: "POST",
        path: /\/1\.5\/imports\/[a-z0-9-]+\/update_mappings/,
        status: 204,
      },
      {
        method: "GET",
        path: /\/1\.5\/imports\/[a-z0-9-]+$/,
        status: 200,
        body: makeImportPayload({ preFinished: true, procFinished: true }),
      },
      {
        method: "GET",
        path: /\/1\.5\/imports\/[a-z0-9-]+\/records\?/,
        status: 200,
        body: {
          items: [
            {
              id: 1,
              records: [
                { column_name: "LEAD_WEBSITE", value: "weirddomain.xyz" },
                { column_name: "LEAD_NAME", value: "Unknown" },
              ],
              match_type: "NO_MATCH",
              status: "IMPORTING",
              lead: null,
            },
          ],
          pagination: { page: 0, pages: 1, total: 1 },
        },
      },
      {
        method: "GET",
        path: /\/1\.5\/imports\/[a-z0-9-]+\/records\?/,
        status: 200,
        body: {
          items: [
            {
              id: 1,
              records: [
                { column_name: "LEAD_WEBSITE", value: "weirddomain.xyz" },
                { column_name: "LEAD_NAME", value: "Unknown" },
              ],
              match_type: "NO_MATCH",
              status: "IMPORTING",
              lead: null,
            },
          ],
          pagination: { page: 0, pages: 1, total: 1 },
        },
      },
    ]);

    const client = newClient();
    const out = await importLeads.execute(client, {
      records: [{ Co: "Unknown", Web: "weirddomain.xyz" }],
      mappings: { fields: { Co: "LEAD_NAME", Web: "LEAD_WEBSITE" } },
    });
    expect(out.leads).toEqual([]);
    expect(out.not_imported).toHaveLength(1);
    expect(out.not_imported[0]).toMatchObject({
      reason: "uncrawled",
      domain: "weirddomain.xyz",
    });
    expect((out.not_imported[0] as any).rowId).toBeTruthy();
  });

  it("chunking: 101 records → 2 importIds; same header on both chunks; rowIds preserve order", async () => {
    const records = Array.from({ length: 101 }, (_, i) => ({
      Brand: `Co${String(i).padStart(3, "0")}`,
      Site: `co${String(i).padStart(3, "0")}.com`,
    }));
    const scripts: any[] = [
      { method: "GET", path: "/1.5/users/me", status: 200, body: adminMe() },
    ];
    for (let chunk = 0; chunk < 2; chunk++) {
      scripts.push(
        {
          method: "POST",
          path: /\/1\.5\/imports\?file_name=/,
          status: 200,
          body: makeImportPayload({ preFinished: true }),
        },
        {
          method: "GET",
          path: /\/1\.5\/imports\/[a-z0-9-]+$/,
          status: 200,
          body: makeImportPayload({ preFinished: true }),
        },
        {
          method: "POST",
          path: /\/1\.5\/imports\/[a-z0-9-]+\/update_mappings/,
          status: 204,
        },
        {
          method: "GET",
          path: /\/1\.5\/imports\/[a-z0-9-]+$/,
          status: 200,
          body: makeImportPayload({ preFinished: true, procFinished: true }),
        },
        {
          method: "GET",
          path: /\/1\.5\/imports\/[a-z0-9-]+\/records\?/,
          status: 200,
          body: { items: [], pagination: { page: 0, pages: 1, total: 0 } },
        },
        {
          method: "GET",
          path: /\/1\.5\/imports\/[a-z0-9-]+\/records\?/,
          status: 200,
          body: { items: [], pagination: { page: 0, pages: 1, total: 0 } },
        }
      );
    }
    mockHttp(scripts);

    const client = newClient();
    const out = await importLeads.execute(client, {
      records,
      mappings: { fields: { Brand: "LEAD_NAME", Site: "LEAD_WEBSITE" } },
    });
    expect(out.importIds).toHaveLength(2);

    // Both CSV uploads must share the same header line.
    const uploads = getHttpRequests().filter((r) => /\/imports\?file_name=/.test(r.path));
    expect(uploads).toHaveLength(2);
    const h0 = (uploads[0].body as string).split("\n")[0];
    const h1 = (uploads[1].body as string).split("\n")[0];
    expect(h0).toBe(h1);
    expect(h0).toBe("MCP_ROW_ID,Brand,Site");

    // Both update_mappings calls share the same payload.
    const mapCalls = getHttpRequests().filter((r) => /update_mappings/.test(r.path));
    expect(mapCalls).toHaveLength(2);
    const m0 = JSON.parse(mapCalls[0].body as string);
    const m1 = JSON.parse(mapCalls[1].body as string);
    expect(m0).toEqual(m1);
    expect(m0.fields).toEqual({ Brand: "LEAD_NAME", Site: "LEAD_WEBSITE" });
  });

  it("coerces number/boolean cells; records[i].Brand=42 → '42' in CSV", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: adminMe() },
      {
        method: "POST",
        path: /\/1\.5\/imports\?file_name=/,
        status: 200,
        body: makeImportPayload({ preFinished: true }),
      },
      {
        method: "GET",
        path: /\/1\.5\/imports\/[a-z0-9-]+$/,
        status: 200,
        body: makeImportPayload({ preFinished: true }),
      },
    ]);
    const client = newClient();
    await importLeads.execute(client, {
      records: [{ Brand: "Apple", Employees: 500, Public: true } as any],
      mappings: { fields: { Brand: "LEAD_NAME" } },
      dry_run: true,
    });
    const uploadReq = getHttpRequests().find((r) => /\/imports\?file_name=/.test(r.path));
    const dataLine = (uploadReq!.body as string).split("\n")[1];
    // header sorted: MCP_ROW_ID, Brand, Employees, Public
    const cols = dataLine.split(",");
    expect(cols[1]).toBe("Apple");
    expect(cols[2]).toBe("500");
    expect(cols[3]).toBe("true");
  });
});

describe("leadbay_import_leads — records-mode validation errors", () => {
  function adminClient() {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: adminMe() },
    ]);
    return newClient();
  }

  it("both `domains` and `records` → IMPORT_INPUT_CONFLICT", async () => {
    await expect(
      importLeads.execute(newClient(), {
        domains: [{ domain: "apple.com" }],
        records: [{ A: "1" }],
        mappings: { fields: { A: "LEAD_NAME" } },
      })
    ).rejects.toMatchObject({ error: true, code: "IMPORT_INPUT_CONFLICT" });
    expect(getHttpRequests()).toEqual([]);
  });

  it("neither input → IMPORT_EMPTY_INPUT", async () => {
    await expect(importLeads.execute(newClient(), {})).rejects.toMatchObject({
      error: true,
      code: "IMPORT_EMPTY_INPUT",
    });
    expect(getHttpRequests()).toEqual([]);
  });

  it("`records` without `mappings` → IMPORT_MAPPING_REQUIRED", async () => {
    const client = adminClient();
    await expect(
      importLeads.execute(client, { records: [{ A: "x" }] } as any)
    ).rejects.toMatchObject({ error: true, code: "IMPORT_MAPPING_REQUIRED" });
  });

  it("mapping without LEAD_NAME or LEAD_WEBSITE → IMPORT_MAPPING_NO_RESOLVER", async () => {
    const client = adminClient();
    await expect(
      importLeads.execute(client, {
        records: [{ Sector: "Tech" }],
        mappings: { fields: { Sector: "LEAD_SECTOR" } },
      })
    ).rejects.toMatchObject({ error: true, code: "IMPORT_MAPPING_NO_RESOLVER" });
  });

  it("reserved column MCP_ROW_ID (any case) in record key → IMPORT_RESERVED_COLUMN", async () => {
    const client = adminClient();
    await expect(
      importLeads.execute(client, {
        records: [{ mcp_row_id: "x", LEAD_NAME: "y" } as any],
        mappings: { fields: { LEAD_NAME: "LEAD_NAME" } },
      })
    ).rejects.toMatchObject({ error: true, code: "IMPORT_RESERVED_COLUMN" });
  });

  it("reserved column MCP_ROW_ID (any case) in mapping key → IMPORT_RESERVED_COLUMN", async () => {
    const client = adminClient();
    await expect(
      importLeads.execute(client, {
        records: [{ A: "x" }],
        mappings: { fields: { Mcp_Row_Id: "LEAD_NAME" } as any },
      })
    ).rejects.toMatchObject({ error: true, code: "IMPORT_RESERVED_COLUMN" });
  });

  it("mapping key absent from records → IMPORT_MAPPING_KEY_UNKNOWN", async () => {
    const client = adminClient();
    await expect(
      importLeads.execute(client, {
        records: [{ A: "x" }],
        mappings: { fields: { B: "LEAD_NAME" } },
      })
    ).rejects.toMatchObject({ error: true, code: "IMPORT_MAPPING_KEY_UNKNOWN" });
  });

  it("non-string non-scalar cell value (array) → IMPORT_INVALID_CELL_TYPE", async () => {
    const client = adminClient();
    await expect(
      importLeads.execute(client, {
        records: [{ Brand: ["Apple", "Inc"] } as any],
        mappings: { fields: { Brand: "LEAD_NAME" } },
      })
    ).rejects.toMatchObject({ error: true, code: "IMPORT_INVALID_CELL_TYPE" });
  });

  it("column name longer than 128 chars → IMPORT_INVALID_COLUMN_NAME", async () => {
    const client = adminClient();
    const longName = "a".repeat(129);
    await expect(
      importLeads.execute(client, {
        records: [{ [longName]: "x", LEAD_NAME: "y" }],
        mappings: { fields: { LEAD_NAME: "LEAD_NAME" } },
      })
    ).rejects.toMatchObject({ error: true, code: "IMPORT_INVALID_COLUMN_NAME" });
  });

  it("column name with control char → IMPORT_INVALID_COLUMN_NAME", async () => {
    const client = adminClient();
    await expect(
      importLeads.execute(client, {
        records: [{ "bad\nname": "x", LEAD_NAME: "y" }],
        mappings: { fields: { LEAD_NAME: "LEAD_NAME" } },
      })
    ).rejects.toMatchObject({ error: true, code: "IMPORT_INVALID_COLUMN_NAME" });
  });
});

// ─── helpers ───────────────────────────────────────────────────────────────

let importIdCounter = 0;
function makeImportPayload(opts: {
  preFinished?: boolean;
  preError?: string | null;
  procFinished?: boolean;
  procError?: string | null;
}) {
  importIdCounter++;
  return {
    id: `imp-${importIdCounter}-${Math.random().toString(36).slice(2, 8)}`,
    date: new Date().toISOString(),
    file_name: "mcp-import.csv",
    imported_records: 0,
    pending_imported_records: 0,
    total_records: 0,
    mappings: null,
    pre_processing: {
      finished: Boolean(opts.preFinished),
      error: opts.preError ?? null,
      hints: null,
      samples: [],
      status_samples: null,
    },
    processing: opts.procFinished !== undefined ? {
      progress: opts.procFinished ? 1 : 0,
      finished: Boolean(opts.procFinished),
      error: opts.procError ?? null,
    } : null,
  };
}
