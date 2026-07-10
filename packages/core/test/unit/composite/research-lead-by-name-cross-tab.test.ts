/**
 * Regression coverage for cross-tab name resolution.
 *
 * The default lookup must use /search/suggest so a company in Monitor or
 * Activate is not hidden by the active lens's first wishlist page. Supplying
 * lensId is the one deliberate exception: it scopes resolution to that lens.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getHttpRequests,
  httpsMockFactory,
  mockHttp,
  resetHttpMock,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { researchLeadByNameFuzzy } from "../../../src/composite/research-lead-by-name-fuzzy.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

function mockByIdSubResources(leadId: string, lensId: number, name: string) {
  return [
    { method: "POST" as const, path: "/1.6/interactions", status: 200, body: {} },
    {
      method: "GET" as const,
      path: `/1.6/lenses/${lensId}/leads/${leadId}`,
      status: 200,
      body: {
        id: leadId,
        name,
        score: 80,
        ai_agent_lead_score: 70,
        location: null,
        description: null,
        size: null,
        website: "acme.example",
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
    {
      method: "GET" as const,
      path: `/1.6/leads/${leadId}/ai_agent_responses`,
      status: 200,
      body: [],
    },
    {
      method: "GET" as const,
      path: `/1.6/leads/${leadId}/enrich/contacts?IncludeEnriched=true`,
      status: 200,
      body: [],
    },
    {
      method: "GET" as const,
      path: `/1.6/leads/${leadId}/web_fetch`,
      status: 200,
      body: { content: null, fetch_at: null },
    },
    {
      method: "GET" as const,
      path: `/1.6/leads/${leadId}/activities?count=20`,
      status: 200,
      body: { items: [], pagination: { page: 0, pages: 1, total: 0 } },
    },
    {
      method: "GET" as const,
      path: `/1.6/leads/${leadId}/contacts?IncludeEnriched=true`,
      status: 200,
      body: [],
    },
  ];
}

describe("research_lead_by_name_fuzzy cross-tab resolution", () => {
  it("uses cross-tab search and the result's lens for a Monitor-only company", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/search/suggest?q=Acme%20Corp",
        status: 200,
        body: [
          {
            text: "Acme Corp",
            match_type: "COMPANY",
            lead_id: "lead-monitor",
            in_discover: false,
            in_monitor: true,
            in_activate: false,
            lens_id: "77",
          },
        ],
      },
      {
        method: "GET",
        path: "/1.6/users/me",
        status: 200,
        body: {
          id: "u",
          organization: { id: "org-1", name: "X" },
          last_requested_lens: 999,
        },
      },
      ...mockByIdSubResources("lead-monitor", 77, "Acme Corp"),
    ]);

    const result: any = await researchLeadByNameFuzzy.execute(newClient(), {
      companyName: "Acme Corp",
    });

    expect(result.firmographics.id).toBe("lead-monitor");
    expect(result._meta.lens_id).toBe(77);
    expect(result._meta.resolved_from).toBe("companyName");
    expect(result._meta.resolved_query).toBe("Acme Corp");
    expect(getHttpRequests()[0].path).toBe(
      "/1.6/search/suggest?q=Acme%20Corp"
    );
    expect(
      getHttpRequests().some((request) => request.path.includes("/wishlist"))
    ).toBe(false);
  });

  it("resolves a domain suggestion and falls back to the active lens only when the suggestion has no lens", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/search/suggest?q=monitor.example",
        status: 200,
        body: [
          {
            text: "monitor.example",
            matchType: "DOMAIN",
            companyName: "Monitor Only Incorporated",
            leadId: "lead-domain",
            inDiscover: false,
            inMonitor: true,
            inActivate: false,
            lensId: null,
          },
        ],
      },
      {
        method: "GET",
        path: "/1.6/users/me",
        status: 200,
        body: {
          id: "u",
          organization: { id: "org-1", name: "X" },
          last_requested_lens: 42,
        },
      },
      ...mockByIdSubResources(
        "lead-domain",
        42,
        "Monitor Only Incorporated"
      ),
    ]);

    const result: any = await researchLeadByNameFuzzy.execute(newClient(), {
      companyName: "  monitor.example  ",
    });

    expect(result.firmographics.id).toBe("lead-domain");
    expect(result._meta.resolved_query).toBe("monitor.example");
    expect(getHttpRequests()[0].path).toBe(
      "/1.6/search/suggest?q=monitor.example"
    );
  });

  it("treats an explicit lensId as a strict server-side search scope", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/lenses/55/leads/wishlist?q=Acme%20Corp&count=50&page=0&contacts=false",
        status: 200,
        body: {
          items: [{ id: "lead-scoped", name: "Acme Corp", score: 91 }],
          pagination: { page: 0, pages: 1, total: 1 },
          computing_wishlist: false,
          computing_scores: false,
        },
      },
      {
        method: "GET",
        path: "/1.6/users/me",
        status: 200,
        body: {
          id: "u",
          organization: { id: "org-1", name: "X" },
          last_requested_lens: 999,
        },
      },
      ...mockByIdSubResources("lead-scoped", 55, "Acme Corp"),
    ]);

    const result: any = await researchLeadByNameFuzzy.execute(newClient(), {
      companyName: "Acme Corp",
      lensId: 55,
    });

    expect(result.firmographics.id).toBe("lead-scoped");
    expect(result._meta.lens_id).toBe(55);
    expect(
      getHttpRequests().some((request) => request.path.includes("/search/"))
    ).toBe(false);
  });

  it("reports a cross-tab miss without resolving or scanning an active lens", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/search/suggest?q=Definitely%20Missing",
        status: 200,
        body: [],
      },
    ]);

    await expect(
      researchLeadByNameFuzzy.execute(newClient(), {
        companyName: "Definitely Missing",
      })
    ).rejects.toMatchObject({
      code: "LEAD_NOT_FOUND",
      message: expect.stringContaining("visible Leadbay leads"),
    });
    expect(getHttpRequests()).toHaveLength(1);
  });
});
