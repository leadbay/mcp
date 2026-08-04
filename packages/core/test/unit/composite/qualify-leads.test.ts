/**
 * Unit tests for leadbay_qualify_leads (POST /mcp/qualify + job poll).
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

const JOB_ID = "2900fff9-2985-4220-84dc-70a551fc3e84";

const SUBMIT_202 = {
  job_id: JOB_ID,
  status_url: `/1.6/mcp/jobs/${JOB_ID}`,
  estimated_cost: { max: 476, unit: "cost_cents" },
  items_requested: 3,
  duplicate: false,
};

const QUALIFIED_ITEM = {
  ref: { input_indexes: [0], requested_as: { website: "franklinbbq.com" } },
  status: "delivered",
  seq: 0,
  completed_at: "2026-07-28T10:20:00Z",
  cost: { billed: 94, unit: "cost_cents" },
  lead: {
    lead_id: "aaaa1111-2222-3333-4444-555566667777",
    company: { name: "Franklin Barbecue", employees: { min: 11, max: 50, known: true } },
    fit: {
      available: true,
      score: 72,
      components: {
        qualification: { available: true, ai_score: 12, questions: [], matched_tags: [], unmatched_tags: [] },
      },
    },
    web_research: { available: true },
    contact: {
      lead_contact_id: "cccc1111-2222-3333-4444-555566667777",
      name: "Aaron Franklin",
      role: "Owner",
      channels: {
        email: { status: "delivered", value: "aaron@franklinbbq.com", billed: 25 },
        phone: { status: "not_requested" },
      },
    },
  },
};

const NOT_IN_UNIVERSE_ITEM = {
  ref: { input_indexes: [1], requested_as: { name: "Totally Nonexistent Bistro" } },
  status: "skipped",
  status_reason: "not_in_universe",
  seq: 1,
  cost: { billed: 0, unit: "cost_cents" },
};

const SNAPSHOT_DONE = {
  job: {
    id: JOB_ID,
    state: "completed",
    submitted_at: "2026-07-28T10:19:00Z",
    expires_at: "2026-08-27T10:19:00Z",
    last_progress_at: "2026-07-28T10:20:30Z",
  },
  funnel: {
    matched: 2,
    examined: 1,
    qualified: 1,
    disqualified: 0,
    delivered: 1,
    delivered_callable: 1,
    degraded: 0,
    resolved: 1,
    not_in_universe: 1,
    stop_reason: "pool_exhausted",
  },
  items: [QUALIFIED_ITEM, NOT_IN_UNIVERSE_ITEM],
  next_since: "1785233900000000:1",
  cost: { spent: 119, unit: "cost_cents", breakdown: { enrichment_cents: 25 } },
  explain: { region: "US", model: "text_v2_ai_description", scope_notes: [] },
};

beforeEach(() => resetHttpMock());

describe("leadbay_qualify_leads", () => {
  it("happy path — per-item verdicts including honest skips", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/mcp/qualify", status: 202, body: SUBMIT_202 },
      {
        method: "GET",
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`,
        status: 200,
        body: SNAPSHOT_DONE,
      },
    ]);
    const result = await qualifyLeads.execute(newClient(), {
      lead_refs: [
        { website: "franklinbbq.com", name: "Franklin Barbecue" },
        { name: "Totally Nonexistent Bistro" },
      ],
      contact_titles: ["Owner"],
      channels: ["email"],
      request_id: "vet-austin-1",
      confirm: true,
      wait_seconds: 0,
    });

    expect(result.job_id).toBe(JOB_ID);
    expect(result.done).toBe(true);
    expect(result.items).toHaveLength(2);
    const skipped = result.items.find((i: any) => i.status === "skipped");
    expect(skipped.status_reason).toBe("not_in_universe");
    expect(result.summary.not_in_universe).toBe(1);
    expect(result.summary.delivered_callable).toBe(1);
    const delivered = result.items.find((i: any) => i.status === "delivered");
    expect(delivered.lead.contact.channels.email.value).toBe("aaron@franklinbbq.com");

    const submit = getHttpRequests().find((r) => r.method === "POST")!;
    const body = JSON.parse(submit.body!);
    expect(body.lead_refs).toHaveLength(2);
    expect(body.contact_titles).toEqual(["Owner"]);
    expect(body.wait_seconds).toBeUndefined();
  });

  it("prior_deliveries selector — passes through without lead_refs", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/mcp/qualify", status: 202, body: SUBMIT_202 },
      {
        method: "GET",
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`,
        status: 200,
        body: SNAPSHOT_DONE,
      },
    ]);
    await qualifyLeads.execute(newClient(), {
      prior_deliveries: { job_id: "0a2fcbf5-18e1-4967-b5de-0c67cd823bcc" },
      wait_seconds: 0,
    });
    const submit = getHttpRequests().find((r) => r.method === "POST")!;
    const body = JSON.parse(submit.body!);
    expect(body.prior_deliveries.job_id).toBe("0a2fcbf5-18e1-4967-b5de-0c67cd823bcc");
    expect(body.lead_refs).toBeUndefined();
  });

  it("dry_run — forecast only, no job created", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.6/mcp/qualify",
        status: 200,
        body: {
          valid: true,
          items_requested: 2,
          estimated_cost: { max: 238, unit: "cost_cents" },
          quota_forecast: { web_fetch_allowed: true, rescore_allowed: true, enrichment_allowed: false },
        },
      },
    ]);
    const result = await qualifyLeads.execute(newClient(), {
      lead_refs: [{ website: "a.com" }, { website: "b.com" }],
      dry_run: true,
    });
    expect(result.dry_run).toBe(true);
    expect(result.quota_forecast.enrichment_allowed).toBe(false);
    expect(getHttpRequests()).toHaveLength(1);
  });

  it("validation 400 (bad ref) — propagates", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.6/mcp/qualify",
        status: 400,
        body: { error: "bad_request", message: "lead_refs[0] has no identifying field" },
      },
    ]);
    await expect(
      qualifyLeads.execute(newClient(), { lead_refs: [{}] })
    ).rejects.toMatchObject({ error: true });
  });
});
