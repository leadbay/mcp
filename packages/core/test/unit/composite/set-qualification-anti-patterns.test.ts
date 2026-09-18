// product#4170 — a dislike reason about a kind of company can become a negative
// criterion (anti-pattern) of the org's ideal buyer profile, which qualification
// scores against.
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { setQualificationQuestions } from "../../../src/composite/set-qualification-questions.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

const ORG = "org-1";
const me = (admin: boolean) => ({
  method: "GET",
  path: "/1.6/users/me",
  status: 200,
  body: { id: "u1", email: "u@x.co", admin, organization: { id: ORG } },
});
const QUESTIONS = {
  method: "GET",
  path: `/1.6/organizations/${ORG}/ai_agent_questions`,
  status: 200,
  body: [{ id: 1, question: "Is the company likely to run a gym?" }],
};
const IBP = {
  summary: "Independent gyms with 10–200 employees.",
  key_characteristics: ["Runs its own facility"],
  anti_patterns: ["Flooring manufacturers or direct competitors"],
  generated_at: "2026-09-18T01:46:26Z",
};
const GET_IBP = (body: unknown, status = 200) => ({
  method: "GET",
  path: `/1.6/organizations/${ORG}/ideal_buyer_profile`,
  status,
  body,
});
const POST_IBP = {
  method: "POST",
  path: `/1.6/organizations/${ORG}/ideal_buyer_profile`,
  status: 204,
  body: "",
};

beforeEach(() => resetHttpMock());

describe("leadbay_set_qualification_questions add_anti_patterns", () => {
  it("appends new criteria to the profile and posts it back whole", async () => {
    mockHttp([me(true), QUESTIONS, GET_IBP(IBP), POST_IBP]);

    const result = (await setQualificationQuestions.execute(newClient(), {
      add_anti_patterns: ["Franchise locations of national chains", " flooring manufacturers or direct competitors "],
    })) as Record<string, unknown>;

    expect(result).toMatchObject({
      changed: true,
      anti_patterns_added: ["Franchise locations of national chains"],
      anti_patterns: ["Flooring manufacturers or direct competitors", "Franchise locations of national chains"],
      count: 1,
    });
    const post = getHttpRequests().find((r) => r.method === "POST");
    expect(JSON.parse(post!.body as string)).toEqual({
      summary: IBP.summary,
      key_characteristics: IBP.key_characteristics,
      anti_patterns: ["Flooring manufacturers or direct competitors", "Franchise locations of national chains"],
    });
  });

  it("writes nothing when every criterion is already there", async () => {
    mockHttp([me(true), QUESTIONS, GET_IBP(IBP)]);

    const result = (await setQualificationQuestions.execute(newClient(), {
      add_anti_patterns: ["FLOORING MANUFACTURERS OR DIRECT COMPETITORS"],
    })) as Record<string, unknown>;

    expect(result.changed).toBe(false);
    expect(getHttpRequests().some((r) => r.method === "POST")).toBe(false);
  });

  it("a non-admin gets FORBIDDEN and nothing is read or written", async () => {
    mockHttp([me(false)]);

    const result = (await setQualificationQuestions.execute(newClient(), {
      add_anti_patterns: ["Consulting firms"],
    })) as Record<string, unknown>;

    expect(result).toMatchObject({ error: true, code: "FORBIDDEN" });
    expect(getHttpRequests().map((r) => r.path)).toEqual(["/1.6/users/me"]);
  });

  it("an org with no profile yet gets a hint and no write", async () => {
    mockHttp([me(true), QUESTIONS, GET_IBP("", 204)]);

    const result = (await setQualificationQuestions.execute(newClient(), {
      add_anti_patterns: ["Consulting firms"],
    })) as Record<string, unknown>;

    expect(result.changed).toBe(false);
    expect(String(result.hint)).toContain("no ideal buyer profile");
    expect(getHttpRequests().some((r) => r.method === "POST")).toBe(false);
  });

  it("cannot be combined with a question change", async () => {
    mockHttp([]);

    await expect(
      setQualificationQuestions.execute(newClient(), {
        add: ["Is the company likely to run a gym?"],
        add_anti_patterns: ["Consulting firms"],
      }),
    ).rejects.toMatchObject({ code: "QUALIFICATION_QUESTIONS_BAD_ARGS" });
    expect(getHttpRequests()).toHaveLength(0);
  });
});
