import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, getHttpRequests, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { setQualificationQuestions } from "../../../src/composite/set-qualification-questions.js";

const BASE = "https://api-us.leadbay.app";
const ORG = "org-1";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

const me = () => ({
  method: "GET" as const,
  path: "/1.5/users/me",
  status: 200,
  body: { id: "u", organization: { id: ORG, name: "Acme" } },
});

const Q1 = "Does the company run install crews?";
const Q2 = "Does the company spec modular flooring?";

const currentQuestions = (qs: string[]) => ({
  method: "GET" as const,
  path: new RegExp(`/1\\.5/organizations/${ORG}/ai_agent_questions`),
  status: 200,
  body: qs.map((q) => ({ question: q, created_at: "2026-05-30T00:00:00Z", lang: "en" })),
});

const postOrg = () => ({
  method: "POST" as const,
  path: new RegExp(`/1\\.5/organizations/${ORG}$`),
  status: 204,
  body: null,
});

const postBody = () => {
  const p = getHttpRequests().find((r) => r.method === "POST" && new RegExp(`/organizations/${ORG}$`).test(r.path));
  return p ? JSON.parse(p.body ?? "{}") : null;
};

describe("leadbay_set_qualification_questions", () => {
  it("add — appends and posts the full ai_agent_lead_questions array", async () => {
    mockHttp([me(), currentQuestions([Q1]), postOrg()]);

    const res: any = await setQualificationQuestions.execute(newClient(), { add: [Q2] });

    expect(res.changed).toBe(true);
    expect(res.count).toBe(2);
    expect(res.previous_count).toBe(1);
    expect(res.qualification_questions.map((q: any) => q.question)).toEqual([Q1, Q2]);
    // Full-replace wire shape.
    expect(postBody()).toEqual({ ai_agent_lead_questions: [Q1, Q2] });
  });

  it("add duplicate — no-op, does not POST", async () => {
    mockHttp([me(), currentQuestions([Q1])]);

    const res: any = await setQualificationQuestions.execute(newClient(), { add: [Q1] });

    expect(res.changed).toBe(false);
    expect(res.hint).toMatch(/No change/i);
    expect(getHttpRequests().some((r) => r.method === "POST")).toBe(false);
  });

  it("remove without confirm — previews, does NOT post", async () => {
    mockHttp([me(), currentQuestions([Q1, Q2])]);

    const res: any = await setQualificationQuestions.execute(newClient(), { remove: [Q2] });

    expect(res.changed).toBe(false);
    expect(res.hint).toMatch(/confirm:true/);
    expect(res.hint).toContain(Q2);
    expect(getHttpRequests().some((r) => r.method === "POST")).toBe(false);
  });

  it("remove with confirm — posts the shrunk list", async () => {
    mockHttp([me(), currentQuestions([Q1, Q2]), postOrg()]);

    const res: any = await setQualificationQuestions.execute(newClient(), { remove: [Q2], confirm: true });

    expect(res.changed).toBe(true);
    expect(res.count).toBe(1);
    expect(postBody()).toEqual({ ai_agent_lead_questions: [Q1] });
  });

  it("full replace (set) with MORE questions needs no confirm", async () => {
    mockHttp([me(), currentQuestions([Q1]), postOrg()]);

    const res: any = await setQualificationQuestions.execute(newClient(), { questions: [Q1, Q2] });

    expect(res.changed).toBe(true);
    expect(res.count).toBe(2);
    expect(postBody()).toEqual({ ai_agent_lead_questions: [Q1, Q2] });
  });

  it("questions + add together — rejected (mutually exclusive)", async () => {
    mockHttp([]);
    await expect(
      setQualificationQuestions.execute(newClient(), { questions: [Q1], add: [Q2] })
    ).rejects.toThrow();
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("no args — rejected", async () => {
    mockHttp([]);
    await expect(setQualificationQuestions.execute(newClient(), {})).rejects.toThrow();
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("exceeding the 5-question cap — rejects with limit hint, no POST", async () => {
    mockHttp([me(), currentQuestions([Q1, Q2, "q3", "q4", "q5"])]);
    await expect(
      setQualificationQuestions.execute(newClient(), { add: ["q6"] })
    ).rejects.toThrow(/max 5/i);
    expect(getHttpRequests().some((r) => r.method === "POST")).toBe(false);
  });
});
