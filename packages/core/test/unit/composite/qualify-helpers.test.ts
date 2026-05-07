/**
 * Unit tests for the shared qualify helpers (composite/_qualify-helpers.ts).
 *
 * Covers fingerprintMapping (stable, sort-independent) and the basic shape
 * contract of fanOutWebFetchAndPoll / refreshLeadStates. Live HTTP is mocked.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import {
  fingerprintMapping,
  fanOutWebFetchAndPoll,
  refreshLeadStates,
} from "../../../src/composite/_qualify-helpers.js";

const BASE = "https://api-us.leadbay.app";

beforeEach(() => {
  resetHttpMock();
});

describe("fingerprintMapping", () => {
  it("is stable across key reordering", () => {
    const a = fingerprintMapping({ A: "LEAD_NAME", B: "LEAD_WEBSITE" });
    const b = fingerprintMapping({ B: "LEAD_WEBSITE", A: "LEAD_NAME" });
    expect(a).toBe(b);
  });
  it("differs when values differ", () => {
    const a = fingerprintMapping({ A: "LEAD_NAME" });
    const b = fingerprintMapping({ A: "LEAD_WEBSITE" });
    expect(a).not.toBe(b);
  });
  it("differs when keys differ", () => {
    const a = fingerprintMapping({ A: "LEAD_NAME" });
    const b = fingerprintMapping({ B: "LEAD_NAME" });
    expect(a).not.toBe(b);
  });
  it("returns a 32-char hex string", () => {
    const fp = fingerprintMapping({ A: "LEAD_NAME" });
    expect(fp).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("fanOutWebFetchAndPoll — happy path", () => {
  it("launches web_fetch on each leadId and polls until done", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.5/leads/lead-1/web_fetch?force_fetch=false",
        status: 204,
      },
      {
        method: "GET",
        path: "/1.5/leads/lead-1/web_fetch",
        status: 200,
        body: {
          lead_id: "lead-1",
          in_progress: false,
          fetch_at: "2026-05-04T00:00:00Z",
          content: { "🏢 company": [{ source: "x", description: "y" }] },
        },
      },
      {
        method: "GET",
        path: "/1.5/leads/lead-1/ai_agent_responses",
        status: 200,
        body: [
          {
            question: "Q1",
            question_created_at: "2026-05-04T00:00:00Z",
            lead_id: "lead-1",
            score: 10,
            response: "yes",
            computed_at: "2026-05-04T00:00:00Z",
          },
        ],
      },
    ]);
    const client = new LeadbayClient(BASE, "u.tok", "us");
    const out = await fanOutWebFetchAndPoll(client, ["lead-1"], {
      perLeadBudgetMs: 30_000,
      totalDeadlineMs: Date.now() + 30_000,
    });
    expect(out.results).toHaveLength(1);
    expect(out.results[0]._stillRunning).toBe(false);
    expect(out.results[0].lead_id).toBe("lead-1");
    expect(out.results[0].qualifications).toHaveLength(1);
    expect(out.results[0].qualifications[0].score).toBe(10);
    expect(out.results[0].signals_count).toBe(1);
    expect(out.failed).toEqual([]);
    expect(out.not_launched).toEqual([]);
    expect(out.quota_exceeded).toBe(false);
    expect(out.cancelled).toBe(false);
  });
});

describe("fanOutWebFetchAndPoll — quota_exceeded mid-fanout", () => {
  it("stops launching but polls already-launched leads", async () => {
    // First lead launches OK, second 429s. We expect to poll lead-1 still.
    mockHttp([
      {
        method: "POST",
        path: "/1.5/leads/lead-1/web_fetch?force_fetch=false",
        status: 204,
      },
      {
        method: "POST",
        path: "/1.5/leads/lead-2/web_fetch?force_fetch=false",
        status: 429,
        body: { error: "quota_exceeded" },
      },
      {
        method: "GET",
        path: "/1.5/leads/lead-1/web_fetch",
        status: 200,
        body: { lead_id: "lead-1", in_progress: false, fetch_at: null, content: null },
      },
      {
        method: "GET",
        path: "/1.5/leads/lead-1/ai_agent_responses",
        status: 200,
        body: [
          {
            question: "Q1",
            question_created_at: "2026-05-04T00:00:00Z",
            lead_id: "lead-1",
            score: 0,
            response: null,
            computed_at: null,
          },
        ],
      },
    ]);
    const client = new LeadbayClient(BASE, "u.tok", "us");
    const out = await fanOutWebFetchAndPoll(client, ["lead-1", "lead-2"], {
      perLeadBudgetMs: 10_000,
      totalDeadlineMs: Date.now() + 10_000,
    });
    expect(out.quota_exceeded).toBe(true);
    expect(out.results.map((r) => r.lead_id)).toEqual(["lead-1"]);
    expect(out.not_launched).toEqual(["lead-2"]);
  });
});

describe("sortQualifications", () => {
  it("sorts by catalog order, with non-cataloged appended alphabetical", async () => {
    const { sortQualifications, buildQuestionOrder } = await import(
      "../../../src/composite/_qualify-helpers.js"
    );
    const order = buildQuestionOrder([
      { question: "Are they enterprise?" },
      { question: "Do they use SaaS?" },
    ]);
    const quals = [
      { question: "ZZ orphan", score: 10 },
      { question: "Do they use SaaS?", score: -10 },
      { question: "Are they enterprise?", score: 20 },
      { question: "AA orphan", score: 0 },
    ];
    const sorted = sortQualifications(quals, order);
    expect(sorted.map((q) => q.question)).toEqual([
      "Are they enterprise?",
      "Do they use SaaS?",
      "AA orphan",
      "ZZ orphan",
    ]);
  });
  it("with empty catalog falls back to alphabetical", async () => {
    const { sortQualifications, buildQuestionOrder } = await import(
      "../../../src/composite/_qualify-helpers.js"
    );
    const sorted = sortQualifications(
      [
        { question: "B q" },
        { question: "A q" },
      ],
      buildQuestionOrder([])
    );
    expect(sorted.map((q) => q.question)).toEqual(["A q", "B q"]);
  });
});

describe("summarizeQualifications", () => {
  it("returns undefined for empty quals", async () => {
    const { summarizeQualifications } = await import(
      "../../../src/composite/_qualify-helpers.js"
    );
    expect(summarizeQualifications([])).toBeUndefined();
  });
  it("returns undefined when no scored qualifications", async () => {
    const { summarizeQualifications } = await import(
      "../../../src/composite/_qualify-helpers.js"
    );
    expect(
      summarizeQualifications([{ question: "Q1", score: null }])
    ).toBeUndefined();
  });
  it("composes a one-line summary from top-2 by absolute score", async () => {
    const { summarizeQualifications } = await import(
      "../../../src/composite/_qualify-helpers.js"
    );
    const out = summarizeQualifications([
      { question: "Q1", score: 20 },
      { question: "Q2", score: 0 },
      { question: "Q3", score: -10 },
      { question: "Q4", score: 10 },
    ]);
    expect(out).toBe(
      "answered 4/4 — strong positive on 'Q1', negative on 'Q3'"
    );
  });
});

describe("refreshLeadStates", () => {
  it("returns per-lead state without launching anything new", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/leads/lead-1/web_fetch",
        status: 200,
        body: {
          lead_id: "lead-1",
          in_progress: false,
          fetch_at: "2026-05-04T00:00:00Z",
          content: {},
        },
      },
      {
        method: "GET",
        path: "/1.5/leads/lead-1/ai_agent_responses",
        status: 200,
        body: [
          {
            question: "Q1",
            question_created_at: "2026-05-04T00:00:00Z",
            lead_id: "lead-1",
            score: 20,
            response: "strong yes",
            computed_at: "2026-05-04T00:00:00Z",
          },
        ],
      },
    ]);
    const client = new LeadbayClient(BASE, "u.tok", "us");
    const out = await refreshLeadStates(client, ["lead-1"]);
    expect(out).toHaveLength(1);
    expect(out[0]._stillRunning).toBe(false);
    expect(out[0].qualification_summary?.avg_qualification_boost).toBe(20);
    // Verify no POST was issued.
    const reqs = getHttpRequests();
    expect(reqs.some((r) => r.method === "POST")).toBe(false);
  });
});
