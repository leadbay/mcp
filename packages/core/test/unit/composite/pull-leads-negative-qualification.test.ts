/**
 * Regression coverage for github.com/leadbay/mcp/issues/254.
 *
 * A positive average is not proof that every qualification answer passed. The
 * list response must retain each negative answer so callers can enforce an
 * explicit customer veto without paying for a second per-lead research call.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLogger,
  httpsMockFactory,
  mockHttp,
  resetHttpMock,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { pullLeads } from "../../../src/composite/pull-leads.js";

const BASE = "https://api-us.leadbay.app";
const LENS = 48189;
const LEAD = "lead-mixed-qualification";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

function wishlist() {
  return {
    method: "GET" as const,
    path: `/1.6/lenses/${LENS}/leads/wishlist?count=20&page=0&contacts=true&exclude_handled=true`,
    status: 200,
    body: {
      items: [
        {
          id: LEAD,
          name: "Example Company",
          score: 80,
          ai_agent_lead_score: 70,
          location: null,
          description: "A plausible prospect.",
          size: null,
          website: "example.com",
          logo: "https://example.com/logo.png",
          contacts_count: 0,
          org_contacts_count: 0,
          tags: [],
          recommended_contact: null,
          liked: false,
          disliked: false,
        },
      ],
      pagination: { page: 0, pages: 1, total: 1 },
      computing_wishlist: false,
      computing_scores: false,
    },
  };
}

function answer(score: number, question: string, response: string | null) {
  return {
    question,
    question_created_at: "2026-09-17T00:00:00Z",
    lead_id: LEAD,
    score,
    response,
    computed_at: "2026-09-17T00:00:00Z",
  };
}

function mockPull(responses: unknown, status = 200) {
  mockHttp([
    wishlist(),
    {
      method: "GET",
      path: `/1.6/leads/${LEAD}/ai_agent_responses`,
      status,
      body: responses,
    },
    { method: "POST", path: "/1.6/interactions", status: 204 },
  ]);
}

describe("leadbay_pull_leads negative qualification evidence", () => {
  it("keeps the -10 answer when +10, -10, +10 produces a positive average", async () => {
    mockPull([
      answer(10, "Does it sell B2B?", "It sells services to growing companies."),
      answer(
        -10,
        "Does it operate through branches or field sales?",
        "No evidence of branches, depots, field reps, or regional ownership.",
      ),
      answer(10, "Does it use a CRM?", "Its public material names a CRM product."),
    ]);

    const result: any = await pullLeads.execute(newClient(), { lensId: LENS });

    expect(result.leads[0].qualification_summary).toMatchObject({
      answered: 3,
      total: 3,
      avg_qualification_boost: 3.3,
      negative_answers: [
        {
          question: "Does it operate through branches or field sales?",
          boost_score: -10,
          explanation:
            "No evidence of branches, depots, field reps, or regional ownership.",
        },
      ],
    });
  });

  it("keeps every negative question and score when explanations are missing or bounded", async () => {
    const longExplanation = "x".repeat(240);
    const missingExplanation = answer(
      -10,
      "Does it have a documented buying process?",
      null,
    ) as Record<string, unknown>;
    delete missingExplanation.response;
    mockPull([
      answer(-10, "Is the company legally active?", longExplanation),
      answer(0, "Is its buying timing visible?", "No signal."),
      answer(-10, "Does it own a field-sales territory?", null),
      missingExplanation,
    ]);

    const result: any = await pullLeads.execute(newClient(), { lensId: LENS });
    const negatives = result.leads[0].qualification_summary.negative_answers;

    expect(negatives).toEqual([
      {
        question: "Is the company legally active?",
        boost_score: -10,
        explanation: `${"x".repeat(197)}...`,
      },
      {
        question: "Does it own a field-sales territory?",
        boost_score: -10,
        explanation: null,
      },
      {
        question: "Does it have a documented buying process?",
        boost_score: -10,
        explanation: null,
      },
    ]);
    expect(negatives[0].explanation).toHaveLength(200);
  });

  it("uses an empty negative_answers array only after a successful fetch", async () => {
    mockPull([
      answer(10, "Does it sell B2B?", "Yes."),
      answer(0, "Is its buying timing visible?", "No signal."),
    ]);

    const result: any = await pullLeads.execute(newClient(), { lensId: LENS });

    expect(result.leads[0].qualification_summary).toMatchObject({
      answered: 2,
      total: 2,
      negative_answers: [],
    });
  });

  it("returns null, not an empty negative list, when qualification could not be read", async () => {
    mockPull({ error: { code: "upstream_unavailable" } }, 503);
    const { logger, logs } = createLogger();

    const result: any = await pullLeads.execute(
      newClient(),
      { lensId: LENS },
      { logger },
    );

    expect(result.leads[0].qualification_summary).toBeNull();
    expect(logs).toEqual([
      expect.objectContaining({
        level: "warn",
        msg: expect.stringContaining("ai_agent_responses failed"),
      }),
    ]);
  });

  it.each([
    ["default", false],
    ["verbose", true],
  ])("returns negative evidence in %s mode", async (_label, verbose) => {
    mockPull([answer(-10, "Is it active?", "The registry says it is dissolved.")]);

    const result: any = await pullLeads.execute(newClient(), {
      lensId: LENS,
      verbose,
    });

    expect(result.leads[0].qualification_summary.negative_answers).toEqual([
      {
        question: "Is it active?",
        boost_score: -10,
        explanation: "The registry says it is dissolved.",
      },
    ]);
    expect(result.leads[0].logo).toBe(verbose ? "https://example.com/logo.png" : undefined);
    expect(result.leads[0]).not.toHaveProperty("qualification_answers");
  });
});
