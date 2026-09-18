// product#4167 — account_status is the first call for 17 of 33 occasional
// accounts, almost always as "am I connected?". It used to return nothing about
// what the account is configured to search for, so the agent could answer "yes"
// and nothing else. It now carries the org's four targeting settings.
//
// Response bodies below are the live shapes read on US staging (SnapLock org,
// 2026-09-17). Note `user_prompt` is the wire key, not `prompt`.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { accountStatus } from "../../../src/composite/account-status.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");
const ORG = "4bce7431-408a-422a-9771-9e7017843de8";
const org = (p: string) => `/1.6/organizations/${ORG}/${p}`;

const ME = {
  email: "lchristensen@snaplock.com",
  name: "Lauren",
  admin: false,
  manager: false,
  language: "en",
  organization: { id: ORG, name: "SnapLock Industries, Inc.", ai_agent_enabled: true, computing_intelligence: false },
  last_requested_lens: 4125,
};

const IBP = {
  summary:
    "The ideal buyer is a 30–160 employee operator that runs a customer-facing commercial facility where flooring takes visible abuse from traffic, rolling equipment, moisture, or repeated resets.",
  key_characteristics: ["30–160 employees and operates a customer-facing facility in the selected sectors"],
  anti_patterns: ["Flooring manufacturers or direct modular-flooring competitors"],
  generated_at: "2026-09-17T22:21:32.093101Z",
};
const QUESTIONS = [
  { question: "Is the company likely to operate customer-facing facilities where flooring affects safety and aesthetics?", created_at: "2026-05-24T06:24:42.098215Z", lang: "en" },
  { question: "Is the company likely to handle rolling loads (carts, racks, vehicles) that stress concrete/finished floors?", created_at: "2026-05-24T06:24:42.098251Z", lang: "en" },
];
const TAGS = [
  { id: 1056, display_name: "New Site Opening", tag: "new_site_opening", description: "Signals a new facility", score: 0.85, reasoning: "…" },
  { id: 1057, display_name: "Facility Remodel", tag: "facility_remodel", description: "Refresh of customer-facing areas", score: 0.9, reasoning: "…" },
];

const base = [
  { method: "GET", path: "/1.6/users/me", status: 200, body: ME },
  { method: "GET", path: org("quota_status"), status: 200, body: { user: { spend: [], resources: [] } } },
];

// The opener lchristensen@snaplock.com actually typed (issue #4167).
const CONNECTED = { triggered_by: "@Leadbay is my leadbay account connected?" } as any;

beforeEach(() => resetHttpMock());

describe("account_status — what the account is configured to search for (product#4167)", () => {
  it("a plain 'am I connected?' returns the org's buyer profile, targeting prompt, questions and buying signals", async () => {
    mockHttp([
      ...base,
      { method: "GET", path: org("ideal_buyer_profile"), status: 200, body: IBP },
      { method: "GET", path: org("user_prompt"), status: 200, body: { user_prompt: "Gyms and event venues in the US, not residential." } },
      { method: "GET", path: org("ai_agent_questions"), status: 200, body: QUESTIONS },
      { method: "GET", path: org("purchase_intent_tags"), status: 200, body: TAGS },
    ] as any);

    const r: any = await accountStatus.execute(newClient(), {}, CONNECTED);

    expect(r.search_configuration).toEqual({
      ideal_buyer_profile: {
        summary: IBP.summary,
        key_characteristics: IBP.key_characteristics,
        anti_patterns: IBP.anti_patterns,
      },
      targeting_prompt: "Gyms and event venues in the US, not residential.",
      qualification_questions: QUESTIONS.map((q) => q.question),
      purchase_intent_tags: ["New Site Opening", "Facility Remodel"],
    });
    // The lens gate (product#3761) is untouched: not asked, not shown.
    expect(r.last_requested_lens).toBeNull();
    expect(r.last_requested_lens_name).toBeNull();
  });

  it("nothing configured: 204s read as null, empty lists stay empty", async () => {
    mockHttp([
      ...base,
      { method: "GET", path: org("ideal_buyer_profile"), status: 204, body: null },
      { method: "GET", path: org("user_prompt"), status: 204, body: null },
      { method: "GET", path: org("ai_agent_questions"), status: 200, body: [] },
      { method: "GET", path: org("purchase_intent_tags"), status: 200, body: [] },
    ] as any);

    const r: any = await accountStatus.execute(newClient(), {}, CONNECTED);

    expect(r.search_configuration).toEqual({
      ideal_buyer_profile: null,
      targeting_prompt: null,
      qualification_questions: [],
      purchase_intent_tags: [],
    });
  });

  it("a failed read is null, never an empty list, and the account answer still comes back", async () => {
    mockHttp([
      ...base,
      { method: "GET", path: org("ideal_buyer_profile"), status: 200, body: IBP },
      { method: "GET", path: org("user_prompt"), status: 500, body: { error: "boom" } },
      { method: "GET", path: org("ai_agent_questions"), status: 500, body: { error: "boom" } },
      { method: "GET", path: org("purchase_intent_tags"), status: 403, body: {} },
    ] as any);

    const r: any = await accountStatus.execute(newClient(), {}, CONNECTED);

    expect(r.user.email).toBe("lchristensen@snaplock.com");
    expect(r.organization.name).toBe("SnapLock Industries, Inc.");
    expect(r.search_configuration.ideal_buyer_profile.summary).toBe(IBP.summary);
    expect(r.search_configuration.targeting_prompt).toBeNull();
    expect(r.search_configuration.qualification_questions).toBeNull();
    expect(r.search_configuration.purchase_intent_tags).toBeNull();
  });
});
