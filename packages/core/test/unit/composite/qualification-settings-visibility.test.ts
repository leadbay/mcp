import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { getQualificationQuestions } from "../../../src/composite/get-qualification-questions.js";
import { setQualificationQuestions } from "../../../src/composite/set-qualification-questions.js";

const BASE = "https://api-us.leadbay.app";
const ORG = "org-1";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

const me = {
  method: "GET" as const,
  path: "/1.6/users/me",
  status: 200,
  body: { id: "u-1", email: "rep@acme.com", admin: true, organization: { id: ORG, name: "Acme" } },
};

const org = (leaf: string) => new RegExp(`/1\\.6/organizations/${ORG}/${leaf}`);

// product#4139 — a user states a fit rule in chat and the agent has to decide
// whether the org's settings already cover it. That decision needs all three
// settings in one read: the questions, the ideal buyer profile the questions
// score against, and the free-text targeting prompt.
describe("leadbay_get_qualification_questions — the whole qualification setting", () => {
  it("returns the buyer profile and the targeting prompt alongside the questions", async () => {
    mockHttp([
      me,
      { method: "GET", path: org("ai_agent_questions"), status: 200, body: [{ question: "Is the company likely to run install crews?", created_at: "2026-05-30T00:00:00Z", lang: "en" }] },
      { method: "GET", path: org("ideal_buyer_profile"), status: 200, body: { summary: "Mid-market gym operators", key_characteristics: ["multi-club"], anti_patterns: ["flooring vendors"] } },
      { method: "GET", path: org("user_prompt"), status: 200, body: { prompt: "Avoid public-sector operators." } },
    ]);

    const res: any = await getQualificationQuestions.execute(newClient(), {});

    expect(res.count).toBe(1);
    expect(res.ideal_buyer_profile).toEqual({
      summary: "Mid-market gym operators",
      key_characteristics: ["multi-club"],
      anti_patterns: ["flooring vendors"],
    });
    expect(res.targeting_prompt).toBe("Avoid public-sector operators.");
  });

  it("a failing profile/prompt read nulls those fields and never hides the questions", async () => {
    mockHttp([
      me,
      { method: "GET", path: org("ai_agent_questions"), status: 200, body: [{ question: "Is the company likely to operate a warehouse?", created_at: "2026-05-30T00:00:00Z", lang: "en" }] },
      { method: "GET", path: org("ideal_buyer_profile"), status: 500, body: { error: "boom" } },
      { method: "GET", path: org("user_prompt"), status: 500, body: { error: "boom" } },
    ]);

    const res: any = await getQualificationQuestions.execute(newClient(), {});

    expect(res.qualification_questions).toHaveLength(1);
    expect(res.ideal_buyer_profile).toBeNull();
    expect(res.targeting_prompt).toBeNull();
  });

  it("an unset targeting prompt (204) reads as null, not as an error", async () => {
    mockHttp([
      me,
      { method: "GET", path: org("ai_agent_questions"), status: 200, body: [{ question: "Is the company likely to operate a warehouse?", created_at: "2026-05-30T00:00:00Z", lang: "en" }] },
      { method: "GET", path: org("ideal_buyer_profile"), status: 200, body: { summary: "", key_characteristics: [], anti_patterns: [] } },
      { method: "GET", path: org("user_prompt"), status: 204, body: null },
    ]);

    const res: any = await getQualificationQuestions.execute(newClient(), {});
    expect(res.targeting_prompt).toBeNull();
  });

  it("an empty catalog tells the caller what to propose, not just that it is empty", async () => {
    mockHttp([
      me,
      { method: "GET", path: org("ai_agent_questions"), status: 200, body: [] },
      { method: "GET", path: org("ideal_buyer_profile"), status: 200, body: { summary: "", key_characteristics: [], anti_patterns: [] } },
      { method: "GET", path: org("user_prompt"), status: 204, body: null },
    ]);

    const res: any = await getQualificationQuestions.execute(newClient(), {});
    expect(res.hint).toMatch(/firmographics alone/i);
    expect(res.hint).toMatch(/Is the company likely to/);
    expect(res.hint).toMatch(/different buying dimension/i);
  });
});

// The scorer reads public text it cannot verify, so a verifiable question
// ("Does the company ...?") marks nearly every lead no. We apply the change the
// user approved, then tell the caller which questions will score badly.
describe("leadbay_set_qualification_questions — form_warnings", () => {
  const readQuestions = (body: unknown[]) => ({
    method: "GET" as const,
    path: org("ai_agent_questions"),
    status: 200,
    body,
  });
  const writeOrg = { method: "POST" as const, path: new RegExp(`/1\\.6/organizations/${ORG}$`), status: 204, body: null };

  it("warns on a question that is not in the estimative form, and still applies it", async () => {
    mockHttp([me, readQuestions([]), writeOrg]);

    const res: any = await setQualificationQuestions.execute(newClient(), {
      add: ["Does the company run its own maintenance crew?"],
    });

    expect(res.changed).toBe(true);
    expect(res.count).toBe(1);
    expect(res.form_warnings).toHaveLength(1);
    expect(res.form_warnings[0]).toMatch(/estimative form/i);
    expect(res.form_warnings[0]).toMatch(/Is the company likely to/);
  });

  it("stays silent on questions that carry the estimative marker, English or French", async () => {
    mockHttp([me, readQuestions([]), writeOrg]);

    const res: any = await setQualificationQuestions.execute(newClient(), {
      questions: [
        "Is the company likely to run its own maintenance crew?",
        "L'entreprise est-elle susceptible d'exploiter plusieurs sites ?",
      ],
    });

    expect(res.changed).toBe(true);
    expect(res.form_warnings).toBeUndefined();
  });

  it("warns on a question over 120 characters", async () => {
    const long = "Is the company likely to " + "x".repeat(110) + "?";
    mockHttp([me, readQuestions([]), writeOrg]);

    const res: any = await setQualificationQuestions.execute(newClient(), { add: [long] });

    expect(res.changed).toBe(true);
    expect(res.form_warnings.join(" ")).toMatch(/under 120/);
  });

  it("an unconfirmed removal is still previewed, with no warnings for a write that did not happen", async () => {
    mockHttp([me, readQuestions([{ question: "Does the company run install crews?" }])]);

    const res: any = await setQualificationQuestions.execute(newClient(), {
      remove: ["Does the company run install crews?"],
    });

    expect(res.changed).toBe(false);
    expect(res.form_warnings).toBeUndefined();
    expect(res.hint).toMatch(/confirm:true/);
  });
});

