/**
 * Lead-job results must fit in one host tool result, and a lead-job pacing
 * 429 must not read as a credit wall.
 *
 * SnapLock rehearsal, 2026-09-11, prod job 24203dfe: 23 delivered items
 * relayed verbatim made a 158 KB result. The host moved it to a file the
 * session could not open, so the agent never saw the leads it paid for. It
 * then kept re-submitting to read them, hit the 10-per-hour submit cap, and
 * was told "Quota exceeded … top up AI credits" on an unlimited org.
 * The host inlined a 56,591-char result and hid a 61.4 KB one; 56,000 is
 * the bound used below.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { leadJobStatus } from "../../../src/composite/lead-job-status.js";
import { findNewLeads } from "../../../src/composite/find-new-leads.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "us");
const JOB_ID = "d89b9803-f9d8-4298-86af-9cd4b1841afd";
const HOST_RESULT_CHARS = 56_000;

const text = (n: number) => "venue evidence ".repeat(Math.ceil(n / 15)).slice(0, n);

// Field sizes follow the real delivered items of job 24203dfe (~6.6 KB each).
function heavyLead(i: number) {
  return {
    lead_id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    company: {
      name: `Venue ${i}`,
      website: `venue${i}.com`,
      domain: `venue${i}.com`,
      sector: { label: "Miscellaneous Intermediation", code: "S-Other", registry: "mala" },
      location: { city: "Wells", region: "Minnesota", country: "US", coordinates: { lat: 43.75, lon: -93.73 } },
      employees: { min: 11, max: 50, known: true },
      description: text(300),
      provenance: { source: "worldview_registry", crawled: false },
    },
    fit: {
      available: true,
      score: 90,
      components: {
        similarity: { score: 67, distance: 0.18, model: "text_v2_ai_description", calibration: "log_map_v1" },
        qualification: {
          available: true,
          ai_score: 30,
          ai_score_breakdown: { questions: 20, tags: 4, ibp: 10 },
          questions: [
            { question: "Guest-facing spaces?", score: 10, verdict: "yes", reasoning: "BEST " + text(450) },
            { question: "Renovating?", score: 5, verdict: "yes", reasoning: text(450) },
            { question: "Rolling loads?", score: 0, verdict: "no", reasoning: text(450) },
          ],
          matched_tags: [{ tag: "Customer-Facing Space", weight: 0.88, description: text(120) }],
          unmatched_tags: ["New Site Opening", "Capacity Expansion"],
          ibp: { score: 10, reasoning: text(500) },
        },
      },
    },
    signals: [
      { type: "business_signal", summary: "cold " + text(250), date: "2025-11-01", hot: false, source_url: "https://a.example" },
      { type: "business_signal", summary: "older hot " + text(250), date: "2022-03-01", hot: true, source_url: "https://b.example" },
      { type: "business_signal", summary: "newest hot " + text(250), date: "2025-12-09", hot: true, source_url: "https://c.example" },
      { type: "business_signal", summary: "middle hot " + text(250), date: "2023-01-18", hot: true, source_url: "https://d.example" },
    ],
    web_research: { available: true, company_profile: [text(500), text(500)], positioning: text(500) },
    contact: {
      lead_contact_id: `c-${i}`,
      name: "Nate Nasinec",
      role: "Owner",
      linkedin: "https://example.com/nate",
      matched_title: { requested: "Owner", matched_via: "substring", similarity: 0.9 },
      channels: {
        email: { status: "delivered", value: `nate@venue${i}.com`, billed: 25 },
        phone: { status: "failed_now", billed: 0 },
      },
      provenance: { roster: "registry", resolution: "fullenrich", pooled: true },
    },
    alternative_contacts: [1, 2, 3].map((n) => ({
      lead_contact_id: `a-${i}-${n}`,
      name: `Alt ${n}`,
      role: "Event Manager",
      channels: { email: { status: "masked", billed: 0 }, phone: { status: "masked", billed: 0 } },
    })),
    novelty: { novel_to_org: true, checked: ["organization_leads", "lens_membership"] },
    custom_fields: [],
  };
}

function snapshot(n: number) {
  return {
    job: {
      id: JOB_ID,
      state: "completed",
      submitted_at: "2026-09-11T23:45:45Z",
      completed_at: "2026-09-11T23:55:57Z",
      expires_at: "2026-10-11T23:55:57Z",
      last_progress_at: "2026-09-11T23:55:57Z",
    },
    funnel: { matched: n, examined: n, delivered: n, delivered_callable: n, stop_reason: "target_reached" },
    items: Array.from({ length: n }, (_, i) => ({
      ref: { lead_id: heavyLead(i).lead_id },
      status: "delivered",
      seq: i + 1,
      completed_at: "2026-09-11T23:55:57Z",
      cost: { billed: 25, unit: "cost_cents" },
      lead: heavyLead(i),
    })),
    next_since: `1:${n}`,
    cost: { spent: 25 * n, unit: "cost_cents" },
    explain: { scope_notes: [] },
  };
}

async function poll(n: number) {
  const body = snapshot(n);
  mockHttp([{ method: "GET", path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`, status: 200, body }]);
  const result = await leadJobStatus.execute(newClient(), { job_id: JOB_ID });
  return { result, verbatim: JSON.stringify(body.items).length };
}

beforeEach(() => resetHttpMock());

describe("lead-job results fit in one host result", () => {
  it("30 delivered leads: the result fits and keeps what a call list needs", async () => {
    const { result, verbatim } = await poll(30);
    expect(verbatim).toBeGreaterThan(150_000);
    expect(JSON.stringify(result).length).toBeLessThan(HOST_RESULT_CHARS);

    const lead = result.leads[0].lead;
    expect(lead.company.name).toBe("Venue 0");
    expect(lead.company.website).toBe("venue0.com");
    expect(lead.company.location).toEqual({ city: "Wells", region: "Minnesota", country: "US" });
    expect(lead.fit.score).toBe(90);
    expect(lead.fit.components.qualification.ai_score).toBe(30);
    expect(lead.fit.components.qualification.matched_tags).toEqual(["Customer-Facing Space"]);
    expect(lead.fit.reasoning.startsWith("BEST")).toBe(true);
    expect(lead.signals.map((s: any) => s.date)).toEqual(["2025-12-09", "2023-01-18"]);
    expect(lead.contact.name).toBe("Nate Nasinec");
    expect(lead.contact.channels.email).toEqual({ status: "delivered", value: "nate@venue0.com" });
    expect(lead.contact.channels.phone).toEqual({ status: "failed_now" });
    expect(lead.web_research).toBeUndefined();
    expect(lead.alternative_contacts).toHaveLength(1);
  });

  it("50 delivered leads: later rows drop the prose but keep company, scores and contact", async () => {
    const { result } = await poll(50);
    expect(JSON.stringify(result).length).toBeLessThan(HOST_RESULT_CHARS);
    expect(result.leads).toHaveLength(50);

    const first = result.leads[0].lead;
    const last = result.leads[49].lead;
    expect(first.evidence_trimmed).toBeUndefined();
    expect(last.evidence_trimmed).toBe(true);
    expect(last.signals).toBeUndefined();
    expect(last.fit.reasoning).toBeUndefined();
    expect(last.company.name).toBe("Venue 49");
    expect(last.fit.score).toBe(90);
    expect(last.contact.channels.email.value).toBe("nate@venue49.com");
  });

  it("trimmed rows keep a short description and drop unbounded custom fields", async () => {
    const body = snapshot(50);
    for (const item of body.items as any[]) {
      item.lead.custom_fields = [{ name: "notes", value: text(2000) }];
    }
    mockHttp([{ method: "GET", path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`, status: 200, body }]);
    const result = await leadJobStatus.execute(newClient(), { job_id: JOB_ID });
    expect(JSON.stringify(result).length).toBeLessThan(HOST_RESULT_CHARS);

    const last = result.leads[49].lead;
    expect(last.evidence_trimmed).toBe(true);
    expect(last.company.description.length).toBeLessThanOrEqual(80);
    expect(last.custom_fields).toBeUndefined();
    expect(result.leads[0].lead.custom_fields).toHaveLength(1);
  });
});

describe("lead-job pacing 429s are not a credit wall", () => {
  it("rate_limited: says wait, never offers a top-up", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.6/mcp/search",
        status: 429,
        body: { error: { code: "rate_limited", message: "submit rate cap reached (10/h per org)" } },
        responseHeaders: { "retry-after": "360" },
      } as any,
    ]);
    const err: any = await findNewLeads
      .execute(newClient(), { query: "gyms", count: 3, request_id: "pace-1" })
      .catch((e) => e);
    expect(err.code).toBe("QUOTA_EXCEEDED");
    const said = `${err.message} ${err.hint}`;
    expect(said).toMatch(/retry in 360s/);
    expect(said).toMatch(/not credits/);
    expect(said).not.toMatch(/leadbay_create_topup_link|Stripe|top up AI credits/);
  });

  it("active_job_cap: says poll the running jobs, never offers a top-up", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.6/mcp/search",
        status: 429,
        body: { error: { code: "active_job_cap", message: "org already has 3 active MCP jobs (cap 3)" } },
        responseHeaders: { "retry-after": "60" },
      } as any,
    ]);
    const err: any = await findNewLeads
      .execute(newClient(), { query: "gyms", count: 3, request_id: "pace-2" })
      .catch((e) => e);
    expect(err.code).toBe("QUOTA_EXCEEDED");
    const said = `${err.message} ${err.hint}`;
    expect(said).toMatch(/leadbay_lead_job_status/);
    expect(said).not.toMatch(/leadbay_create_topup_link|Stripe|top up AI credits/);
  });

  it("a real quota 429 still offers the top-up", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.6/mcp/search",
        status: 429,
        body: { error: { code: "quota_exceeded", message: "quota" } },
      },
    ]);
    const err: any = await findNewLeads
      .execute(newClient(), { query: "gyms", count: 3, request_id: "pace-3" })
      .catch((e) => e);
    expect(err.code).toBe("QUOTA_EXCEEDED");
    expect(err.hint).toMatch(/leadbay_create_topup_link/);
  });

  it("the pacing wording applies to the submit endpoints only", async () => {
    mockHttp([
      {
        method: "GET",
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`,
        status: 429,
        body: { error: { code: "rate_limited", message: "slow down" } },
      },
    ]);
    const err: any = await leadJobStatus.execute(newClient(), { job_id: JOB_ID }).catch((e) => e);
    expect(err.code).toBe("QUOTA_EXCEEDED");
    expect(err.hint).toMatch(/leadbay_create_topup_link/);
    expect(err.hint).not.toMatch(/not credits/);
  });
});
