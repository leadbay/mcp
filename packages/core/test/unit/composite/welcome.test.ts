/**
 * leadbay_welcome — the welcome board's data: the greeting, what Leadbay's AI
 * learned about the business (the web app's welcome card), and the first-run
 * guess that leadbay_account_status carries too.
 *
 * New file — does not modify the account_status tests.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { welcome, WELCOME_STARTERS, LIVE_ONBOARDING_URL } from "../../../src/composite/welcome.js";
import { accountStatus } from "../../../src/composite/account-status.js";
import { isFirstRun } from "../../../src/composite/_first-run.js";
import { artifactKit } from "../../../src/tools/get-artifact-runtime.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");
const ORG = "org-welcome";
const org = (p: string) => `/1.6/organizations/${ORG}/${p}`;

const ME = {
  email: "camille@example.test",
  name: "Camille Durand",
  admin: false,
  manager: false,
  language: "fr",
  organization: { id: ORG, name: "Acme Flooring", ai_agent_enabled: true, computing_intelligence: true, onboarding_step: "FINISHED" },
  last_requested_lens: null,
};

const IBP = {
  summary: "Operators of customer-facing facilities where flooring takes visible abuse.",
  key_characteristics: ["30–160 employees"],
  anti_patterns: ["Flooring manufacturers"],
  generated_at: "2026-09-17T22:21:32Z",
};

function learned(overrides: Record<string, unknown> = {}) {
  return [
    { method: "GET", path: org("ideal_buyer_profile"), status: 200, body: IBP },
    { method: "GET", path: org("user_prompt"), status: 204, body: null },
    { method: "GET", path: org("ai_agent_questions"), status: 200, body: [{ question: "Do they run rolling loads?", created_at: "x", lang: "en" }] },
    { method: "GET", path: org("purchase_intent_tags"), status: 200, body: [{ id: 1, display_name: "New Site Opening", tag: "new_site_opening" }] },
    ...Object.values(overrides),
  ];
}

beforeEach(() => resetHttpMock());

describe("leadbay_welcome", () => {
  it("greets by first name and carries the web app's welcome card", async () => {
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: ME }, ...learned()] as any);
    const r: any = await welcome.execute(newClient(), {}, { triggered_by: "I'm new" } as any);

    expect(r.user).toEqual({ name: "Camille Durand", first_name: "Camille" });
    expect(r.organization).toEqual({ name: "Acme Flooring", computing_intelligence: true });
    expect(r.leadpass).toEqual({
      ideal_buyer_profile: { summary: IBP.summary, key_characteristics: IBP.key_characteristics, anti_patterns: IBP.anti_patterns },
      targeting_prompt: null,
      qualification_questions: ["Do they run rolling loads?"],
      purchase_intent_tags: ["New Site Opening"],
    });
    expect(r.board).toEqual({ template: "onboarding" });
    expect(r.live_onboarding_url).toBe(LIVE_ONBOARDING_URL);
  });

  it("offers the starters, the last one starting the guided tour", async () => {
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: ME }, ...learned()] as any);
    const r: any = await welcome.execute(newClient(), {}, undefined);
    expect(r.starters).toEqual(WELCOME_STARTERS);
    expect(r.starters.at(-1).say).toBe("Walk me through Leadbay");
    // A copy per call: the server writes _meta onto results in place.
    expect(r.starters[0]).not.toBe(WELCOME_STARTERS[0]);
  });

  it("a failed read leaves that section null — the board hides it, the call still answers", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: { ...ME, name: undefined } },
      { method: "GET", path: org("ideal_buyer_profile"), status: 500, body: {} },
      { method: "GET", path: org("user_prompt"), status: 204, body: null },
      { method: "GET", path: org("ai_agent_questions"), status: 500, body: {} },
      { method: "GET", path: org("purchase_intent_tags"), status: 200, body: [] },
    ] as any);
    const r: any = await welcome.execute(newClient(), {}, undefined);
    expect(r.user.first_name).toBeNull();
    expect(r.leadpass.ideal_buyer_profile).toBeNull();
    expect(r.leadpass.qualification_questions).toBeNull();
    expect(r.leadpass.purchase_intent_tags).toEqual([]);
  });

  it("the kit publishes the board with `room`, so its buttons can reach the chat", async () => {
    mockHttp([]);
    const r: any = await artifactKit.execute(newClient(), { template: "onboarding" }, undefined);
    expect(r.capabilities.room).toEqual({});
    expect(r.capabilities.mcp.servers[0]).toEqual({ server: "Leadbay", tools: ["leadbay_welcome", "leadbay_report_artifact_error"] });
  });

  it("the other boards still publish with the connector alone", async () => {
    mockHttp([]);
    const r: any = await artifactKit.execute(newClient(), { template: "triage_board" }, undefined);
    expect(Object.keys(r.capabilities)).toEqual(["mcp"]);
  });

  it("is read-only and never reaches outside the workspace", () => {
    expect(welcome.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
  });
});

describe("the first-run guess", () => {
  const me = (o: Record<string, unknown>, lens: unknown = "40005") =>
    ({ ...ME, last_requested_lens: lens, organization: { ...ME.organization, ...o } }) as any;

  it("is on for a user who has never opened a lens", () => {
    expect(isFirstRun(me({}, null))).toBe(true);
    const { last_requested_lens: _omitted, ...noLens } = ME;
    expect(isFirstRun(noLens as any)).toBe(true);
  });

  it("is on while the org's signup is still processing", () => {
    expect(isFirstRun(me({ onboarding_step: "PROCESSING" }))).toBe(true);
  });

  it("turns off once a lens has been opened and signup is done — or the backend sends no step", () => {
    expect(isFirstRun(me({ onboarding_step: "FINISHED" }))).toBe(false);
    expect(isFirstRun(me({ onboarding_step: undefined }))).toBe(false);
  });

  it("leadbay_account_status carries it, so a first conversation can open the board", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME },
      { method: "GET", path: org("quota_status"), status: 200, body: { user: { spend: [], resources: [] } } },
      ...learned(),
    ] as any);
    const r: any = await accountStatus.execute(newClient(), {}, { triggered_by: "hi" } as any);
    expect(r.first_run).toBe(true);
  });
});
