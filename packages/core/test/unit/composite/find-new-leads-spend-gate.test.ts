/**
 * Spend gate for leadbay_find_new_leads (Codex P1 on the follow-up review).
 *
 * qualify_leads got the gate first; this tool has the identical paid surface
 * (`qualify: true` and/or `channels`) and was still submitting directly. The
 * trigger differs though — `qualify` defaults to FALSE here, so the default
 * search is genuinely free and must not be gated.
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

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "us");
const JOB_ID = "9d41c0a6-3b72-4e58-b110-2f7a6c9e4d31";

const DRY_RUN_200 = {
  valid: true,
  items_requested: 10,
  estimated_cost: { max: 1880, unit: "cost_cents" },
  quota_forecast: {
    web_fetch_allowed: true,
    rescore_allowed: true,
    enrichment_allowed: true,
  },
};

const SUBMIT_202 = {
  job_id: JOB_ID,
  status_url: `/1.6/mcp/jobs/${JOB_ID}`,
  estimated_cost: { max: 0, unit: "cost_cents" },
  items_requested: 10,
  duplicate: false,
};

const SNAPSHOT = {
  job: { id: JOB_ID, state: "completed" },
  funnel: { delivered: 1, examined: 1 },
  items: [
    {
      ref: { input_indexes: [0] },
      status: "delivered",
      seq: 0,
      lead: { lead_id: "aaaa1111-2222-3333-4444-555566667777" },
    },
  ],
  cost: { spent: 0, unit: "cost_cents", breakdown: {} },
  next_since: null,
  explain: { region: "us", model: "m" },
};

const BASE_ARGS = { count: 10, request_id: "gyms-dallas-2026-08-03" };

beforeEach(() => resetHttpMock());

const postBodies = () =>
  getHttpRequests()
    .filter((r: any) => r.method === "POST")
    .map((r: any) => (typeof r.body === "string" ? JSON.parse(r.body) : r.body));

describe("leadbay_find_new_leads — spend gate", () => {
  it("withholds a qualify:true search and quotes instead", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/mcp/search", status: 200, body: DRY_RUN_200 },
    ]);

    const result: any = await findNewLeads.execute(newClient(), {
      ...BASE_ARGS,
      qualify: true,
    });

    expect(result.mode).toBe("needs_confirmation");
    expect(result.submitted).toBe(false);
    expect(result.job_id).toBeUndefined();
    expect(result.estimated_cost).toEqual({ max: 1880, unit: "cost_cents" });

    const posts = postBodies();
    expect(posts).toHaveLength(1);
    expect(posts[0].dry_run).toBe(true);
  });

  it("withholds a channels purchase even when qualify is off", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/mcp/search", status: 200, body: DRY_RUN_200 },
    ]);

    const result: any = await findNewLeads.execute(newClient(), {
      ...BASE_ARGS,
      channels: ["phone"],
    });

    expect(result.mode).toBe("needs_confirmation");
    expect(result.paid_because.join(" ")).toMatch(/channels requested: phone/);
  });

  it("confirm:false vetoes with no network call at all", async () => {
    mockHttp([]);

    const result: any = await findNewLeads.execute(newClient(), {
      ...BASE_ARGS,
      qualify: true,
      confirm: false,
    });

    expect(result.vetoed).toBe(true);
    expect(result.quote).toBeNull();
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("the DEFAULT free search is not gated", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/mcp/search", status: 202, body: SUBMIT_202 },
      {
        method: "GET",
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`,
        status: 200,
        body: SNAPSHOT,
      },
    ]);

    const result: any = await findNewLeads.execute(newClient(), {
      ...BASE_ARGS,
      wait_seconds: 0,
    });

    expect(result.mode).toBeUndefined();
    expect(result.job_id).toBe(JOB_ID);
    expect(postBodies()[0].dry_run).toBeUndefined();
  });

  it("synthesizes a request_id when the caller omits the required field", async () => {
    // The server does not validate schemas before dispatch, so `required` is
    // not enforced — a confirmed paid search could otherwise post with no
    // idempotency handle and a retry would launch a second paid job.
    mockHttp([
      { method: "POST", path: "/1.6/mcp/search", status: 202, body: SUBMIT_202 },
      {
        method: "GET",
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`,
        status: 200,
        body: SNAPSHOT,
      },
    ]);

    await findNewLeads.execute(newClient(), {
      count: 10,
      qualify: true,
      confirm: true,
      wait_seconds: 0,
    } as any);

    const body = postBodies()[0];
    expect(body.request_id).toMatch(/^search-auto-[0-9a-f]{32}$/);
  });

  it("confirm:true submits the paid search", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/mcp/search", status: 202, body: SUBMIT_202 },
      {
        method: "GET",
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`,
        status: 200,
        body: SNAPSHOT,
      },
    ]);

    const result: any = await findNewLeads.execute(newClient(), {
      ...BASE_ARGS,
      qualify: true,
      confirm: true,
      wait_seconds: 0,
    });

    expect(result.job_id).toBe(JOB_ID);
    const posts = postBodies();
    expect(posts).toHaveLength(1);
    expect(posts[0].dry_run).toBeUndefined();
    // `confirm` is a client-side gate — it must not leak onto the wire.
    expect(posts[0].confirm).toBeUndefined();
  });
});
