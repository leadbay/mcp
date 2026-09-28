/**
 * leadbay/mcp#254 — pull_leads hides the qualification answer that counts
 * against a lead.
 *
 * `summarise()` kept the average boost and the HIGHEST-scoring excerpt, so a
 * lead that answered 10 / -10 / 10 came back as avg 3.3 plus its best line,
 * and the -10 never reached the caller. `negative_answers` carries every
 * answer scored below zero, with its question, so the agent can show it and
 * the user can decide.
 *
 * `null` means nothing was checked (never qualified, still running, or the
 * read failed) — never `[]`, which would read as "nothing against this lead".
 * The four existing fields are read by triage boards already published, so
 * their values must not move.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { pullLeads } from "../../../src/composite/pull-leads.js";

const BASE = "https://api-us.leadbay.app";
const LENS = 254;
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

function wishlistOk() {
  return {
    method: "GET" as const,
    path: new RegExp(`^/1\\.6/lenses/${LENS}/leads/wishlist\\?`),
    status: 200,
    body: {
      items: [
        {
          id: "lead-1",
          name: "Company 1",
          score: 80,
          ai_agent_lead_score: null,
          location: "Austin, TX",
          description: null,
          size: null,
          website: "co1.com",
          tags: [],
          liked: false,
          disliked: false,
          new: true,
        },
      ],
      pagination: { page: 0, pages: 1, total: 1 },
      computing_wishlist: false,
      computing_scores: false,
    },
  };
}

function answer(question: string, score: number | null, response: string | null) {
  return {
    question,
    question_created_at: "2026-07-01T00:00:00Z",
    lead_id: "lead-1",
    score,
    response,
    computed_at: score == null ? null : "2026-09-17T00:00:00Z",
    outdated_at: null,
  };
}

async function summaryFor(aiAgentResponses: {
  status: number;
  body: unknown;
}): Promise<any> {
  mockHttp([
    wishlistOk(),
    { method: "GET", path: /\/ai_agent_responses$/, ...aiAgentResponses },
    { method: "POST", path: "/1.6/interactions", status: 204, body: {} },
  ]);
  const result: any = await pullLeads.execute(newClient(), { lensId: LENS });
  return result.leads[0].qualification_summary;
}

// The lead from the issue, production `us`, 2026-09-17, company removed.
const Q_B2B =
  "Is the company likely to sell B2B into fragmented SMB markets with low online visibility?";
const Q_FIELD =
  "Is the company likely to rely on territory/field sales across branches or regions?";
const Q_CRM =
  "Is the company likely to use a CRM/ERP that can export historical won/lost deal data?";
const R_B2B =
  "The company is a boutique recruiting/HR services firm targeting growing startups and scaling organizations, which supports B2B selling. However, the data indicates startup/SME clients rather than fragmented local SMB markets with low online visibility.";
const R_FIELD =
  "The available data describes a small boutique firm with 2–10 employees and no evidence of branches, depots, field reps, or regional territory ownership.";
const R_CRM = "Web data explicitly says the company uses CRM tools.";

describe("leadbay_pull_leads surfaces the answers that count against a lead", () => {
  it("lists the -10 answer with its question, and leaves the four existing fields as they were", async () => {
    const s = await summaryFor({
      status: 200,
      body: [answer(Q_B2B, 10, R_B2B), answer(Q_FIELD, -10, R_FIELD), answer(Q_CRM, 10, R_CRM)],
    });

    expect(s.negative_answers).toEqual([
      { question: Q_FIELD, boost_score: -10, excerpt: R_FIELD },
    ]);

    expect(s.answered).toBe(3);
    expect(s.total).toBe(3);
    expect(s.avg_qualification_boost).toBe(3.3);
    expect(s.best_response_excerpt).toBe(R_B2B.slice(0, 197) + "...");
  });

  it("cuts a long negative answer to the same 200 chars as the existing excerpt", async () => {
    const long = "x".repeat(250);
    const s = await summaryFor({ status: 200, body: [answer(Q_FIELD, -10, long)] });
    expect(s.negative_answers).toEqual([
      { question: Q_FIELD, boost_score: -10, excerpt: "x".repeat(197) + "..." },
    ]);
  });

  it("lists a negative answer that has no text, with a null excerpt", async () => {
    const s = await summaryFor({
      status: 200,
      body: [answer(Q_B2B, 10, R_B2B), answer(Q_FIELD, -10, null)],
    });
    expect(s.negative_answers).toEqual([{ question: Q_FIELD, boost_score: -10, excerpt: null }]);
  });

  it("lists every negative answer, in the order the API returned them", async () => {
    const s = await summaryFor({
      status: 200,
      body: [answer(Q_FIELD, -10, R_FIELD), answer(Q_CRM, 10, R_CRM), answer(Q_B2B, -10, R_B2B)],
    });
    expect(s.negative_answers.map((n: any) => n.question)).toEqual([Q_FIELD, Q_B2B]);
  });

  it("is attached in verbose mode too", async () => {
    mockHttp([
      wishlistOk(),
      { method: "GET", path: /\/ai_agent_responses$/, status: 200, body: [answer(Q_FIELD, -10, R_FIELD)] },
      { method: "POST", path: "/1.6/interactions", status: 204, body: {} },
    ]);
    const result: any = await pullLeads.execute(newClient(), { lensId: LENS, verbose: true });
    expect(result.leads[0].qualification_summary.negative_answers).toEqual([
      { question: Q_FIELD, boost_score: -10, excerpt: R_FIELD },
    ]);
  });

  it("is an empty list when every question was answered and none is negative", async () => {
    const s = await summaryFor({
      status: 200,
      body: [answer(Q_B2B, 10, R_B2B), answer(Q_FIELD, 0, R_FIELD), answer(Q_CRM, 20, R_CRM)],
    });
    expect(s.negative_answers).toEqual([]);
  });

  it("is an empty list on a partly answered lead, and answered < total says what is left", async () => {
    const s = await summaryFor({
      status: 200,
      body: [answer(Q_B2B, 10, R_B2B), answer(Q_FIELD, null, null), answer(Q_CRM, 10, R_CRM)],
    });
    expect(s.negative_answers).toEqual([]);
    expect(s.answered).toBe(2);
    expect(s.total).toBe(3);
  });
});

describe("leadbay_pull_leads never reports 'nothing against it' on a lead nobody checked", () => {
  it("is null on a never-qualified lead that returns no answers", async () => {
    const s = await summaryFor({ status: 200, body: [] });
    expect(s.negative_answers).toBeNull();
  });

  it("is null when every question is still unanswered", async () => {
    const s = await summaryFor({
      status: 200,
      body: [answer(Q_B2B, null, null), answer(Q_FIELD, null, null), answer(Q_CRM, null, null)],
    });
    expect(s.negative_answers).toBeNull();
  });

  it("is null when the answers could not be read", async () => {
    const s = await summaryFor({ status: 500, body: { code: "INTERNAL" } });
    expect(s.negative_answers).toBeNull();
    expect(s.answered).toBe(0);
  });
});
