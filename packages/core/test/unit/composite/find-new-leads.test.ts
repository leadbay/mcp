/**
 * Unit tests for leadbay_find_new_leads (POST /mcp/search + job poll).
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
import { MCP_JOB_POLL } from "../../../src/composite/_mcp-job-helpers.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "us");

const JOB_ID = "281d8b55-b357-43ed-aca9-63e50bce84a6";

const SUBMIT_202 = {
  job_id: JOB_ID,
  status_url: `/1.6/mcp/jobs/${JOB_ID}`,
  estimated_cost: { max: 921, unit: "cost_cents" },
  items_requested: 3,
  duplicate: false,
};

const DELIVERED_ITEM = {
  ref: { lead_id: "77b1790c-bd49-4611-bc1e-ce90343a2f32" },
  status: "delivered",
  seq: 0,
  completed_at: "2026-07-28T10:15:00Z",
  cost: { billed: 0, unit: "cost_cents" },
  lead: {
    lead_id: "77b1790c-bd49-4611-bc1e-ce90343a2f32",
    company: { name: "Black Crow AI", employees: { min: 11, max: 50, known: true } },
    fit: { available: true, score: 59 },
    web_research: { available: false, unavailable_reason: "never_fetched" },
  },
};

const SKIPPED_ITEM = {
  ref: { lead_id: "9223bbf6-5270-4c9c-a6f9-6bfa38a8b388" },
  status: "skipped",
  status_reason: "disqualified",
  seq: 1,
  cost: { billed: 0, unit: "cost_cents" },
};

function snapshot(state: string, items: unknown[], stopReason: string | null = null) {
  return {
    job: {
      id: JOB_ID,
      state,
      submitted_at: "2026-07-28T10:14:02Z",
      expires_at: "2026-08-27T10:14:02Z",
      last_progress_at: "2026-07-28T10:14:46Z",
    },
    funnel: {
      matched: 25,
      novel: 25,
      examined: 2,
      qualified: 1,
      disqualified: 1,
      delivered: items.filter((i: any) => i.status === "delivered").length,
      delivered_callable: 0,
      delivered_title_only: 0,
      degraded: 0,
      stop_reason: stopReason,
    },
    items,
    next_since: items.length > 0 ? "1785233671844264:1" : null,
    cost: { spent: 165, unit: "cost_cents", breakdown: { web_fetch_cents: 161, rescore_cents: 4 } },
    explain: {
      region: "US",
      model: "text_v2_ai_description",
      basis: "query_centroid",
      seed_strategy: "example_lead",
      scope_notes: ["note-1"],
    },
  };
}

beforeEach(() => resetHttpMock());

describe("leadbay_find_new_leads", () => {
  it("happy path — submits, polls once, splits delivered/skipped", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/mcp/search", status: 202, body: SUBMIT_202 },
      {
        method: "GET",
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`,
        status: 200,
        body: snapshot("completed", [DELIVERED_ITEM, SKIPPED_ITEM], "target_reached"),
      },
    ]);
    const result = await findNewLeads.execute(newClient(), {
      example_lead: { description: "Operator of full-service fitness centers." },
      filters: { locations: ["Texas"] },
      count: 3,
      request_id: "probe-1",
      wait_seconds: 0,
    });

    expect(result.job_id).toBe(JOB_ID);
    expect(result.done).toBe(true);
    expect(result.still_running).toBe(false);
    expect(result.next_poll).toBeNull();
    expect(result.leads).toHaveLength(1);
    expect(result.leads[0].lead.company.name).toBe("Black Crow AI");
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].status_reason).toBe("disqualified");
    expect(result.summary.delivered).toBe(1);
    expect(result.summary.stop_reason).toBe("target_reached");
    expect(result.explain.scope_notes).toEqual(["note-1"]);

    const submit = getHttpRequests().find((r) => r.method === "POST")!;
    const body = JSON.parse(submit.body!);
    expect(body.request_id).toBe("probe-1");
    expect(body.example_lead.description).toMatch(/fitness centers/);
    // Local-only params never reach the wire.
    expect(body.wait_seconds).toBeUndefined();
  });

  it("dry_run — forecasts without creating or polling a job", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.6/mcp/search",
        status: 200,
        body: {
          valid: true,
          items_requested: 3,
          estimated_cost: { max: 921, unit: "cost_cents" },
          quota_forecast: { web_fetch_allowed: true, rescore_allowed: true, enrichment_allowed: true },
        },
      },
    ]);
    const result = await findNewLeads.execute(newClient(), {
      query: "gyms in Texas",
      count: 3,
      request_id: "probe-dry",
      dry_run: true,
    });
    expect(result.dry_run).toBe(true);
    expect(result.estimated_cost.max).toBe(921);
    expect(getHttpRequests()).toHaveLength(1);
  });

  it("still-running job — returns partial results with an explicit next_poll", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/mcp/search", status: 202, body: SUBMIT_202 },
      {
        method: "GET",
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`,
        status: 200,
        body: snapshot("running", [DELIVERED_ITEM]),
      },
    ]);
    const result = await findNewLeads.execute(newClient(), {
      example_lead: { description: "SaaS analytics for retailers." },
      count: 3,
      request_id: "probe-2",
      wait_seconds: 0,
    });
    expect(result.done).toBe(false);
    expect(result.still_running).toBe(true);
    expect(result.next_poll).toEqual({
      tool: "leadbay_lead_job_status",
      job_id: JOB_ID,
      suggested_wait_seconds: 60,
    });
    expect(result.leads).toHaveLength(1);
  });

  it("wait loop — keeps polling until the job goes terminal", async () => {
    const restoreInterval = MCP_JOB_POLL.intervalMs;
    MCP_JOB_POLL.intervalMs = 1;
    try {
      mockHttp([
        { method: "POST", path: "/1.6/mcp/search", status: 202, body: SUBMIT_202 },
        {
          method: "GET",
          path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`,
          status: 200,
          body: snapshot("running", []),
        },
        {
          method: "GET",
          path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`,
          status: 200,
          body: snapshot("completed", [DELIVERED_ITEM], "target_reached"),
        },
      ]);
      const result = await findNewLeads.execute(newClient(), {
        example_lead: { description: "SaaS analytics for retailers." },
        count: 3,
        request_id: "probe-3",
        wait_seconds: 5,
      });
      expect(result.done).toBe(true);
      expect(result.leads).toHaveLength(1);
      expect(getHttpRequests()).toHaveLength(3);
    } finally {
      MCP_JOB_POLL.intervalMs = restoreInterval;
    }
  });

  it("normalizes an agent-invented nested filters.employees onto the flat wire keys", async () => {
    // Live eval 2026-07-30: 2/2 cold agents passed employees:{min,max}
    // (the RESULT shape) and the backend 400'd the whole ask. The composite
    // maps it instead of failing.
    mockHttp([
      { method: "POST", path: "/1.6/mcp/search", status: 202, body: SUBMIT_202 },
      {
        method: "GET",
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`,
        status: 200,
        body: snapshot("completed", [DELIVERED_ITEM], "target_reached"),
      },
    ]);
    await findNewLeads.execute(newClient(), {
      example_lead: { description: "B2B SaaS with in-house sales teams." },
      filters: { locations: ["Texas"], employees: { min: 100, max: 1000 } } as any,
      count: 3,
      request_id: "probe-nested-emp",
      wait_seconds: 0,
    });
    const body = JSON.parse(getHttpRequests().find((r) => r.method === "POST")!.body!);
    expect(body.filters).toEqual({
      locations: ["Texas"],
      employees_min: 100,
      employees_max: 1000,
    });
  });

  it("rejects country-level locations with a named, actionable error before any spend", async () => {
    // 4/4 live E2E agents passed a country label; the backend silently
    // fences it to a same-named town (product#3939).
    mockHttp([]);
    await expect(
      findNewLeads.execute(newClient(), {
        example_lead: { description: "College with employer-facing B2B programs." },
        filters: { locations: ["United States"] },
        count: 5,
        request_id: "probe-country",
      })
    ).rejects.toMatchObject({ code: "COUNTRY_LEVEL_LOCATION" });
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("429 refusal (rate cap) — propagates as a quota error", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.6/mcp/search",
        status: 429,
        body: { error: "rate_limited", message: "submit rate cap reached" },
      },
    ]);
    await expect(
      findNewLeads.execute(newClient(), {
        query: "gyms",
        count: 3,
        request_id: "probe-4",
      })
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
  });
});
