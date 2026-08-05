/**
 * Spend gate + render envelope for leadbay_qualify_leads.
 *
 * `qualify` defaults to TRUE on the backend (~94 cost_cents per lead needing
 * fresh research), so a bare call carrying only `lead_refs` used to be a PAID
 * submit of up to 500 refs that the user never approved. The consent gate has
 * to live in code — description prose does not stop an agent that skips it.
 *
 * These tests pin the withhold, the veto, the free pass-through, and the
 * `{leads, skipped}` envelope the shared rendering contract mandates.
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
import { qualifyLeads } from "../../../src/composite/qualify-leads.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "us");

const JOB_ID = "7b3c1de2-5f40-4a9c-9d21-0c8ea4f61b55";

const REFS = [{ website: "franklinbbq.com" }, { website: "uchiaustin.com" }];

const DRY_RUN_200 = {
  valid: true,
  items_requested: 2,
  estimated_cost: { max: 238, unit: "cost_cents" },
  quota_forecast: {
    web_fetch_allowed: true,
    rescore_allowed: true,
    enrichment_allowed: true,
  },
};

const SUBMIT_202 = {
  job_id: JOB_ID,
  status_url: `/1.6/mcp/jobs/${JOB_ID}`,
  estimated_cost: { max: 238, unit: "cost_cents" },
  items_requested: 2,
  duplicate: false,
};

const DELIVERED_ITEM = {
  ref: { input_indexes: [0], requested_as: { website: "franklinbbq.com" } },
  status: "delivered",
  seq: 0,
  cost: { billed: 94, unit: "cost_cents" },
  lead: {
    lead_id: "aaaa1111-2222-3333-4444-555566667777",
    company: { name: "Franklin Barbecue" },
  },
};

const SKIPPED_ITEM = {
  ref: { input_indexes: [1], requested_as: { website: "uchiaustin.com" } },
  status: "skipped",
  seq: 1,
  status_reason: "not_in_universe",
};

const TERMINAL_SNAPSHOT = {
  job: { job_id: JOB_ID, state: "completed" },
  funnel: { delivered: 1, examined: 2 },
  items: [DELIVERED_ITEM, SKIPPED_ITEM],
  cost: { spent: 94, unit: "cost_cents" },
  next_since: null,
};

beforeEach(() => resetHttpMock());

const postBodies = () =>
  getHttpRequests()
    .filter((r: any) => r.method === "POST")
    .map((r: any) => (typeof r.body === "string" ? JSON.parse(r.body) : r.body));

describe("leadbay_qualify_leads — spend gate", () => {
  it("withholds the paid submit when confirm is absent, and quotes instead", async () => {
    // Only the free dry_run may be called — never the submit.
    mockHttp([
      { method: "POST", path: "/1.6/mcp/qualify", status: 200, body: DRY_RUN_200 },
    ]);

    const result: any = await qualifyLeads.execute(newClient(), {
      lead_refs: REFS,
    });

    expect(result.mode).toBe("needs_confirmation");
    expect(result.submitted).toBe(false);
    expect(result.vetoed).toBe(false);
    expect(result.job_id).toBeUndefined();
    expect(result.estimated_cost).toEqual({ max: 238, unit: "cost_cents" });

    // Exactly one POST, and it was the FREE dry run.
    const posts = postBodies();
    expect(posts).toHaveLength(1);
    expect(posts[0].dry_run).toBe(true);
  });

  it("names why the call was treated as paid (backend default is true)", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/mcp/qualify", status: 200, body: DRY_RUN_200 },
    ]);

    const result: any = await qualifyLeads.execute(newClient(), {
      lead_refs: REFS,
    });

    expect(result.paid_because.join(" ")).toMatch(/qualify is on/);
  });

  it("treats requested channels as paid even when qualify is off", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/mcp/qualify", status: 200, body: DRY_RUN_200 },
    ]);

    const result: any = await qualifyLeads.execute(newClient(), {
      lead_refs: REFS,
      qualify: false,
      channels: ["email"],
    });

    expect(result.mode).toBe("needs_confirmation");
    expect(result.paid_because.join(" ")).toMatch(/channels requested: email/);
  });

  it("confirm:false is a veto — no submit AND no quote round-trip", async () => {
    // No endpoints declared: the harness throws if ANY request is made.
    mockHttp([]);

    const result: any = await qualifyLeads.execute(newClient(), {
      lead_refs: REFS,
      confirm: false,
    });

    expect(result.mode).toBe("needs_confirmation");
    expect(result.vetoed).toBe(true);
    expect(result.quote).toBeNull();
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("a fully free call (qualify:false, no channels) passes straight through", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/mcp/qualify", status: 202, body: SUBMIT_202 },
      {
        method: "GET",
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`,
        status: 200,
        body: TERMINAL_SNAPSHOT,
      },
    ]);

    const result: any = await qualifyLeads.execute(newClient(), {
      lead_refs: REFS,
      qualify: false,
      wait_seconds: 0,
    });

    expect(result.mode).toBeUndefined();
    expect(result.job_id).toBe(JOB_ID);

    // The submit went out and was NOT a dry run.
    const posts = postBodies();
    expect(posts).toHaveLength(1);
    expect(posts[0].dry_run).toBeUndefined();
    expect(posts[0].qualify).toBe(false);
  });

  it("confirm:true submits the paid job without a forced extra quote", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/mcp/qualify", status: 202, body: SUBMIT_202 },
      {
        method: "GET",
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`,
        status: 200,
        body: TERMINAL_SNAPSHOT,
      },
    ]);

    const result: any = await qualifyLeads.execute(newClient(), {
      lead_refs: REFS,
      confirm: true,
      wait_seconds: 0,
    });

    expect(result.job_id).toBe(JOB_ID);
    expect(result.done).toBe(true);

    const posts = postBodies();
    expect(posts).toHaveLength(1);
    expect(posts[0].dry_run).toBeUndefined();
    // `confirm` is a client-side gate — it must not leak onto the wire.
    expect(posts[0].confirm).toBeUndefined();
  });

  it("an explicit dry_run still quotes without needing confirm", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/mcp/qualify", status: 200, body: DRY_RUN_200 },
    ]);

    const result: any = await qualifyLeads.execute(newClient(), {
      lead_refs: REFS,
      dry_run: true,
    });

    expect(result.dry_run).toBe(true);
    expect(result.mode).toBeUndefined();
    expect(result.estimated_cost).toEqual({ max: 238, unit: "cost_cents" });
  });
});

describe("leadbay_qualify_leads — render envelope", () => {
  it("returns leads[]/skipped[] alongside items[] on a completed job", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/mcp/qualify", status: 202, body: SUBMIT_202 },
      {
        method: "GET",
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`,
        status: 200,
        body: TERMINAL_SNAPSHOT,
      },
    ]);

    const result: any = await qualifyLeads.execute(newClient(), {
      lead_refs: REFS,
      confirm: true,
      wait_seconds: 0,
    });

    // The shared rendering contract reads deliveries from leads[] and
    // skips from skipped[]; returning only items[] left both tables empty.
    expect(Array.isArray(result.leads)).toBe(true);
    expect(Array.isArray(result.skipped)).toBe(true);
    expect(result.leads).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);

    // items[] is preserved for input-order per-ref mapping.
    expect(result.items).toHaveLength(2);
  });
});

describe("leadbay_qualify_leads — unvalidated arg shapes", () => {
  // The MCP server does not validate inputSchema before dispatch, so an agent
  // can send the natural singular form. These used to TypeError BEFORE the
  // spend gate, so the caller got a crash instead of the promised quote.
  it("a single lead_refs object is treated as a one-item list", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/mcp/qualify", status: 200, body: DRY_RUN_200 },
    ]);

    const result: any = await qualifyLeads.execute(newClient(), {
      lead_refs: { website: "acme.com" },
    } as any);

    expect(result.mode).toBe("needs_confirmation");
    expect(postBodies()[0].lead_refs).toEqual([{ website: "acme.com" }]);
  });

  it("a scalar channels value reaches the wire as an array", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/mcp/qualify", status: 200, body: DRY_RUN_200 },
    ]);

    const result: any = await qualifyLeads.execute(newClient(), {
      lead_refs: REFS,
      channels: "email",
    } as any);

    expect(result.mode).toBe("needs_confirmation");
    expect(postBodies()[0].channels).toEqual(["email"]);
  });

  it("a scalar contact_titles value reaches the wire as an array", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/mcp/qualify", status: 200, body: DRY_RUN_200 },
    ]);

    await qualifyLeads.execute(newClient(), {
      lead_refs: REFS,
      contact_titles: "Owner",
    } as any);

    expect(postBodies()[0].contact_titles).toEqual(["Owner"]);
  });
});
