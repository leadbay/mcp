/**
 * Regression: leadbay_research_lead_by_name_fuzzy must search the FULL
 * wishlist, not just page 0.
 *
 * Telemetry (7d ending 2026-06-11) showed 17/17 calls returning
 * LEAD_NOT_FOUND. Root cause: the wrapper fetched only the top 50
 * (count=50,page=0) of the lens wishlist, so any lead beyond the first
 * page was invisible to the substring matcher and every such lookup
 * failed. Live probe confirmed the default test lens carries total=60
 * leads across 2 pages — names like "AquaPoro" / "Handle, Inc." live on
 * page 1 and were unreachable.
 *
 * This test pins the fix: a lead that exists only on page 1 of the
 * wishlist resolves and delegates to _by_id rather than throwing.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { mockHttp, resetHttpMock, getHttpRequests, httpsMockFactory } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { researchLeadByNameFuzzy } from "../../../src/composite/research-lead-by-name-fuzzy.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

function mockByIdSubResources(leadId: string) {
  return [
    { method: "POST" as const, path: "/1.5/interactions", status: 200, body: {} },
    {
      method: "GET" as const,
      path: new RegExp(`/1\\.5/lenses/42/leads/${leadId}$`),
      status: 200,
      body: {
        id: leadId,
        name: "AquaPoro Technologies, Inc.",
        score: 57,
        ai_agent_lead_score: 50,
        location: null,
        description: null,
        size: null,
        website: "aquaporo.com",
        tags: [],
        keywords: [],
        notes_count: 0,
        epilogue_actions_count: 0,
        prospecting_actions_count: 0,
        org_contacts_count: 0,
        liked: false,
        disliked: false,
        new: false,
        recommended_contact: null,
      },
    },
    { method: "GET" as const, path: `/1.5/leads/${leadId}/ai_agent_responses`, status: 200, body: [] },
    { method: "GET" as const, path: new RegExp(`/1\\.5/leads/${leadId}/enrich/contacts`), status: 200, body: [] },
    { method: "GET" as const, path: `/1.5/leads/${leadId}/web_fetch`, status: 200, body: { content: null, fetch_at: null } },
    { method: "GET" as const, path: new RegExp(`/1\\.5/leads/${leadId}/activities`), status: 200, body: { items: [], pagination: { page: 0, pages: 1, total: 0 } } },
    { method: "GET" as const, path: new RegExp(`/1\\.5/leads/${leadId}/contacts`), status: 200, body: [] },
  ];
}

// Build a 50-item page-0 batch that does NOT contain the needle, so the
// matcher must reach page 1 to find it.
const page0Items = Array.from({ length: 50 }, (_, i) => ({
  id: `top-${i}`,
  name: `TOP COMPANY ${i}`,
  score: 100 - i,
}));

describe("research_lead_by_name_fuzzy — full-wishlist pagination", () => {
  it("resolves a lead that only appears on page 1 of the wishlist", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: { id: "u", organization: { id: "org-1", name: "X" }, last_requested_lens: 42 },
      },
      // page 0 — top 50, needle absent, has_more true (pages=2)
      {
        method: "GET",
        path: /\/1\.5\/lenses\/42\/leads\/wishlist\?count=50&page=0/,
        status: 200,
        body: { items: page0Items, pagination: { page: 0, pages: 2, total: 60 } },
      },
      // page 1 — contains the target lead
      {
        method: "GET",
        path: /\/1\.5\/lenses\/42\/leads\/wishlist\?count=50&page=1/,
        status: 200,
        body: {
          items: [
            { id: "lead-aquaporo", name: "AquaPoro Technologies, Inc.", score: 57 },
            { id: "lead-handle", name: "Handle, Inc.", score: 51 },
          ],
          pagination: { page: 1, pages: 2, total: 60 },
        },
      },
      ...mockByIdSubResources("lead-aquaporo"),
    ]);

    const res: any = await researchLeadByNameFuzzy.execute(newClient(), {
      companyName: "AquaPoro",
    });

    expect(res._meta.resolved_from).toBe("companyName");
    expect(res._meta.resolved_query).toBe("AquaPoro");
    expect(res.firmographics.id).toBe("lead-aquaporo");

    // Prove it actually walked to page 1.
    const reqs = getHttpRequests();
    expect(reqs.some((r) => r.path.includes("wishlist") && r.path.includes("page=1"))).toBe(true);
  });
});
