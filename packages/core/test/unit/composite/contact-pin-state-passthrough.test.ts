/**
 * Pin state was invisible through the MCP.
 *
 * The backend's ContactPayload has carried `pinned` + `pinned_by_ai` all
 * along (routes/payloads/ContactPayload.kt, snake_cased on the wire), but
 * every MCP shaping site dropped both. An agent could pin a contact and then
 * had no way to read back whether it stuck — it could only infer the pin from
 * `recommended`, which also moves for reasons that have nothing to do with
 * pinning.
 *
 * The paid side is deliberately asymmetric: PaidContactPayload has no pin
 * state, because `POST /contacts/{id}/pin` resolves through org_contacts only
 * and answers 404 for a paid id. So a paid contact must NOT sprout a
 * `pinned: false` here — that would tell the agent it can unpin something it
 * was never able to pin.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { httpsMockFactory, mockHttp, resetHttpMock } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { researchLeadById } from "../../../src/composite/research-lead-by-id.js";
import { getContacts } from "../../../src/tools/get-contacts.js";

const BASE = "https://api-us.leadbay.app";
const LEAD = "lead-pin";
const LENS = 77;
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

// Two org contacts — one human-pinned, one not — plus an AI-pinned one, so
// `pinned` and `pinned_by_ai` are exercised independently of each other.
const ORG = [
  {
    id: "org-pinned",
    first_name: "Pinned",
    last_name: "Person",
    job_title: "COO",
    email: "pinned@acme.test",
    phone_number: null,
    linkedin_page: null,
    recommended: true,
    pinned: true,
    pinned_by_ai: false,
  },
  {
    id: "org-unpinned",
    first_name: "Unpinned",
    last_name: "Person",
    job_title: "CFO",
    email: "unpinned@acme.test",
    phone_number: null,
    linkedin_page: null,
    recommended: false,
    pinned: false,
    pinned_by_ai: false,
  },
  {
    id: "org-ai-pinned",
    first_name: "Ai",
    last_name: "Pinned",
    job_title: "CTO",
    email: "ai@acme.test",
    phone_number: null,
    linkedin_page: null,
    recommended: false,
    pinned: true,
    pinned_by_ai: true,
  },
];

// The backend emits no pin fields at all for paid candidates.
const PAID = [
  {
    id: "paid-candidate",
    first_name: "Paid",
    last_name: "Candidate",
    job_title: "VP Sales",
    email: null,
    phone_number: null,
    linkedin_page: "https://linkedin.com/in/paid-candidate",
    recommended: false,
    enrichment: { done: false },
  },
];

function subResources(org: unknown = ORG) {
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
        org_contacts_count: 3,
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
      body: org,
    },
  ];
}

const byId = (contacts: any[], id: string) => contacts.find((c) => c.id === id);

describe("research_lead_by_id — pin state survives the reachability merge", () => {
  it("org contacts carry pinned and pinned_by_ai exactly as the backend sent them", async () => {
    mockHttp(subResources());
    const res: any = await researchLeadById.execute(newClient(), {
      leadId: LEAD,
      lensId: LENS,
    });

    const all = [...res.contacts.reachable, ...res.contacts.candidates];
    expect(byId(all, "org-pinned")).toMatchObject({ pinned: true, pinned_by_ai: false });
    expect(byId(all, "org-unpinned")).toMatchObject({ pinned: false, pinned_by_ai: false });
    expect(byId(all, "org-ai-pinned")).toMatchObject({ pinned: true, pinned_by_ai: true });
  });

  it("paid candidates carry no pin state at all — they cannot be pinned", async () => {
    mockHttp(subResources());
    const res: any = await researchLeadById.execute(newClient(), {
      leadId: LEAD,
      lensId: LENS,
    });

    const paid = byId(
      [...res.contacts.reachable, ...res.contacts.candidates],
      "paid-candidate",
    );
    expect(paid.source).toBe("paid");
    expect(paid).not.toHaveProperty("pinned");
    expect(paid).not.toHaveProperty("pinned_by_ai");
  });

  it("an API build that omits the fields degrades to false, never undefined", async () => {
    const legacy = [{ ...ORG[1], pinned: undefined, pinned_by_ai: undefined }];
    delete (legacy[0] as any).pinned;
    delete (legacy[0] as any).pinned_by_ai;
    mockHttp(subResources(legacy));

    const res: any = await researchLeadById.execute(newClient(), {
      leadId: LEAD,
      lensId: LENS,
    });

    const c = byId([...res.contacts.reachable, ...res.contacts.candidates], "org-unpinned");
    expect(c.pinned).toBe(false);
    expect(c.pinned_by_ai).toBe(false);
  });

  it("markdown rendering marks the pinned contact so chat hosts show it too", async () => {
    mockHttp(subResources());
    const res: any = await researchLeadById.execute(newClient(), {
      leadId: LEAD,
      lensId: LENS,
      response_format: "markdown",
    });

    const md = typeof res === "string" ? res : res.markdown ?? JSON.stringify(res);
    expect(md).toContain("**Pinned Person** 📌");
    expect(md).not.toContain("**Unpinned Person** 📌");
  });

  it("marks a pinned org contact that has no email or phone", async () => {
    // Reachability, not source, decides the partition — so a pinned org
    // contact with no channel yet renders under `candidates`. Marking only
    // the `reachable` list would hide the pin for exactly the contacts a rep
    // pins BEFORE enriching them.
    const unreachablePinned = [
      {
        id: "org-pinned-no-channel",
        first_name: "Channelless",
        last_name: "Pinned",
        job_title: "Directeur Général",
        email: null,
        phone_number: null,
        linkedin_page: null,
        recommended: true,
        pinned: true,
        pinned_by_ai: false,
      },
    ];
    mockHttp(subResources(unreachablePinned));

    const res: any = await researchLeadById.execute(newClient(), {
      leadId: LEAD,
      lensId: LENS,
      response_format: "markdown",
    });

    const md = typeof res === "string" ? res : res.markdown ?? JSON.stringify(res);
    expect(md).toContain("## Contacts — candidates (need enrichment)");
    expect(md).toContain("**Channelless Pinned** 📌");
  });

  it("keeps the pinned org contact in candidates when it has no channel", async () => {
    const unreachablePinned = [
      {
        id: "org-pinned-no-channel",
        first_name: "Channelless",
        last_name: "Pinned",
        job_title: "Directeur Général",
        email: null,
        phone_number: null,
        linkedin_page: null,
        recommended: true,
        pinned: true,
        pinned_by_ai: false,
      },
    ];
    mockHttp(subResources(unreachablePinned));

    const res: any = await researchLeadById.execute(newClient(), {
      leadId: LEAD,
      lensId: LENS,
    });

    expect(byId(res.contacts.reachable, "org-pinned-no-channel")).toBeUndefined();
    expect(byId(res.contacts.candidates, "org-pinned-no-channel")).toMatchObject({
      source: "org",
      pinned: true,
    });
  });
});

describe("get_contacts — pin state reaches the granular surface too", () => {
  it("passes pinned through on org contacts and omits it on paid ones", async () => {
    mockHttp([
      {
        method: "GET",
        path: `/1.6/leads/${LEAD}/contacts?IncludeEnriched=true`,
        status: 200,
        body: ORG,
      },
      {
        method: "GET",
        path: `/1.6/leads/${LEAD}/enrich/contacts?IncludeEnriched=true`,
        status: 200,
        body: PAID,
      },
    ]);

    const res: any = await getContacts.execute(newClient(), { leadId: LEAD });

    expect(byId(res.contacts, "org-pinned")).toMatchObject({
      pinned: true,
      pinned_by_ai: false,
      source: "org",
    });
    expect(byId(res.contacts, "org-ai-pinned")).toMatchObject({
      pinned: true,
      pinned_by_ai: true,
    });
    const paid = byId(res.contacts, "paid-candidate");
    expect(paid.source).toBe("paid");
    expect(paid).not.toHaveProperty("pinned");
  });
});
