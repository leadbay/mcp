/**
 * The MCP must tell Leadbay which leads the user consumed.
 *
 * Two customer-visible defects, both measured on prod 2026-09-15:
 *
 *  1. Every `POST /interactions` the MCP has ever sent was answered
 *     `400 {"code":"bad_request","message":"… unknown key 'leadId'"}`. The wire
 *     fields are snake_case (`lead_id`, `lens_id`, api-specs
 *     backend/1.6/schemas/interactions/LeadSeenInteraction.yml); the MCP sent
 *     camelCase, and `.catch(() => {})` threw the 400 away. 6,324 calls from 52
 *     users since 2026-04-23 recorded nothing.
 *  2. `pull_leads` — the tool that actually shows a user their leads — reported
 *     nothing at all. `user_leads.stale_days` is written only by this POST, and
 *     three of the four passes in the backend's `replace_leads_daily` job
 *     (ReplaceLeads.kt:73-100) need that column. So the list never rotated:
 *     mathieu.istria@yourcall.ai pulled leads on 76 consecutive days and was
 *     handed the same 60 companies every time.
 *
 * These assertions are on the request BODY, not just the path — the existing
 * suites mock `POST /1.6/interactions` by method+path, so they stayed green
 * through all 145 days of the bug.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { pullLeads } from "../../../src/composite/pull-leads.js";
import { researchLeadById } from "../../../src/composite/research-lead-by-id.js";
import { getLeadCustomFields } from "../../../src/composite/get-lead-custom-fields.js";
import { getLeadProfile } from "../../../src/tools/get-lead-profile.js";

const BASE = "https://api-us.leadbay.app";
const LENS = 777;
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

const SEEN_OK = {
  method: "POST" as const,
  path: "/1.6/interactions",
  status: 204,
  body: {},
};

/** The interaction events the tool actually put on the wire. */
async function postedEvents(): Promise<Array<Record<string, unknown>>> {
  // Fire-and-forget — let the microtask queue drain.
  await new Promise((resolve) => setTimeout(resolve, 10));
  return getHttpRequests()
    .filter((r) => r.method === "POST" && /\/interactions$/.test(r.path))
    .flatMap((r) => JSON.parse(r.body ?? "[]"));
}

/**
 * The exact contract the backend enforces: `type`, `lead_id`, `lens_id`, and
 * nothing else. A camelCase key here is the 400.
 */
function expectWireShape(
  events: Array<Record<string, unknown>>,
  expected: Array<{ type: string; lead_id: string }>
) {
  expect(events).toHaveLength(expected.length);
  for (const e of events) {
    expect(Object.keys(e).sort()).toEqual(["lead_id", "lens_id", "type"]);
    expect(e.lens_id).toBe(String(LENS));
    expect(typeof e.lead_id).toBe("string");
  }
  expect(events.map((e) => ({ type: e.type, lead_id: e.lead_id }))).toEqual(
    expected
  );
}

function wishlist(leadIds: string[]) {
  return {
    method: "GET" as const,
    path: `/1.6/lenses/${LENS}/leads/wishlist?count=20&page=0&contacts=true`,
    status: 200,
    body: {
      items: leadIds.map((id, i) => ({
        id,
        name: `Company ${i}`,
        score: 80 - i,
        ai_agent_lead_score: null,
        location: "Austin, TX",
        description: null,
        size: null,
        website: `co${i}.com`,
        tags: [],
        liked: false,
        disliked: false,
        new: true,
        contacts_count: 0,
        org_contacts_count: 0,
      })),
      pagination: { page: 0, pages: 1, total: leadIds.length },
      computing_wishlist: false,
      computing_scores: false,
    },
  };
}

function qualificationReads(leadIds: string[]) {
  return leadIds.map((id) => ({
    method: "GET" as const,
    path: new RegExp(`/1\\.6/leads/${id}/ai_agent_responses$`),
    status: 200,
    body: [],
  }));
}

