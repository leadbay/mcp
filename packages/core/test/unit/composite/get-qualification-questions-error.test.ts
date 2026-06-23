import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { getQualificationQuestions } from "../../../src/composite/get-qualification-questions.js";

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

// Regression: a transient failure on the questions endpoint must SURFACE as an
// error, never be masked as "no questions configured" (which could lead a
// caller to overwrite an org's real questions). The tool fetches the endpoint
// directly rather than via resolveTasteProfile's Promise.allSettled (which
// substitutes [] on rejection).
describe("leadbay_get_qualification_questions — fetch failure surfaces", () => {
  it("ai_agent_questions 500 → throws, does NOT return empty", async () => {
    mockHttp([
      me(),
      { method: "GET", path: new RegExp(`/1\\.5/organizations/${ORG}/ai_agent_questions`), status: 500, body: { error: "boom" } },
    ]);
    await expect(getQualificationQuestions.execute(newClient(), {})).rejects.toThrow();
  });

  it("ai_agent_questions 401 → throws (auth failure not shown as empty)", async () => {
    mockHttp([
      me(),
      { method: "GET", path: new RegExp(`/1\\.5/organizations/${ORG}/ai_agent_questions`), status: 401, body: {} },
    ]);
    await expect(getQualificationQuestions.execute(newClient(), {})).rejects.toThrow();
  });

  it("genuine empty (200 + []) → returns empty with the no-questions hint", async () => {
    mockHttp([
      me(),
      { method: "GET", path: new RegExp(`/1\\.5/organizations/${ORG}/ai_agent_questions`), status: 200, body: [] },
    ]);
    const res: any = await getQualificationQuestions.execute(newClient(), {});
    expect(res.count).toBe(0);
    expect(res.hint).toMatch(/No qualification questions/i);
  });
});
