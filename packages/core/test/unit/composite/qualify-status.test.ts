/**
 * Unit tests for leadbay_qualify_status (composite).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { qualifyStatus } from "../../../src/composite/qualify-status.js";

const BASE = "https://api-us.leadbay.app";

function newClient() {
  return new LeadbayClient(BASE, "u.tok", "us");
}

beforeEach(() => {
  resetHttpMock();
});


describe("leadbay_qualify_status — happy path", () => {
  it("returns same shape as composite for a launched record", async () => {

    mockHttp([
      {
        method: "GET",
        path: "/1.6/leads/lead-1/web_fetch",
        status: 200,
        body: {
          lead_id: "lead-1",
          in_progress: false,
          fetch_at: "2026-05-04T00:00:00Z",
          content: { "🏢 company": [{ source: "site", description: "y" }] },
        },
      },
      {
        method: "GET",
        path: "/1.6/leads/lead-1/ai_agent_responses",
        status: 200,
        body: [
          {
            question: "Are they enterprise?",
            question_created_at: "2026-05-04T00:00:00Z",
            lead_id: "lead-1",
            score: 10,
            response: "yes",
            computed_at: "2026-05-04T00:00:00Z",
          },
        ],
      },
    ]);

    const out = await qualifyStatus.execute(
      newClient(),
      { lead_ids: ["lead-1"], lens_id: 21580 },
      { }
    );
    
    expect(out.status).toBe("launched");
    
    expect(out.lead_ids).toEqual(["lead-1"]);
    expect(out.qualified).toHaveLength(1);
    expect(out.qualified[0].qualifications).toHaveLength(1);
    expect(out.still_running).toEqual([]);
  });

  it("surfaces failed[] when both /web_fetch and /ai_agent_responses 404", async () => {

    mockHttp([
      { method: "GET", path: "/1.6/leads/lead-gone/web_fetch", status: 404 },
      { method: "GET", path: "/1.6/leads/lead-gone/ai_agent_responses", status: 404 },
    ]);

    const out = await qualifyStatus.execute(
      newClient(),
      { lead_ids: ["lead-gone"], lens_id: 21580 },
      { }
    );
    expect(out.qualified).toEqual([]);
    expect(out.still_running).toEqual([]);
    expect(out.failed).toEqual([{ lead_id: "lead-gone", error: "NOT_FOUND" }]);
  });

  it("surfaces still_running for in-flight leads", async () => {

    mockHttp([
      {
        method: "GET",
        path: "/1.6/leads/lead-1/web_fetch",
        status: 200,
        body: {
          lead_id: "lead-1",
          in_progress: true,
          fetch_at: null,
          content: null,
        },
      },
      {
        method: "GET",
        path: "/1.6/leads/lead-1/ai_agent_responses",
        status: 200,
        body: [],
      },
    ]);

    const out = await qualifyStatus.execute(
      newClient(),
      { lead_ids: ["lead-1"], lens_id: 21580 },
      { }
    );
    expect(out.qualified).toEqual([]);
    expect(out.still_running).toEqual([{ lead_id: "lead-1" }]);
  });
});
