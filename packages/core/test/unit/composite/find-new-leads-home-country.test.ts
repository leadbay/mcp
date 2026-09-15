/**
 * product#4132 — the workspace's own country in `filters.locations` is dropped,
 * not refused. A scheduled agent on FR production sent `["France"]` as its first
 * `leadbay_find_new_leads` call on every run and got COUNTRY_LEVEL_LOCATION.
 * Any other country-level value is still refused before any request.
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
import { findNewLeads } from "../../../src/composite/find-new-leads.js";

const frClient = () => new LeadbayClient("https://api-fr.leadbay.app", "u.tok", "fr");
const usClient = () => new LeadbayClient("https://api-us.leadbay.app", "u.tok", "us");

const JOB_ID = "281d8b55-b357-43ed-aca9-63e50bce84a6";

const COMPLETED = {
  job: {
    id: JOB_ID,
    state: "completed",
    submitted_at: "2026-09-14T06:03:55Z",
    expires_at: "2026-10-14T06:03:55Z",
    last_progress_at: "2026-09-14T06:04:08Z",
  },
  funnel: { matched: 40, novel: 40, examined: 0, delivered: 0, stop_reason: "pool_exhausted" },
  items: [],
  next_since: null,
  cost: { spent: 0, unit: "cost_cents", breakdown: {} },
  explain: { region: "FR", model: "text_v2_ai_description" },
};

function mockSubmit() {
  mockHttp([
    {
      method: "POST",
      path: "/1.6/mcp/search",
      status: 202,
      body: { job_id: JOB_ID, items_requested: 10, duplicate: false },
    },
    { method: "GET", path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`, status: 200, body: COMPLETED },
  ]);
}

function submittedBody() {
  return JSON.parse(getHttpRequests().find((r) => r.method === "POST")!.body!);
}

// The first call of julien@lelab0.com's daily run, 2026-09-14 06:03:55 UTC.
const JULIEN_ASK = {
  example_lead: { description: "PME française de services B2B, 8 à 40 salariés." },
  filters: { locations: ["France"], employees_min: 8, employees_max: 40 },
  count: 10,
  request_id: "lab0-daily-2026-09-14",
  wait_seconds: 0,
};

beforeEach(() => resetHttpMock());

describe("leadbay_find_new_leads — the workspace's own country", () => {
  it("drops France on FR and runs the search over the whole workspace", async () => {
    mockSubmit();
    const result = await findNewLeads.execute(frClient(), JULIEN_ASK);

    expect(result.job_id).toBe(JOB_ID);
    expect(submittedBody().filters).toEqual({ employees_min: 8, employees_max: 40 });
    expect(result.note).toMatch(/Removed "France" from filters\.locations/);
    expect(result.note).toMatch(/holds France companies only/);
  });

  it("drops United States on US", async () => {
    mockSubmit();
    const result = await findNewLeads.execute(usClient(), {
      ...JULIEN_ASK,
      filters: { locations: ["United States"] },
    });
    expect(submittedBody().filters).toEqual({});
    expect(result.note).toMatch(/holds United States companies only/);
  });

  it("keeps the other places and says the search covers them only", async () => {
    mockSubmit();
    const result = await findNewLeads.execute(frClient(), {
      ...JULIEN_ASK,
      filters: { locations: ["Paris", "France"] },
    });
    expect(submittedBody().filters).toEqual({ locations: ["Paris"] });
    expect(result.note).toMatch(/covers "Paris" only/);
  });

  it("drops a bare string the same way", async () => {
    mockSubmit();
    await findNewLeads.execute(frClient(), {
      ...JULIEN_ASK,
      filters: { locations: "la France" as unknown as string[] },
    });
    expect(submittedBody().filters).toEqual({});
  });

  it("derives the same idempotency key with and without the dropped country", async () => {
    const { request_id: _omit, ...ask } = JULIEN_ASK;
    mockSubmit();
    await findNewLeads.execute(frClient(), ask as typeof JULIEN_ASK);
    const withCountry = submittedBody().request_id;

    resetHttpMock();
    mockSubmit();
    await findNewLeads.execute(frClient(), {
      ...(ask as typeof JULIEN_ASK),
      filters: { employees_min: 8, employees_max: 40 },
    });
    expect(submittedBody().request_id).toBe(withCountry);
  });

  it("carries no note when no country was passed", async () => {
    mockSubmit();
    const result = await findNewLeads.execute(frClient(), {
      ...JULIEN_ASK,
      filters: { locations: ["Lyon"] },
    });
    expect(result.note).toBeUndefined();
  });

  it("still refuses a foreign country before any request", async () => {
    mockHttp([]);
    await expect(
      findNewLeads.execute(frClient(), {
        ...JULIEN_ASK,
        filters: { locations: ["Germany"] },
      })
    ).rejects.toMatchObject({ code: "COUNTRY_LEVEL_LOCATION" });
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("still refuses when a foreign country rides along with the home one", async () => {
    mockHttp([]);
    await expect(
      findNewLeads.execute(frClient(), {
        ...JULIEN_ASK,
        filters: { locations: ["France", "Germany"] },
      })
    ).rejects.toMatchObject({ code: "COUNTRY_LEVEL_LOCATION" });
    expect(getHttpRequests()).toHaveLength(0);
  });
});
