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
const Q1 = "Q one?";
const Q2 = "Q two?";
const Q3 = "Q three?";
const current = (qs: string[]) => ({
  method: "GET" as const,
  path: new RegExp(`/1\\.5/organizations/${ORG}/ai_agent_questions`),
  status: 200,
  body: qs.map((q) => ({ question: q, created_at: "2026-01-01T00:00:00Z", lang: "en" })),
});
const postOrg = () => ({ method: "POST" as const, path: new RegExp(`/1\\.5/organizations/${ORG}$`), status: 204, body: null });
const didPost = () => getHttpRequests().some((r) => r.method === "POST" && new RegExp(`/organizations/${ORG}$`).test(r.path));

// Regression: a remove+add (or `set`) that keeps the COUNT the same still drops
// a scoring question — must require confirm. The old guard only checked
// next.length < previousCount, so a same-count swap bypassed it.
describe("leadbay_set_qualification_questions — same-count swap needs confirm", () => {
  it("remove Q1 + add Q3 (2→2, but Q1 dropped) without confirm — previews, does NOT post", async () => {
    mockHttp([me(), current([Q1, Q2])]);
    const res: any = await setQualificationQuestions.execute(newClient(), { remove: [Q1], add: [Q3] });
    expect(res.changed).toBe(false);
    expect(res.hint).toMatch(/confirm:true/);
    expect(res.hint).toContain(Q1);
    expect(didPost()).toBe(false);
  });

  it("same swap WITH confirm — posts the new list", async () => {
    mockHttp([me(), current([Q1, Q2]), postOrg()]);
    const res: any = await setQualificationQuestions.execute(newClient(), { remove: [Q1], add: [Q3], confirm: true });
    expect(res.changed).toBe(true);
    expect(res.qualification_questions.map((q: any) => q.question)).toEqual([Q2, Q3]);
    expect(didPost()).toBe(true);
  });

  it("set replacing one question (same count, one dropped) without confirm — previews only", async () => {
    mockHttp([me(), current([Q1, Q2])]);
    const res: any = await setQualificationQuestions.execute(newClient(), { questions: [Q1, Q3] });
    expect(res.changed).toBe(false);
    expect(res.hint).toContain(Q2); // Q2 is the dropped one
    expect(didPost()).toBe(false);
  });

  it("pure add (no removal) still needs NO confirm", async () => {
    mockHttp([me(), current([Q1]), postOrg()]);
    const res: any = await setQualificationQuestions.execute(newClient(), { add: [Q2] });
    expect(res.changed).toBe(true);
    expect(didPost()).toBe(true);
  });
});
