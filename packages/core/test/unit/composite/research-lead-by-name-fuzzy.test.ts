/**
 * leadbay_research_lead_by_name_fuzzy — corpus resolution + delegation.
 *
 * Verifies:
 *   - happy path: single corpus match → delegates to _by_id, populates
 *     _meta.resolved_from / resolved_query.
 *   - multiple matches → primary is the backend's first suggestion, rest land
 *     in _meta.match_candidates (up to 4).
 *
 * Every case mocks /search/suggest explicitly. Before product#4006 these
 * tests omitted it, so the unmatched-script transport error silently pushed
 * them onto the (now removed) active-lens fallback — they passed while
 * testing a path other than the one they named.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { researchLeadByNameFuzzy } from "../../../src/composite/research-lead-by-name-fuzzy.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

// Stub the lens-scoped + sub-resource fetches the _by_id composite needs
// after the fuzzy resolution lands on a leadId. The wrapper itself only
// owns the wishlist call + the delegate; everything else is _by_id's
// network surface.
function mockByIdSubResources(leadId: string) {
  return [
    // /interactions fire-and-forget
    { method: "POST" as const, path: "/1.6/interactions", status: 200, body: {} },
    // lens-scoped lead profile
    {
      method: "GET" as const,
      path: new RegExp(`/1\\.6/lenses/42/leads/${leadId}$`),
      status: 200,
      body: {
        id: leadId,
        name: "Acme",
        score: 80,
        ai_agent_lead_score: 70,
        location: null,
        description: null,
        size: null,
        website: "acme.com",
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
    // qualification (additive)
    { method: "GET" as const, path: `/1.6/leads/${leadId}/ai_agent_responses`, status: 200, body: [] },
    // enrich/contacts (additive)
    { method: "GET" as const, path: new RegExp(`/1\\.6/leads/${leadId}/enrich/contacts`), status: 200, body: [] },
    // web_fetch (additive)
    { method: "GET" as const, path: `/1.6/leads/${leadId}/web_fetch`, status: 200, body: { content: null, fetch_at: null } },
    // activities (additive)
    { method: "GET" as const, path: new RegExp(`/1\\.6/leads/${leadId}/activities`), status: 200, body: { items: [], pagination: { page: 0, pages: 1, total: 0 } } },
    // org contacts (only fetched conditionally — when org_contacts_count > 0
    // it would be triggered; mock anyway in case the composite changes)
    { method: "GET" as const, path: new RegExp(`/1\\.6/leads/${leadId}/contacts`), status: 200, body: [] },
  ];
}

describe("research_lead_by_name_fuzzy", () => {
  it("happy path — single corpus match delegates to _by_id with resolved_from", async () => {
    mockHttp([
      // cross-tab corpus search
      {
        method: "GET",
        path: "/1.6/search/suggest?q=acme",
        status: 200,
        body: [
          {
            text: "Acme Corp",
            match_type: "COMPANY",
            lead_id: "lead-1",
            lens_id: "42",
          },
        ],
      },
      ...mockByIdSubResources("lead-1"),
    ]);

    const res: any = await researchLeadByNameFuzzy.execute(
      newClient(),
      { companyName: "acme" }
    );
    expect(res._meta.resolved_from).toBe("companyName");
    expect(res._meta.resolved_query).toBe("acme");
    expect(res._meta.match_candidates).toEqual([]);
    expect(res.firmographics.id).toBe("lead-1");
  });

  it("multiple matches — primary is the backend's first suggestion; rest populate match_candidates (≤4)", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/search/suggest?q=acme",
        status: 200,
        body: [
          { text: "Acme Corp", lead_id: "lead-b", lens_id: "42" },
          { text: "Old Acme", lead_id: "lead-c", lens_id: "42" },
          { text: "Acme Labs", lead_id: "lead-d", lens_id: "42" },
          { text: "Acme Robotics", lead_id: "lead-e", lens_id: "42" },
          { text: "Acme Health", lead_id: "lead-a", lens_id: "42" },
          { text: "Acme Studios", lead_id: "lead-f", lens_id: "42" },
        ],
      },
      ...mockByIdSubResources("lead-b"),
    ]);

    const res: any = await researchLeadByNameFuzzy.execute(
      newClient(),
      { companyName: "acme" }
    );
    expect(res.firmographics.id).toBe("lead-b");
    expect(res._meta.match_candidates).toHaveLength(4);
    // Suggest ordering is the backend's relevance ranking — preserve it.
    expect(res._meta.match_candidates.map((m: any) => m.leadId)).toEqual([
      "lead-c", "lead-d", "lead-e", "lead-a",
    ]);
  });

  it("zero matches in corpus AND registry — throws LEAD_NOT_FOUND", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/search/suggest?q=Acme", status: 200, body: [] },
      {
        method: "POST",
        path: "/1.6/leads/resolve",
        status: 200,
        body: { type: "none", would_help: ["website", "registry_number"] },
      },
    ]);

    await expect(
      researchLeadByNameFuzzy.execute(newClient(), { companyName: "Acme" })
    ).rejects.toMatchObject({
      code: "LEAD_NOT_FOUND",
    });
  });
});
