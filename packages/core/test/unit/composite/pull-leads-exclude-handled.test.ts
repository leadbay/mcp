/**
 * product#4173 — a lead the user has already handled must not come back in the
 * next pull_leads.
 *
 * Measured on US staging 2026-09-17: after liking one Discover lead, noting a
 * second and putting a third in a campaign, all three were still in
 * `GET /lenses/{id}/leads/wishlist`. Only the next day's `replace_leads_daily`
 * job removes them, so every pull that day handed them back as new. (Disliked
 * and status-set leads already left at once.) The backend drops them now when
 * asked with `exclude_handled=true`; these assertions pin that pull_leads asks,
 * on every page and sort order.
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
import { pullLeads } from "../../../src/composite/pull-leads.js";

const BASE = "https://api-us.leadbay.app";
const LENS = 4173;
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
      pagination: { page: 0, pages: 3, total: 41 },
      computing_wishlist: false,
      computing_scores: false,
    },
  };
}

function wishlistQuery(): URLSearchParams {
  const req = getHttpRequests().find(
    (r) => r.method === "GET" && r.path.includes("/leads/wishlist")
  );
  expect(req, "pull_leads never read Discover").toBeDefined();
  return new URLSearchParams(req!.path.split("?")[1]);
}

describe("leadbay_pull_leads asks Discover to leave out handled leads", () => {
  it.each([
    ["default call", {}],
    ["a later page", { page: 2, count: 50 }],
    ["an explicit sort order", { order: "NAME:ASC" }],
  ])("%s sends exclude_handled=true", async (_label, params) => {
    mockHttp([
      wishlistOk(),
      { method: "GET", path: /\/ai_agent_responses$/, status: 200, body: [] },
      { method: "POST", path: "/1.6/interactions", status: 204, body: {} },
    ]);

    const result: any = await pullLeads.execute(newClient(), {
      lensId: LENS,
      ...params,
    });

    expect(wishlistQuery().get("exclude_handled")).toBe("true");
    expect(result.leads.map((l: any) => l.id)).toEqual(["lead-1"]);
  });
});
