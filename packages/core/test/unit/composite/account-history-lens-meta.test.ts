import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { accountHistory } from "../../../src/composite/account-history.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");
const LEAD = "lead-77";
const OTHER_LENS = 99; // a lens other than the active default

beforeEach(() => {
  resetHttpMock();
  // Keep these tests deterministic + offline: no agent-memory summary fetch.
  process.env.LEADBAY_AGENT_MEMORY = "off";
});
afterEach(() => {
  delete process.env.LEADBAY_AGENT_MEMORY;
});

// research_lead_by_id's sub-resources, keyed to an EXPLICIT lens id so we can
// prove account-history forwards lensId rather than resolving the default.
function mockResearchForLens(leadId: string, lensId: number) {
  return [
    { method: "POST" as const, path: "/1.5/interactions", status: 200, body: {} },
    {
      method: "GET" as const,
      path: new RegExp(`/1\\.5/lenses/${lensId}/leads/${leadId}$`),
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
    { method: "GET" as const, path: `/1.5/leads/${leadId}/ai_agent_responses`, status: 200, body: [] },
    { method: "GET" as const, path: new RegExp(`/1\\.5/leads/${leadId}/enrich/contacts`), status: 200, body: [] },
    { method: "GET" as const, path: `/1.5/leads/${leadId}/web_fetch`, status: 200, body: { content: null, fetch_at: null } },
    { method: "GET" as const, path: new RegExp(`/1\\.5/leads/${leadId}/activities\\?count=20`), status: 200, body: { items: [], pagination: { page: 0, pages: 1, total: 0 } } },
    { method: "GET" as const, path: new RegExp(`/1\\.5/leads/${leadId}/contacts`), status: 200, body: [] },
    // account-history's own notes + activities reads
    { method: "GET" as const, path: `/1.5/leads/${leadId}/notes`, status: 200, body: [] },
    { method: "GET" as const, path: new RegExp(`/1\\.5/leads/${leadId}/activities\\?count=50`), status: 200, body: { items: [], pagination: { page: 0, pages: 1, total: 0 } } },
  ];
}

describe("leadbay_account_history — lensId passthrough + _meta preservation", () => {
  it("forwards lensId to research (targets a non-active lens, no default resolve)", async () => {
    mockHttp(mockResearchForLens(LEAD, OTHER_LENS));

    const res: any = await accountHistory.execute(newClient(), {
      leadId: LEAD,
      lensId: OTHER_LENS,
    });

    // The lead was fetched from the explicitly-requested lens.
    const reqs = getHttpRequests();
    expect(
      reqs.some((r) => r.path === `/1.5/lenses/${OTHER_LENS}/leads/${LEAD}`),
    ).toBe(true);
    // With an explicit lensId, research must NOT resolve the default lens.
    expect(reqs.some((r) => r.path === "/1.5/users/me")).toBe(false);
    // And the chosen lens is reflected in the passed-through metadata.
    expect(res._meta.lens_id).toBe(OTHER_LENS);
  });

  it("preserves research _meta (lens + web-fetch state) alongside local counts", async () => {
    mockHttp(mockResearchForLens(LEAD, OTHER_LENS));

    const res: any = await accountHistory.execute(newClient(), {
      leadId: LEAD,
      lensId: OTHER_LENS,
    });

    // Pass-through keys from research survive (previously dropped when _meta
    // was replaced wholesale). These keys only exist if research's _meta was
    // spread in — that's the regression this guards.
    expect(res._meta).toMatchObject({
      lens_id: OTHER_LENS,
      has_reachable_contact: false,
    });
    expect(res._meta).toHaveProperty("web_fetch_in_progress");
    expect(res._meta).toHaveProperty("resolved_from");
    // Local counts are still layered on top.
    expect(res._meta.notes_count).toBe(0);
    expect(res._meta.activities_returned).toBe(0);
    expect(res._meta.region).toBe("us");
  });
});