describe("pull_leads reports the leads it shows as LEAD_SEEN", () => {
  it("one LEAD_SEEN per returned lead, snake_case wire fields", async () => {
    const leadIds = ["lead-a", "lead-b", "lead-c"];
    mockHttp([SEEN_OK, wishlist(leadIds), ...qualificationReads(leadIds)]);

    await pullLeads.execute(newClient(), { lensId: LENS });

    expectWireShape(
      await postedEvents(),
      leadIds.map((lead_id) => ({ type: "LEAD_SEEN", lead_id }))
    );
  });

  it("empty page — no interaction POST at all", async () => {
    mockHttp([wishlist([])]);

    await pullLeads.execute(newClient(), { lensId: LENS });

    expect(await postedEvents()).toEqual([]);
  });

  it("a rejected interaction POST never breaks the pull, and is logged", async () => {
    const leadIds = ["lead-a"];
    const warn = vi.fn();
    mockHttp([
      {
        method: "POST",
        path: "/1.6/interactions",
        status: 400,
        body: { error: { code: "bad_request", message: "unknown key 'leadId'" } },
      },
      wishlist(leadIds),
      ...qualificationReads(leadIds),
    ]);

    const result: any = await pullLeads.execute(
      newClient(),
      { lensId: LENS },
      { logger: { warn } }
    );

    expect(result.leads).toHaveLength(1);
    await postedEvents();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("not recorded")
    );
  });
});

describe("the per-lead reads report LEAD_SEEN + LEAD_CLICKED", () => {
  const LEAD = "lead-x";

  it("research_lead_by_id", async () => {
    mockHttp([
      SEEN_OK,
      {
        method: "GET",
        path: new RegExp(`/1\\.6/lenses/${LENS}/leads/${LEAD}$`),
        status: 200,
        body: { id: LEAD, name: "Acme", score: 80, tags: [], liked: false, disliked: false, contacts_count: 0, org_contacts_count: 0 },
      },
      { method: "GET", path: new RegExp(`/1\\.6/leads/${LEAD}/ai_agent_responses$`), status: 200, body: [] },
      { method: "GET", path: new RegExp(`/1\\.6/leads/${LEAD}/contacts`), status: 200, body: [] },
      { method: "GET", path: new RegExp(`/1\\.6/leads/${LEAD}/enrich/contacts`), status: 200, body: [] },
      { method: "GET", path: new RegExp(`/1\\.6/leads/${LEAD}/web_fetch$`), status: 200, body: {} },
      { method: "GET", path: new RegExp(`/1\\.6/leads/${LEAD}/activities`), status: 200, body: { items: [] } },
    ]);

    await researchLeadById.execute(newClient(), { leadId: LEAD, lensId: LENS });

    expectWireShape(await postedEvents(), [
      { type: "LEAD_SEEN", lead_id: LEAD },
      { type: "LEAD_CLICKED", lead_id: LEAD },
    ]);
  });

  it("get_lead_profile", async () => {
    mockHttp([
      SEEN_OK,
      {
        method: "GET",
        path: new RegExp(`/1\\.6/lenses/${LENS}/leads/${LEAD}$`),
        status: 200,
        body: { id: LEAD, name: "Acme", score: 80, tags: [], contacts_count: 0 },
      },
      { method: "GET", path: new RegExp(`/1\\.6/leads/${LEAD}/ai_agent_responses$`), status: 200, body: [] },
      { method: "GET", path: new RegExp(`/1\\.6/leads/${LEAD}/contacts`), status: 200, body: [] },
      { method: "GET", path: new RegExp(`/1\\.6/leads/${LEAD}/enrich/contacts`), status: 200, body: [] },
      { method: "GET", path: new RegExp(`/1\\.6/leads/${LEAD}/web_fetch$`), status: 200, body: {} },
    ]);

    await getLeadProfile.execute(newClient(), { leadId: LEAD, lensId: LENS });

    expectWireShape(await postedEvents(), [
      { type: "LEAD_SEEN", lead_id: LEAD },
      { type: "LEAD_CLICKED", lead_id: LEAD },
    ]);
  });

  it("get_lead_custom_fields", async () => {
    mockHttp([
      SEEN_OK,
      {
        method: "GET",
        path: new RegExp(`/1\\.6/lenses/${LENS}/leads/${LEAD}$`),
        status: 200,
        body: {
          id: LEAD,
          name: "Acme",
          score: 80,
          tags: [],
          liked: false,
          disliked: false,
          contacts_count: 0,
          org_contacts_count: 0,
          custom_fields: [],
        },
      },
    ]);

    await getLeadCustomFields.execute(newClient(), { leadId: LEAD, lensId: LENS });

    expectWireShape(await postedEvents(), [
      { type: "LEAD_SEEN", lead_id: LEAD },
      { type: "LEAD_CLICKED", lead_id: LEAD },
    ]);
  });
});
