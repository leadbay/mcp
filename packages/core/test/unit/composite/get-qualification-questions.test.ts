import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, getHttpRequests, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { getQualificationQuestions } from "../../../src/composite/get-qualification-questions.js";

const BASE = "https://api-us.leadbay.app";
const ORG = "org-1";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

// resolveTasteProfile resolves the org id from /users/me, then fans out the
// three taste endpoints. resolveMe is also called for the is_admin flag (the
// /me read is cached, so it's hit once).
function mockMe(admin: boolean) {
  return {
    method: "GET" as const,
    path: "/1.5/users/me",
    status: 200,
    body: { id: "u-1", email: "rep@acme.com", admin, organization: { id: ORG, name: "Acme" } },
  };
}

const QUESTIONS = [
  { question: "Does the company run install crews?", created_at: "2026-05-30T00:00:00Z", lang: "en" },
  { question: "Does the company spec modular flooring?", created_at: "2026-05-30T00:00:01Z", lang: "en" },
];

function mockTaste(questions: unknown[]) {
  return [
    { method: "GET" as const, path: new RegExp(`/1\\.5/organizations/${ORG}/ideal_buyer_profile`), status: 200, body: { summary: "IBP", key_characteristics: [], anti_patterns: [] } },
    { method: "GET" as const, path: new RegExp(`/1\\.5/organizations/${ORG}/purchase_intent_tags`), status: 200, body: [{ tag: "expanding", display_name: "Expanding" }] },
    { method: "GET" as const, path: new RegExp(`/1\\.5/organizations/${ORG}/ai_agent_questions`), status: 200, body: questions },
  ];
}

describe("leadbay_get_qualification_questions", () => {
  it("happy path — returns only the questions with created_at + lang, no IBP/tags leak", async () => {
    mockHttp([mockMe(false), ...mockTaste(QUESTIONS)]);
    const res: any = await getQualificationQuestions.execute(newClient(), {});

    expect(res.qualification_questions).toHaveLength(2);
    expect(res.qualification_questions[0]).toEqual({
      question: "Does the company run install crews?",
      created_at: "2026-05-30T00:00:00Z",
      lang: "en",
    });
    expect(res.count).toBe(2);
    expect(res.is_admin).toBe(false);
    // The broader taste-profile fields must NOT be surfaced by this focused tool.
    expect(res.ideal_buyer_profile).toBeUndefined();
    expect(res.purchase_intent_tags).toBeUndefined();
    // No admin hint for a non-admin with questions present.
    expect(res.hint).toBeUndefined();
  });

  it("admin user — surfaces is_admin + points at the modify tool", async () => {
    mockHttp([mockMe(true), ...mockTaste(QUESTIONS)]);
    const res: any = await getQualificationQuestions.execute(newClient(), {});

    expect(res.is_admin).toBe(true);
    expect(res.hint).toMatch(/leadbay_set_qualification_questions/);
  });

  it("empty catalog — empty array + empty-state hint", async () => {
    mockHttp([mockMe(false), ...mockTaste([])]);
    const res: any = await getQualificationQuestions.execute(newClient(), {});

    expect(res.qualification_questions).toEqual([]);
    expect(res.count).toBe(0);
    expect(res.hint).toMatch(/No qualification questions/i);
  });

  it("does not POST anything (pure read)", async () => {
    mockHttp([mockMe(false), ...mockTaste(QUESTIONS)]);
    await getQualificationQuestions.execute(newClient(), {});
    const writes = getHttpRequests().filter((r) => r.method !== "GET");
    expect(writes).toHaveLength(0);
  });
});
