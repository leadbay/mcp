/**
 * product#4130 — a name-only lookup must not answer with a different company.
 *
 * /search/suggest returns leads whose name is merely spelled like the query
 * (trigram similarity > 0.3). On FR production, 2026-09-14, the tool took that
 * top hit as the answer: "THEOMA GESTION PRIVEE" came back as PILOTE GESTION
 * (similarity 0.321) and "SC2L FINANCE (SC2L FINANCE)" as VALOIS FINANCE
 * (0.400). The registry answers `none` for both. The lead ids below are the
 * real FR production ids of the two wrong cards.
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

const BASE = "https://api-fr.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "fr");

const PILOTE_GESTION = "f84bb4fb-c2c0-49b6-8b7f-e785e22f196a";
const VALOIS_FINANCE = "4601d061-7b87-4428-9ed8-06b4183acc15";

beforeEach(() => resetHttpMock());

const suggest = (q: string, body: unknown[]) => ({
  method: "GET" as const,
  path: `/1.6/search/suggest?q=${encodeURIComponent(q)}`,
  status: 200,
  body,
});

const companyHit = (text: string, leadId: string) => ({
  text,
  match_type: "COMPANY",
  lead_id: leadId,
  in_discover: true,
  in_monitor: false,
  in_activate: false,
  lens_id: "42",
});

const registryNone = {
  method: "POST" as const,
  path: "/1.6/leads/resolve",
  status: 200,
  body: { type: "none", would_help: ["website", "registry_number"] },
};

function byIdScripts(leadId: string, name: string) {
  return [
    { method: "POST" as const, path: "/1.6/interactions", status: 200, body: {} },
    {
      method: "GET" as const,
      path: `/1.6/lenses/42/leads/${leadId}`,
      status: 200,
      body: {
        id: leadId,
        name,
        score: null,
        ai_agent_lead_score: null,
        location: null,
        description: null,
        size: null,
        website: null,
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
    { method: "GET" as const, path: `/1.6/leads/${leadId}/ai_agent_responses`, status: 200, body: [] },
    { method: "GET" as const, path: new RegExp(`/1\\.6/leads/${leadId}/enrich/contacts`), status: 200, body: [] },
    { method: "GET" as const, path: `/1.6/leads/${leadId}/web_fetch`, status: 200, body: { content: null, fetch_at: null } },
    {
      method: "GET" as const,
      path: new RegExp(`/1\\.6/leads/${leadId}/activities`),
      status: 200,
      body: { items: [], pagination: { page: 0, pages: 1, total: 0 } },
    },
    { method: "GET" as const, path: new RegExp(`/1\\.6/leads/${leadId}/contacts`), status: 200, body: [] },
  ];
}

const leadFetched = (leadId: string) =>
  getHttpRequests().some((r) => r.path.includes(`/leads/${leadId}`));

describe("research_lead_by_name_fuzzy — a spelling-alike is not the company", () => {
  it("THEOMA GESTION PRIVEE is not answered with PILOTE GESTION", async () => {
    mockHttp([
      suggest("THEOMA GESTION PRIVEE", [companyHit("PILOTE GESTION", PILOTE_GESTION)]),
      registryNone,
    ]);

    await expect(
      researchLeadByNameFuzzy.execute(newClient(), { companyName: "THEOMA GESTION PRIVEE" })
    ).rejects.toMatchObject({
      code: "LEAD_NOT_FOUND",
      message: expect.stringContaining("in your visible Leadbay leads and in the Leadbay company registry"),
    });
    expect(leadFetched(PILOTE_GESTION)).toBe(false);
  });

  it("SC2L FINANCE (SC2L FINANCE) is not answered with VALOIS FINANCE", async () => {
    mockHttp([
      suggest("SC2L FINANCE (SC2L FINANCE)", [companyHit("VALOIS FINANCE", VALOIS_FINANCE)]),
      registryNone,
    ]);

    await expect(
      researchLeadByNameFuzzy.execute(newClient(), { companyName: "SC2L FINANCE (SC2L FINANCE)" })
    ).rejects.toMatchObject({ code: "LEAD_NOT_FOUND" });
    expect(leadFetched(VALOIS_FINANCE)).toBe(false);
  });

  it("the same list format still finds a lead the user owns under that name", async () => {
    mockHttp([
      suggest("SC2L FINANCE (SC2L FINANCE)", [
        companyHit("SC2L FINANCE", "lead-sc2l"),
        companyHit("VALOIS FINANCE", VALOIS_FINANCE),
      ]),
      ...byIdScripts("lead-sc2l", "SC2L FINANCE"),
    ]);

    const res: any = await researchLeadByNameFuzzy.execute(newClient(), {
      companyName: "SC2L FINANCE (SC2L FINANCE)",
    });

    expect(res.firmographics.id).toBe("lead-sc2l");
    expect(res._meta.resolved_from).toBe("companyName");
    expect(res._meta.match_candidates).toEqual([]);
    expect(getHttpRequests().some((r) => r.path === "/1.6/leads/resolve")).toBe(false);
  });

  it("accents and case do not make the same name a different one", async () => {
    mockHttp([
      suggest("Société Générale", [companyHit("SOCIETE GENERALE", "lead-sg")]),
      ...byIdScripts("lead-sg", "SOCIETE GENERALE"),
    ]);

    const res: any = await researchLeadByNameFuzzy.execute(newClient(), {
      companyName: "Société Générale",
    });

    expect(res.firmographics.id).toBe("lead-sg");
  });

  it("a contact-name hit still resolves to that contact's company", async () => {
    mockHttp([
      suggest("Hugo Flusin", [
        {
          text: "Hugo Flusin",
          match_type: "PERSON",
          company_name: "ACME",
          lead_id: "lead-acme",
          lens_id: "42",
        },
      ]),
      ...byIdScripts("lead-acme", "ACME"),
    ]);

    const res: any = await researchLeadByNameFuzzy.execute(newClient(), {
      companyName: "Hugo Flusin",
    });

    expect(res.firmographics.id).toBe("lead-acme");
  });

  it("spelling-alikes are left out of match_candidates too", async () => {
    mockHttp([
      suggest("acme", [
        companyHit("Acme Corp", "lead-a"),
        companyHit("ACMA", "lead-b"),
        companyHit("Acme Labs", "lead-c"),
      ]),
      ...byIdScripts("lead-a", "Acme Corp"),
    ]);

    const res: any = await researchLeadByNameFuzzy.execute(newClient(), {
      companyName: "acme",
    });

    expect(res.firmographics.id).toBe("lead-a");
    expect(res._meta.match_candidates.map((c: any) => c.leadId)).toEqual(["lead-c"]);
  });
});
