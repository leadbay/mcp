/**
 * product#3997 — leadbay_update_contact returned 404 on every call ever made.
 *
 * Leadbay holds contacts in two id namespaces: `org_contacts` (the org's own
 * directory) and `paid_contacts` (enrichment results). `POST
 * /contacts/{id}/update` resolves only the first. research_lead_by_id merges
 * both endpoints into `reachable` / `candidates`, split by whether the person
 * is messagable — NOT by which namespace they came from — so the agent cannot
 * tell them apart unless every contact carries its `source`.
 *
 * These assert the provenance survives the merge in both partitions. Without
 * it the agent has a 50% chance of handing update_contact an id that can only
 * ever 404.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { httpsMockFactory, mockHttp, resetHttpMock } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { researchLeadById } from "../../../src/composite/research-lead-by-id.js";

const BASE = "https://api-us.leadbay.app";
const LEAD = "lead-3997";
const LENS = 41;
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

// A paid contact WITH channels (lands in `reachable`) and one WITHOUT (lands
// in `candidates`), plus an org contact — so both partitions are covered.
const PAID = [
  {
    id: "paid-reachable",
    first_name: "Paid",
    last_name: "Reachable",
    job_title: "CEO",
    email: "paid@acme.test",
    phone_number: null,
    linkedin_page: null,
    recommended: false,
    enrichment: { done: true },
  },
  {
    id: "paid-candidate",
    first_name: "Paid",
    last_name: "Candidate",
    job_title: "CTO",
    email: null,
    phone_number: null,
    linkedin_page: "https://linkedin.com/in/paid-candidate",
    recommended: false,
    enrichment: { done: false },
  },
];

const ORG = [
  {
    id: "org-reachable",
    first_name: "Org",
    last_name: "Reachable",
    job_title: "Head of Ops",
    email: "org@acme.test",
    phone_number: "+33100000000",
    linkedin_page: null,
    recommended: true,
  },
];

function subResources() {
  return [
    { method: "POST" as const, path: "/1.6/interactions", status: 200, body: {} },
    {
      method: "GET" as const,
      path: `/1.6/lenses/${LENS}/leads/${LEAD}`,
      status: 200,
      body: {
        id: LEAD,
        name: "Acme SA",
        score: 80,
        ai_agent_lead_score: 70,
        location: null,
        description: null,
        size: null,
        website: "acme.test",
        tags: [],
        keywords: [],
        notes_count: 0,
        epilogue_actions_count: 0,
        prospecting_actions_count: 0,
        org_contacts_count: 1,
        liked: false,
        disliked: false,
        new: false,
        recommended_contact: null,
      },
    },
    { method: "GET" as const, path: `/1.6/leads/${LEAD}/ai_agent_responses`, status: 200, body: [] },
    {
      method: "GET" as const,
      path: `/1.6/leads/${LEAD}/enrich/contacts?IncludeEnriched=true`,
      status: 200,
      body: PAID,
    },
    {
      method: "GET" as const,
      path: `/1.6/leads/${LEAD}/web_fetch`,
      status: 200,
      body: { content: null, fetch_at: null },
    },
    {
      method: "GET" as const,
      path: `/1.6/leads/${LEAD}/activities?count=20`,
      status: 200,
      body: { items: [], pagination: { page: 0, pages: 1, total: 0 } },
    },
    {
      method: "GET" as const,
      path: `/1.6/leads/${LEAD}/contacts?IncludeEnriched=true`,
      status: 200,
      body: ORG,
    },
  ];
}

describe("product#3997 — contact id provenance survives the reachability merge", () => {
  it("every contact in both partitions carries a source of org or paid", async () => {
    mockHttp(subResources());
    const res: any = await researchLeadById.execute(newClient(), {
      leadId: LEAD,
      lensId: LENS,
    });

    const all = [...res.contacts.reachable, ...res.contacts.candidates];
    expect(all).toHaveLength(3);
    for (const c of all) {
      expect(["org", "paid"]).toContain(c.source);
    }
  });

  it("the org-directory contact is the only one marked editable-namespace", async () => {
    mockHttp(subResources());
    const res: any = await researchLeadById.execute(newClient(), {
      leadId: LEAD,
      lensId: LENS,
    });

    const editable = [...res.contacts.reachable, ...res.contacts.candidates]
      .filter((c: any) => c.source === "org")
      .map((c: any) => c.id);
    // Exactly the id POST /contacts/{id}/update can resolve. The other two
    // live in paid_contacts and would 404 there.
    expect(editable).toEqual(["org-reachable"]);
  });

  it("a paid contact keeps source:paid even after enrichment moves it to reachable", async () => {
    mockHttp(subResources());
    const res: any = await researchLeadById.execute(newClient(), {
      leadId: LEAD,
      lensId: LENS,
    });

    // This is the case the reachability split hides: an enriched paid contact
    // sits next to an org contact in the SAME list, and only `source`
    // distinguishes them.
    const reachableIds = res.contacts.reachable.map((c: any) => c.id).sort();
    expect(reachableIds).toEqual(["org-reachable", "paid-reachable"]);
    const paidReachable = res.contacts.reachable.find(
      (c: any) => c.id === "paid-reachable"
    );
    expect(paidReachable.source).toBe("paid");
    expect(paidReachable.enrichment_done).toBe(true);
  });
});
