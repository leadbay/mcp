import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { accountHistory } from "../../../src/composite/account-history.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

const LEAD = "lead-9";

// research_lead_by_id's network surface (it's reused verbatim by
// account-history). Mirrors the stub in research-lead-by-name-fuzzy.test.ts.
// NOTE: research itself fetches /activities?count=20 AND account-history
// fetches /activities?count=<activityCount> — two separate calls, two
// scripts, both matched by the same regex (harness consumes one per call).
function mockResearchSubResources(leadId: string) {
  return [
    { method: "POST" as const, path: "/1.5/interactions", status: 200, body: {} },
    {
      method: "GET" as const,
      path: new RegExp(`/1\\.5/lenses/42/leads/${leadId}$`),
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
        notes_count: 2,
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
    // research's own activities?count=20 — matched specifically by count so it
    // can't accidentally consume account-history's own count=50 read (both
    // fire concurrently inside the same Promise.all).
    { method: "GET" as const, path: new RegExp(`/1\\.5/leads/${leadId}/activities\\?count=20`), status: 200, body: { items: [], pagination: { page: 0, pages: 1, total: 0 } } },
    { method: "GET" as const, path: new RegExp(`/1\\.5/leads/${leadId}/contacts`), status: 200, body: [] },
  ];
}

function mockLensResolution() {
  return {
    method: "GET" as const,
    path: "/1.5/users/me",
    status: 200,
    body: { id: "u", organization: { id: "org-1", name: "X" }, last_requested_lens: 42 },
  };
}

describe("leadbay_account_history", () => {
  it("happy path — bundles signals + full notes + activity timeline", async () => {
    mockHttp([
      mockLensResolution(),
      ...mockResearchSubResources(LEAD),
      // account-history's own notes read
      {
        method: "GET",
        path: `/1.5/leads/${LEAD}/notes`,
        status: 200,
        body: [
          { id: "n1", note: "Quoted in 2024, never closed.", created_at: "2024-03-01T00:00:00Z" },
          { id: "n2", note: "Won a public tender.", created_at: "2026-05-01T00:00:00Z" },
        ],
      },
      // account-history's own activities read (count=50 by default) — matched
      // specifically so it can't consume research's count=20 script.
      {
        method: "GET",
        path: new RegExp(`/1\\.5/leads/${LEAD}/activities\\?count=50`),
        status: 200,
        body: {
          items: [
            { lead_id: LEAD, type: "CONTACTED", date: "2024-03-02T00:00:00Z" },
            { lead_id: LEAD, type: "QUOTE_SENT", date: "2024-03-10T00:00:00Z" },
          ],
          pagination: { page: 0, pages: 1, total: 2 },
        },
      },
    ]);

    const res: any = await accountHistory.execute(newClient(), { leadId: LEAD });

    expect(res.lead).toEqual({ id: LEAD, name: "Acme" });
    expect(res.firmographics).toBeTruthy();
    expect(res.signals).toBeDefined();
    expect(res.notes).toHaveLength(2);
    expect(res.notes[1].note).toContain("public tender");
    expect(res.activities.total).toBe(2);
    expect(res.activities.activities).toEqual([
      { type: "CONTACTED", date: "2024-03-02T00:00:00Z" },
      { type: "QUOTE_SENT", date: "2024-03-10T00:00:00Z" },
    ]);
    expect(res._meta.notes_count).toBe(2);
  });

  it("partial failure — notes 500 degrades to [] but card still returns", async () => {
    mockHttp([
      mockLensResolution(),
      ...mockResearchSubResources(LEAD),
      { method: "GET", path: `/1.5/leads/${LEAD}/notes`, status: 500, body: { code: "ERR" } },
      {
        method: "GET",
        path: new RegExp(`/1\\.5/leads/${LEAD}/activities\\?count=50`),
        status: 200,
        body: { items: [{ lead_id: LEAD, type: "CONTACTED", date: "2024-03-02T00:00:00Z" }], pagination: { page: 0, pages: 1, total: 1 } },
      },
    ]);

    const res: any = await accountHistory.execute(newClient(), { leadId: LEAD });

    expect(res.notes).toEqual([]);
    expect(res._meta.notes_count).toBe(0);
    // the card still returns — research block is intact
    expect(res.lead.id).toBe(LEAD);
    expect(res.activities.total).toBe(1);
  });

  it("malformed-but-200 history — null/missing items degrade, don't throw", async () => {
    // The .catch() only covers REJECTED requests. A 200 with a malformed body
    // (notes = {} not an array, activities.items = null) must still degrade
    // to empty rather than throwing at .map / .length.
    mockHttp([
      mockLensResolution(),
      ...mockResearchSubResources(LEAD),
      { method: "GET", path: `/1.5/leads/${LEAD}/notes`, status: 200, body: {} },
      {
        method: "GET",
        path: new RegExp(`/1\\.5/leads/${LEAD}/activities\\?count=50`),
        status: 200,
        body: { items: null, pagination: null },
      },
    ]);

    const res: any = await accountHistory.execute(newClient(), { leadId: LEAD });

    expect(res.notes).toEqual([]);
    expect(res._meta.notes_count).toBe(0);
    expect(res.activities.activities).toEqual([]);
    expect(res.activities.total).toBe(0);
    expect(res._meta.activities_returned).toBe(0);
    // card still returns intact
    expect(res.lead.id).toBe(LEAD);
  });

  it("error — research itself 4xx propagates (load-bearing)", async () => {
    mockHttp([
      mockLensResolution(),
      { method: "POST", path: "/1.5/interactions", status: 200, body: {} },
      {
        method: "GET",
        path: new RegExp(`/1\\.5/lenses/42/leads/${LEAD}$`),
        status: 404,
        body: { code: "NOT_FOUND" },
      },
      // notes/activities still scripted (they fire in parallel before research
      // rejects) — both the research count=20 read and account-history's count=50.
      { method: "GET", path: `/1.5/leads/${LEAD}/notes`, status: 200, body: [] },
      { method: "GET", path: new RegExp(`/1\\.5/leads/${LEAD}/activities\\?count=20`), status: 200, body: { items: [], pagination: { total: 0 } } },
      { method: "GET", path: new RegExp(`/1\\.5/leads/${LEAD}/activities\\?count=50`), status: 200, body: { items: [], pagination: { total: 0 } } },
    ]);

    await expect(
      accountHistory.execute(newClient(), { leadId: LEAD })
    ).rejects.toThrow();
  });
});
