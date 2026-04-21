/**
 * Tests for leadbay_get_lead_profile (protocol-agnostic Tool shape).
 * Critical invariants: lead-fetch failure is fatal; the other four sub-requests
 * degrade to partial results; contact merge tags source correctly.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { getLeadProfile } from "../../../src/tools/get-lead-profile.js";

const BASE = "https://api-us.leadbay.app";

const LENS = 7;
const LEAD = "lead-1";

const minimalLead = {
  id: LEAD,
  name: "Acme Corp",
  score: 80,
  ai_agent_lead_score: 75,
  location: "SF",
  description: "desc",
  short_description: "short",
  size: "50-200",
  website: "acme.com",
  logo: "logo.png",
  ai_summary: null,
  split_ai_summary: null,
  tags: [],
  phone_numbers: [],
  keywords: [],
  contacts_count: 3,
  recommended_contact_title: null,
  recommended_contact: null,
  web_fetch_in_progress: false,
};

beforeEach(() => {
  resetHttpMock();
});

function client() {
  return new LeadbayClient(BASE, "u.test-token");
}

describe("leadbay_get_lead_profile — success path", () => {
  it("returns all sections when every sub-request succeeds", async () => {
    mockHttp([
      { method: "GET", path: `/1.5/lenses/${LENS}/leads/${LEAD}`, status: 200, body: minimalLead },
      {
        method: "GET",
        path: `/1.5/leads/${LEAD}/ai_agent_responses`,
        status: 200,
        body: [
          {
            question: "Is it a good fit?",
            score: 90,
            response: "yes",
            computed_at: "2026-04-20",
            outdated_at: null,
          },
        ],
      },
      {
        method: "GET",
        path: `/1.5/leads/${LEAD}/contacts?IncludeEnriched=true`,
        status: 200,
        body: [
          {
            id: "c-org-1",
            first_name: "Jane",
            last_name: "Doe",
            email: "jane@acme.com",
            job_title: "CTO",
            recommended: true,
            enrichment: null,
          },
        ],
      },
      {
        method: "GET",
        path: `/1.5/leads/${LEAD}/enrich/contacts?IncludeEnriched=true`,
        status: 200,
        body: [
          {
            id: "c-paid-1",
            first_name: "Bob",
            last_name: "Smith",
            email: "bob@acme.com",
            job_title: "VP Eng",
            recommended: false,
            enrichment: null,
          },
        ],
      },
      {
        method: "GET",
        path: `/1.5/leads/${LEAD}/web_fetch`,
        status: 200,
        body: {
          content: { company_profile: "profile text" },
          fetch_at: "2026-04-20T00:00:00Z",
        },
      },
    ]);
    const result: any = await getLeadProfile.execute(client(), {
      leadId: LEAD,
      lensId: LENS,
    });

    expect(result.lead.name).toBe("Acme Corp");
    expect(result.qualification).toHaveLength(1);
    expect(result.contacts).toHaveLength(2);
    expect(result.web_insights).toEqual({ company_profile: "profile text" });
  });
});

describe("leadbay_get_lead_profile — partial-result resilience", () => {
  function baseScripts(leadStatus = 200, leadBody: any = minimalLead) {
    return [
      {
        method: "GET",
        path: `/1.5/lenses/${LENS}/leads/${LEAD}`,
        status: leadStatus,
        body: leadBody,
      },
      {
        method: "GET",
        path: `/1.5/leads/${LEAD}/ai_agent_responses`,
        status: 200,
        body: [],
      },
      {
        method: "GET",
        path: `/1.5/leads/${LEAD}/contacts?IncludeEnriched=true`,
        status: 200,
        body: [],
      },
      {
        method: "GET",
        path: `/1.5/leads/${LEAD}/enrich/contacts?IncludeEnriched=true`,
        status: 200,
        body: [],
      },
      {
        method: "GET",
        path: `/1.5/leads/${LEAD}/web_fetch`,
        status: 200,
        body: { content: null, fetch_at: null },
      },
    ];
  }

  it("lead fetch rejects (fatal) → throws", async () => {
    mockHttp(baseScripts(404, { message: "no lead" }) as any);
    await expect(
      getLeadProfile.execute(client(), { leadId: LEAD, lensId: LENS })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("qualification rejects → qualification is null, other sections return", async () => {
    const scripts = baseScripts();
    scripts[1] = {
      method: "GET",
      path: `/1.5/leads/${LEAD}/ai_agent_responses`,
      status: 500,
      body: {} as any,
    };
    mockHttp(scripts as any);
    const result: any = await getLeadProfile.execute(client(), {
      leadId: LEAD,
      lensId: LENS,
    });
    expect(result.qualification).toBeNull();
    expect(result.lead.id).toBe(LEAD);
  });

  it("both contacts endpoints reject → contacts is empty array (not null)", async () => {
    const scripts = baseScripts();
    scripts[2] = {
      method: "GET",
      path: `/1.5/leads/${LEAD}/contacts?IncludeEnriched=true`,
      status: 500,
      body: {} as any,
    };
    scripts[3] = {
      method: "GET",
      path: `/1.5/leads/${LEAD}/enrich/contacts?IncludeEnriched=true`,
      status: 500,
      body: {} as any,
    };
    mockHttp(scripts as any);
    const result: any = await getLeadProfile.execute(client(), {
      leadId: LEAD,
      lensId: LENS,
    });
    expect(result.contacts).toEqual([]);
  });

  it("web_fetch rejects → web_insights is null", async () => {
    const scripts = baseScripts();
    scripts[4] = {
      method: "GET",
      path: `/1.5/leads/${LEAD}/web_fetch`,
      status: 500,
      body: {} as any,
    };
    mockHttp(scripts as any);
    const result: any = await getLeadProfile.execute(client(), {
      leadId: LEAD,
      lensId: LENS,
    });
    expect(result.web_insights).toBeNull();
  });
});

describe("leadbay_get_lead_profile — contact source tagging", () => {
  it("tags org contacts as 'org' and paid contacts as 'paid'", async () => {
    mockHttp([
      { method: "GET", path: `/1.5/lenses/${LENS}/leads/${LEAD}`, status: 200, body: minimalLead },
      { method: "GET", path: `/1.5/leads/${LEAD}/ai_agent_responses`, status: 200, body: [] },
      {
        method: "GET",
        path: `/1.5/leads/${LEAD}/contacts?IncludeEnriched=true`,
        status: 200,
        body: [{ id: "org1", first_name: "A", last_name: "B", recommended: false }],
      },
      {
        method: "GET",
        path: `/1.5/leads/${LEAD}/enrich/contacts?IncludeEnriched=true`,
        status: 200,
        body: [{ id: "paid1", first_name: "C", last_name: "D", recommended: true }],
      },
      {
        method: "GET",
        path: `/1.5/leads/${LEAD}/web_fetch`,
        status: 200,
        body: { content: null, fetch_at: null },
      },
    ]);
    const result: any = await getLeadProfile.execute(client(), {
      leadId: LEAD,
      lensId: LENS,
    });
    const sources = result.contacts.map((c: any) => c.source).sort();
    expect(sources).toEqual(["org", "paid"]);
    expect(result.contacts.find((c: any) => c.id === "org1").source).toBe("org");
    expect(result.contacts.find((c: any) => c.id === "paid1").source).toBe("paid");
  });
});
