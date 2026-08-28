/**
 * product#4006 — leadbay_research_lead_by_name_fuzzy resolves against the
 * Leadbay company registry, not just the user's own leads.
 *
 * Before this change the tool only called GET /search/suggest — a typeahead
 * over leads the user already owns — so "look up <a company I don't have>"
 * failed 55% of the time.
 *
 * Every resolver fixture below is a verbatim response recorded against FR
 * staging (staging.api.leadbay.app, account milstan+homespirit.fr@leadbay.ai)
 * on 2026-08-28, including the real lead ids.
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
import {
  researchLeadByNameFuzzy,
  buildResolvePayload,
  businessDomainFromEmail,
} from "../../../src/composite/research-lead-by-name-fuzzy.js";

const BASE = "https://api-fr.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "fr");

const WINK = "8687529c-c0c8-401f-9528-46ff515f3431";

beforeEach(() => resetHttpMock());

const suggestMiss = (q: string) => ({
  method: "GET" as const,
  path: `/1.6/search/suggest?q=${encodeURIComponent(q)}`,
  status: 200,
  body: [],
});

const activeLens = (lensId = 6202) => ({
  method: "GET" as const,
  path: "/1.6/users/me",
  status: 200,
  body: {
    id: "u",
    organization: { id: "org-1", name: "Home Spirit" },
    last_requested_lens: lensId,
  },
});

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
        score: null,
        ai_agent_lead_score: null,
        location: {
          city: "Paris",
          country: "FR",
          full: "128, Rue La Boétie, 75008, Paris, France",
        },
        description: "Logiciel de recrutement (ATS).",
        size: { min: 6, max: 9 },
        website: "wink-lab.com",
        tags: [],
        keywords: [],
        notes_count: 0,
        epilogue_actions_count: 0,
        prospecting_actions_count: 0,
        org_contacts_count: 0,
        liked: false,
        disliked: false,
        new: true,
        recommended_contact: null,
      },
    },
    { method: "GET" as const, path: `/1.6/leads/${leadId}/ai_agent_responses`, status: 200, body: [] },
    {
      method: "GET" as const,
      path: `/1.6/leads/${leadId}/enrich/contacts?IncludeEnriched=true`,
      status: 200,
      body: [],
    },
    // Registry leads have no crawl yet — _by_id soft-fails this one.
    {
      method: "GET" as const,
      path: `/1.6/leads/${leadId}/web_fetch`,
      status: 404,
      body: { error: { code: "not_found", message: "fetch not found" } },
    },
    {
      method: "GET" as const,
      path: `/1.6/leads/${leadId}/activities?count=20`,
      status: 200,
      body: { items: [], pagination: { page: 0, pages: 0, total: 0 } },
    },
    {
      method: "GET" as const,
      path: `/1.6/leads/${leadId}/contacts?IncludeEnriched=true`,
      status: 200,
      body: [],
    },
  ];
}

describe("research_lead_by_name_fuzzy — registry resolution", () => {
  it("AC: name + domain for a company outside the corpus resolves (Wink Lab)", async () => {
    mockHttp([
      suggestMiss("Wink Lab"),
      {
        method: "POST",
        path: "/1.6/leads/resolve",
        status: 200,
        body: { type: "matched", lead_id: WINK, matched_on: ["website_exact"] },
      },
      activeLens(),
      ...profileScripts(WINK, 6202, "WINK"),
    ]);

    const res: any = await researchLeadByNameFuzzy.execute(newClient(), {
      companyName: "Wink Lab",
      website: "wink-lab.com",
    });

    expect(res.firmographics.id).toBe(WINK);
    expect(res._meta.resolved_from).toBe("resolver");
    expect(res._meta.resolved_query).toBe("Wink Lab");
    expect(res._meta.resolved_matched_on).toEqual(["website_exact"]);

    const resolveReq = getHttpRequests().find((r) => r.path === "/1.6/leads/resolve");
    expect(JSON.parse(resolveReq?.body ?? "{}")).toEqual({
      name: "Wink Lab",
      website: "wink-lab.com",
    });
  });

  it("AC: a contact email stands in for the domain (Julien's actual input)", async () => {
    mockHttp([
      suggestMiss("Wink Lab"),
      {
        method: "POST",
        path: "/1.6/leads/resolve",
        status: 200,
        body: { type: "matched", lead_id: WINK, matched_on: ["website_exact"] },
      },
      activeLens(),
      ...profileScripts(WINK, 6202, "WINK"),
    ]);

    const res: any = await researchLeadByNameFuzzy.execute(newClient(), {
      companyName: "Wink Lab",
      email: "hugo@wink-lab.com",
    });

    expect(res.firmographics.id).toBe(WINK);
    const resolveReq = getHttpRequests().find((r) => r.path === "/1.6/leads/resolve");
    expect(JSON.parse(resolveReq?.body ?? "{}")).toEqual({
      name: "Wink Lab",
      website: "wink-lab.com",
      email: "hugo@wink-lab.com",
    });
  });

  it("AC: a bare domain as companyName goes in `website`, never in `name`", async () => {
    // Measured on FR staging: {name:"<domain>"} costs 61.7s (backend fuzzy-name
    // timeout) and still answers `none`; {website:"<domain>"} answers in 133ms.
    mockHttp([
      suggestMiss("wink-lab.com"),
      {
        method: "POST",
        path: "/1.6/leads/resolve",
        status: 200,
        body: { type: "matched", lead_id: WINK, matched_on: ["website_exact"] },
      },
      activeLens(),
      ...profileScripts(WINK, 6202, "WINK"),
    ]);

    await researchLeadByNameFuzzy.execute(newClient(), {
      companyName: "wink-lab.com",
    });

    const resolveReq = getHttpRequests().find((r) => r.path === "/1.6/leads/resolve");
    const body = JSON.parse(resolveReq?.body ?? "{}");
    expect(body).toEqual({ website: "wink-lab.com" });
    expect(body.name).toBeUndefined();
  });

  it("AC: a misspelled company name still resolves when the domain is supplied", async () => {
    mockHttp([
      suggestMiss("Wink Labz"),
      {
        method: "POST",
        path: "/1.6/leads/resolve",
        status: 200,
        body: { type: "matched", lead_id: WINK, matched_on: ["website_exact"] },
      },
      activeLens(),
      ...profileScripts(WINK, 6202, "WINK"),
    ]);

    const res: any = await researchLeadByNameFuzzy.execute(newClient(), {
      companyName: "Wink Labz",
      website: "https://www.WINK-LAB.COM/",
    });

    expect(res.firmographics.id).toBe(WINK);
    const resolveReq = getHttpRequests().find((r) => r.path === "/1.6/leads/resolve");
    expect(JSON.parse(resolveReq?.body ?? "{}").website).toBe("wink-lab.com");
  });

  it("AC: a person name explains itself instead of dead-ending (Hugo Flusin)", async () => {
    mockHttp([
      suggestMiss("Hugo Flusin"),
      {
        method: "POST",
        path: "/1.6/leads/resolve",
        status: 200,
        body: { type: "none", would_help: ["website", "registry_number"] },
      },
    ]);

    await expect(
      researchLeadByNameFuzzy.execute(newClient(), { companyName: "Hugo Flusin" })
    ).rejects.toMatchObject({
      code: "LEAD_NOT_FOUND",
      hint: expect.stringContaining("website, registry_number"),
    });
  });

  it("AC: ambiguous returns named candidates to choose from (Guillaume & Co)", async () => {
    const a = "961bac3f-7c81-4d6c-9044-85f15859bbb9";
    const b = "6f9609d4-fa12-478d-8af6-d4343780a1a9";
    mockHttp([
      suggestMiss("Guillaume & Co"),
      {
        method: "POST",
        path: "/1.6/leads/resolve",
        status: 200,
        body: {
          type: "ambiguous",
          candidates: [
            { lead_id: a, score: 12, matched_on: ["name_exact"], lead_fields_populated: ["registry", "address"] },
            { lead_id: b, score: 12, matched_on: ["name_exact"], lead_fields_populated: ["registry"] },
          ],
        },
      },
      activeLens(),
      {
        method: "GET",
        path: `/1.6/lenses/6202/leads/${a}`,
        status: 200,
        body: {
          id: a,
          name: "GUILLAUME & CO",
          location: { city: "Laval", full: "Rue Crossardière, 53000, Laval, France" },
          registry_ids: { SIRENE: "907935449" },
        },
      },
      {
        method: "GET",
        path: `/1.6/lenses/6202/leads/${b}`,
        status: 200,
        body: {
          id: b,
          name: "GUILLAUME & CO",
          location: { country: "FR" },
          registry_ids: { SIRENE: "792171233" },
        },
      },
    ]);

    const res: any = await researchLeadByNameFuzzy.execute(newClient(), {
      companyName: "Guillaume & Co",
      website: "guillaume-et-co.fr",
    });

    expect(res.resolution).toBe("ambiguous");
    expect(res.candidates).toHaveLength(2);
    // Hydration is what makes the choice presentable — bare ids are not.
    expect(res.candidates[0]).toMatchObject({
      leadId: a,
      name: "GUILLAUME & CO",
      location: "Rue Crossardière, 53000, Laval, France",
    });
    expect(res.candidates[1]).toMatchObject({ leadId: b, name: "GUILLAUME & CO" });
    expect(res.firmographics).toBeUndefined();
  });

  it("a corpus hit never touches the resolver", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/search/suggest?q=Wink%20Lab",
        status: 200,
        body: [{ text: "WINK", lead_id: WINK, lens_id: "6202" }],
      },
      ...profileScripts(WINK, 6202, "WINK"),
    ]);

    const res: any = await researchLeadByNameFuzzy.execute(newClient(), {
      companyName: "Wink Lab",
      website: "wink-lab.com",
    });

    expect(res._meta.resolved_from).toBe("companyName");
    expect(
      getHttpRequests().some((r) => r.path === "/1.6/leads/resolve")
    ).toBe(false);
  });

  it("an explicit lensId stays a strict scope and skips the registry", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/lenses/55/leads/wishlist?q=Wink%20Lab&count=50&page=0&contacts=false",
        status: 200,
        body: { items: [], pagination: { page: 0, pages: 0, total: 0 } },
      },
    ]);

    await expect(
      researchLeadByNameFuzzy.execute(newClient(), {
        companyName: "Wink Lab",
        website: "wink-lab.com",
        lensId: 55,
      })
    ).rejects.toMatchObject({
      code: "LEAD_NOT_FOUND",
      message: expect.stringContaining("in lens 55"),
    });
    expect(getHttpRequests()).toHaveLength(1);
  });

  it("a structured resolver error surfaces instead of becoming a miss", async () => {
    mockHttp([
      suggestMiss("Acme"),
      {
        method: "POST",
        path: "/1.6/leads/resolve",
        status: 503,
        body: { message: "resolver unavailable" },
      },
    ]);

    await expect(
      researchLeadByNameFuzzy.execute(newClient(), { companyName: "Acme" })
    ).rejects.toMatchObject({ error: true, code: "API_ERROR" });
  });

  it("the empty-name guard names the parameters and the alternative", async () => {
    mockHttp([]);
    await expect(
      researchLeadByNameFuzzy.execute(newClient(), { companyName: "   " })
    ).rejects.toMatchObject({
      code: "INVALID_PARAMS",
      hint: expect.stringContaining("companyName"),
    });
    await expect(
      researchLeadByNameFuzzy.execute(newClient(), { companyName: "   " })
    ).rejects.toMatchObject({
      hint: expect.stringContaining("leadbay_research_lead_by_id"),
    });
    expect(getHttpRequests()).toHaveLength(0);
  });
});

describe("businessDomainFromEmail", () => {
  it("derives a company domain from a work address", () => {
    expect(businessDomainFromEmail("hugo@wink-lab.com")).toBe("wink-lab.com");
    expect(businessDomainFromEmail("g.franck@GUILLAUME-ET-CO.FR")).toBe(
      "guillaume-et-co.fr"
    );
  });

  it("ignores consumer mailboxes — a gmail address says nothing about the company", () => {
    for (const e of [
      "julien@gmail.com",
      "x@outlook.com",
      "y@yahoo.fr" /* not on the list — still a real domain */,
    ].slice(0, 2)) {
      expect(businessDomainFromEmail(e)).toBeNull();
    }
  });

  it("returns null for junk", () => {
    expect(businessDomainFromEmail(undefined)).toBeNull();
    expect(businessDomainFromEmail("not-an-email")).toBeNull();
    expect(businessDomainFromEmail("a@localhost")).toBeNull();
  });
});

describe("buildResolvePayload", () => {
  it("prefers an explicit website over both other sources", () => {
    expect(
      buildResolvePayload({
        query: "Acme",
        website: "acme.com",
        email: "x@other.com",
      })
    ).toEqual({ name: "Acme", website: "acme.com", email: "x@other.com" });
  });

  it("sends only ResolvePayload fields — the endpoint 400s on anything else", () => {
    const payload = buildResolvePayload({ query: "Acme", website: "acme.com" });
    expect(Object.keys(payload).sort()).toEqual(["name", "website"]);
  });

  it("omits website entirely when there is nothing to derive one from", () => {
    expect(buildResolvePayload({ query: "Guillaume & Co" })).toEqual({
      name: "Guillaume & Co",
    });
  });
});
