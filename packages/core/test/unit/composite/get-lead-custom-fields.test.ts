import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, getHttpRequests, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { getLeadCustomFields } from "../../../src/composite/get-lead-custom-fields.js";

const BASE = "https://api-us.leadbay.app";
const LEAD = "lead-7";
const LENS = 42;
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

// lensId auto-resolves via /users/me.last_requested_lens (no /lenses scan).
function mockMe() {
  return {
    method: "GET" as const,
    path: "/1.5/users/me",
    status: 200,
    body: { id: "u-1", organization: { id: "org-1", name: "Acme" }, last_requested_lens: LENS },
  };
}

const SEEN = { method: "POST" as const, path: "/1.5/interactions", status: 200, body: {} };

// A lead detail with self-describing custom_fields entries (verified live shape).
function mockLead(customFields: unknown[]) {
  return {
    method: "GET" as const,
    path: new RegExp(`/1\\.5/lenses/${LENS}/leads/${LEAD}$`),
    status: 200,
    body: {
      id: LEAD,
      name: "Acme",
      score: 80,
      ai_agent_lead_score: null,
      location: null,
      description: null,
      size: null,
      website: "acme.com",
      tags: [],
      liked: false,
      disliked: false,
      contacts_count: 0,
      org_contacts_count: 0,
      custom_fields: customFields,
    },
  };
}

describe("leadbay_get_lead_custom_fields", () => {
  it("happy path — flattens self-describing entries to {id,name,type,value}, no catalog fetch", async () => {
    mockHttp([
      mockMe(),
      SEEN,
      mockLead([
        { field: { id: "12", name: "Account Tier", type: "TEXT" }, value: "Gold" },
        { field: { id: "13", name: "ARR", type: "PRICE", config: { currency: "USD" } }, value: "50000" },
      ]),
    ]);

    const res: any = await getLeadCustomFields.execute(newClient(), { leadId: LEAD });

    expect(res.lead_id).toBe(LEAD);
    expect(res.count).toBe(2);
    expect(res.custom_fields).toEqual([
      { id: "12", name: "Account Tier", type: "TEXT", value: "Gold" },
      { id: "13", name: "ARR", type: "PRICE", value: "50000" },
    ]);
    expect(res.hint).toBeUndefined();
    // No /crm/custom_fields fetch on the happy (self-describing) path.
    expect(getHttpRequests().some((r) => /\/crm\/custom_fields/.test(r.path))).toBe(false);
  });

  it("empty — no values returns [] plus the empty-state hint", async () => {
    mockHttp([mockMe(), SEEN, mockLead([])]);
    const res: any = await getLeadCustomFields.execute(newClient(), { leadId: LEAD });

    expect(res.custom_fields).toEqual([]);
    expect(res.count).toBe(0);
    expect(res.hint).toMatch(/no custom-field values/i);
  });

  it("fires LEAD_SEEN/LEAD_CLICKED on read", async () => {
    mockHttp([mockMe(), SEEN, mockLead([])]);
    await getLeadCustomFields.execute(newClient(), { leadId: LEAD });
    // The interaction POST is fire-and-forget — let the microtask settle.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const interactions = getHttpRequests().filter((r) => /\/interactions$/.test(r.path) && r.method === "POST");
    expect(interactions).toHaveLength(1);
    const events: Array<{ type: string }> = JSON.parse(interactions[0].body ?? "[]");
    const types = events.map((e) => e.type);
    expect(types).toContain("LEAD_SEEN");
    expect(types).toContain("LEAD_CLICKED");
  });

  it("explicit lensId bypasses lens resolution (lead fetched directly under the given lens)", async () => {
    // /me is mocked because withAgentMemoryMeta resolves it for the memory
    // summary — but lens resolution itself must NOT need it when lensId is given.
    mockHttp([mockMe(), SEEN, mockLead([{ field: { id: "12", name: "Tier", type: "TEXT" }, value: "A" }])]);
    const res: any = await getLeadCustomFields.execute(newClient(), { leadId: LEAD, lensId: LENS });

    expect(res.count).toBe(1);
    // The lead is fetched under the supplied lens id.
    expect(getHttpRequests().some((r) => new RegExp(`/lenses/${LENS}/leads/${LEAD}`).test(r.path))).toBe(true);
  });

  it("degraded — entry without embedded field, catalog fetch fails → null name + degradation hint", async () => {
    mockHttp([
      mockMe(),
      SEEN,
      mockLead([{ id: "99", value: "orphan" }]),
      { method: "GET" as const, path: new RegExp(`/1\\.5/crm/custom_fields`), status: 500, body: { error: "boom" } },
    ]);

    const res: any = await getLeadCustomFields.execute(newClient(), { leadId: LEAD });

    expect(res.custom_fields).toHaveLength(1);
    expect(res.custom_fields[0]).toMatchObject({ id: "99", name: null, value: "orphan" });
    expect(res.hint).toMatch(/could not be named/i);
  });
});
