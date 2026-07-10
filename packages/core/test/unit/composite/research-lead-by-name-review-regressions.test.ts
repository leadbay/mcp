/**
 * Regression coverage for PR review findings on corpus resolution.
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

function profileScripts(leadId: string, lensId: number, name: string) {
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
        website: "example.com",
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

function activeLensScript(lensId = 42) {
  return {
    method: "GET" as const,
    path: "/1.6/users/me",
    status: 200,
    body: {
      id: "u",
      organization: { id: "org-1", name: "X" },
      last_requested_lens: lensId,
    },
  };
}

describe("research_lead_by_name_fuzzy review regressions", () => {
  it("preserves an explicit lens's server-filtered normalized match", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/lenses/55/leads/wishlist?q=tss.llc&count=50&page=0&contacts=false",
        status: 200,
        body: {
          items: [{ id: "lead-tss", name: "TSS, LLC", score: 91 }],
          pagination: { page: 0, pages: 1, total: 1 },
        },
      },
      activeLensScript(999),
      ...profileScripts("lead-tss", 55, "TSS, LLC"),
    ]);

    const result: any = await researchLeadByNameFuzzy.execute(newClient(), {
      companyName: "tss.llc",
      lensId: 55,
    });

    expect(result.firmographics.id).toBe("lead-tss");
    expect(result._meta.lens_id).toBe(55);
  });

  it("falls back on Node transport errors even when they have a code", async () => {
    const reset = Object.assign(new Error("socket reset"), {
      code: "ECONNRESET",
    });
    mockHttp([
      {
        method: "GET",
        path: "/1.6/search/suggest?q=Acme",
        status: 0,
        error: reset,
      },
      activeLensScript(),
      {
        method: "GET",
        path: "/1.6/lenses/42/leads/wishlist?q=Acme&count=50&page=0&contacts=false",
        status: 200,
        body: {
          items: [{ id: "lead-acme", name: "Acme Corp", score: 80 }],
          pagination: { page: 0, pages: 1, total: 1 },
        },
      },
      ...profileScripts("lead-acme", 42, "Acme Corp"),
    ]);

    const result: any = await researchLeadByNameFuzzy.execute(newClient(), {
      companyName: "Acme",
    });

    expect(result.firmographics.id).toBe("lead-acme");
    expect(getHttpRequests().map((request) => request.path).slice(0, 3)).toEqual([
      "/1.6/search/suggest?q=Acme",
      "/1.6/users/me",
      "/1.6/lenses/42/leads/wishlist?q=Acme&count=50&page=0&contacts=false",
    ]);
  });

  it("keeps structured Leadbay API errors visible instead of falling back", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/search/suggest?q=Acme",
        status: 503,
        body: { message: "search unavailable" },
      },
    ]);

    await expect(
      researchLeadByNameFuzzy.execute(newClient(), { companyName: "Acme" })
    ).rejects.toMatchObject({ error: true, code: "API_ERROR" });
    expect(getHttpRequests()).toHaveLength(1);
  });

  it("reports a degraded active-lens miss without claiming a corpus search", async () => {
    const unavailable = Object.assign(new Error("dns unavailable"), {
      code: "ENOTFOUND",
    });
    mockHttp([
      {
        method: "GET",
        path: "/1.6/search/suggest?q=Missing",
        status: 0,
        error: unavailable,
      },
      activeLensScript(),
      {
        method: "GET",
        path: "/1.6/lenses/42/leads/wishlist?q=Missing&count=50&page=0&contacts=false",
        status: 200,
        body: {
          items: [{ id: "lead-other", name: "Initech", score: 90 }],
          pagination: { page: 0, pages: 1, total: 1 },
        },
      },
    ]);

    await expect(
      researchLeadByNameFuzzy.execute(newClient(), { companyName: "Missing" })
    ).rejects.toMatchObject({
      code: "LEAD_NOT_FOUND",
      message: expect.stringContaining("cross-tab search was unavailable"),
      hint: expect.stringContaining("Only active lens 42 was checked"),
    });
  });
});