// The 5-question ceiling has to be stated in the turn the user asks for an
// addition, not discovered from a rejected write (product#4139).
describe("leadbay_get_qualification_questions — slot accounting", () => {
  const read = (n: number) => [
    me,
    { method: "GET" as const, path: org("ai_agent_questions"), status: 200, body: Array.from({ length: n }, (_, i) => ({ question: `Is the company likely to do thing ${i}?`, created_at: "2026-05-30T00:00:00Z", lang: "en" })) },
    { method: "GET" as const, path: org("ideal_buyer_profile"), status: 200, body: { summary: "", key_characteristics: [], anti_patterns: [] } },
    { method: "GET" as const, path: org("user_prompt"), status: 204, body: null },
  ];

  it("a full set says so and hands the choice of what to drop to the user", async () => {
    mockHttp(read(5));
    const res: any = await getQualificationQuestions.execute(newClient(), {});
    expect(res.count).toBe(5);
    expect(res.hint).toMatch(/FULL/);
    expect(res.hint).toMatch(/SWAP/i);
    expect(res.hint).toMatch(/let THEM choose/i);
  });

  it("a partial set reports the free slots", async () => {
    mockHttp(read(2));
    const res: any = await getQualificationQuestions.execute(newClient(), {});
    expect(res.hint).toMatch(/3 of 5 slots are still free/);
  });
});

// Review findings on PR #239.
describe("leadbay_set_qualification_questions — warnings stay on what this call wrote", () => {
  const readQuestions = (body: unknown[]) => ({ method: "GET" as const, path: org("ai_agent_questions"), status: 200, body });
  const writeOrg = { method: "POST" as const, path: new RegExp(`/1\\.6/organizations/${ORG}$`), status: 204, body: null };

  it("does not re-flag an existing bare-form question the call left untouched", async () => {
    mockHttp([me, readQuestions([{ question: "Does the company run install crews?" }]), writeOrg]);

    const res: any = await setQualificationQuestions.execute(newClient(), {
      add: ["Is the company likely to operate a cold-storage plant?"],
    });

    expect(res.changed).toBe(true);
    expect(res.count).toBe(2);
    // The carried-over question is bare-form, but this call did not write it.
    // Nagging the user into rewording it is exactly what the tool tells the
    // agent NOT to do — a reword re-scores the whole pipeline for no change.
    expect(res.form_warnings).toBeUndefined();
  });

  it("still flags the bare-form question when a full replacement writes it", async () => {
    mockHttp([me, readQuestions([{ question: "Is the company likely to operate a warehouse?" }]), writeOrg]);

    const res: any = await setQualificationQuestions.execute(newClient(), {
      questions: ["Does the company run install crews?"],
      confirm: true,
    });

    expect(res.changed).toBe(true);
    expect(res.form_warnings).toHaveLength(1);
    expect(res.form_warnings[0]).toMatch(/install crews/);
  });
});

describe("leadbay_get_qualification_questions — a full set never tells a non-admin to write", () => {
  const read = (n: number, admin: boolean) => [
    { method: "GET" as const, path: "/1.6/users/me", status: 200, body: { id: "u-1", email: "rep@acme.com", admin, organization: { id: ORG, name: "Acme" } } },
    { method: "GET" as const, path: org("ai_agent_questions"), status: 200, body: Array.from({ length: n }, (_, i) => ({ question: `Is the company likely to do thing ${i}?`, created_at: "2026-05-30T00:00:00Z", lang: "en" })) },
    { method: "GET" as const, path: org("ideal_buyer_profile"), status: 200, body: { summary: "", key_characteristics: [], anti_patterns: [] } },
    { method: "GET" as const, path: org("user_prompt"), status: 204, body: null },
  ];

  it("a non-admin at the ceiling is told the set is full, not told to call the admin-only write", async () => {
    mockHttp(read(5, false));
    const res: any = await getQualificationQuestions.execute(newClient(), {});
    expect(res.is_admin).toBe(false);
    expect(res.hint).toMatch(/FULL/);
    expect(res.hint).toMatch(/org-admin action/);
    expect(res.hint).not.toMatch(/confirm:true/);
  });

  it("an admin at the ceiling still gets the swap instruction", async () => {
    mockHttp(read(5, true));
    const res: any = await getQualificationQuestions.execute(newClient(), {});
    expect(res.hint).toMatch(/confirm:true/);
  });
});
