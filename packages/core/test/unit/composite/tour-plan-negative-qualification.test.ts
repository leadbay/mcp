/** The tour composite is the second runtime consumer of pull_leads results. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { httpsMockFactory, mockHttp, resetHttpMock } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { tourPlan } from "../../../src/composite/tour-plan.js";

const BASE = "https://api-us.leadbay.app";
const LEAD = "lead-austin-negative";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

function mockTour(qualificationBody: unknown, qualificationStatus = 200) {
  mockHttp([
    {
      method: "GET",
      path: /\/1\.6\/geo\/search/,
      status: 200,
      body: {
        results: [{ id: "100", country: "US", level: 8, name: "Austin", parent_ids: [] }],
        parents: [],
      },
    },
    { method: "POST", path: "/1.6/monitor/filter", status: 204 },
    {
      method: "GET",
      path: "/1.6/monitor/filter",
      status: 200,
      body: { criteria: [{ type: "location_ids", is_excluded: false, locations: ["100"] }] },
    },
    { method: "GET", path: /\/1\.6\/monitor\?/, status: 200, body: { items: [] } },
    { method: "GET", path: "/1.6/users/me", status: 200, body: { last_requested_lens: 5 } },
    { method: "GET", path: "/1.6/users/me", status: 200, body: { last_requested_lens: 5 } },
    {
      method: "GET",
      path: /\/1\.6\/lenses\/5\/leads\/wishlist/,
      status: 200,
      body: {
        items: [
          {
            id: LEAD,
            name: "Austin Example",
            score: 80,
            ai_agent_lead_score: 70,
            location: { city: "Austin", state: "Texas", country: "US", pos: [30.2672, -97.7431] },
            description: "A plausible prospect.",
            size: null,
            website: "example.com",
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
    },
    {
      method: "GET",
      path: `/1.6/leads/${LEAD}/ai_agent_responses`,
      status: qualificationStatus,
      body: qualificationBody,
    },
    { method: "POST", path: "/1.6/interactions", status: 204 },
  ]);
}

describe("leadbay_tour_plan negative qualification forwarding", () => {
  it("forwards the negative answers attached by its internal default pull_leads call", async () => {
    mockTour([
      {
        question: "Is the company legally active?",
        question_created_at: "2026-09-17T00:00:00Z",
        lead_id: LEAD,
        score: -10,
        response: "The registry says the entity is dissolved.",
        computed_at: "2026-09-17T00:00:00Z",
      },
    ]);

    const result: any = await tourPlan.execute(newClient(), { city: "Austin" });

    expect(result.discover_leads).toHaveLength(1);
    expect(result.discover_leads[0].qualification_summary.negative_answers).toEqual([
      {
        question: "Is the company legally active?",
        boost_score: -10,
        explanation: "The registry says the entity is dissolved.",
      },
    ]);
  });

  it("forwards null when the internal qualification fetch is unavailable", async () => {
    mockTour({ error: { code: "upstream_unavailable" } }, 503);

    const result: any = await tourPlan.execute(newClient(), { city: "Austin" });

    expect(result.discover_leads).toHaveLength(1);
    expect(result.discover_leads[0].qualification_summary).toBeNull();
  });
});
