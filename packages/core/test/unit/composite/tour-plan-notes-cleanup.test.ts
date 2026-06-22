import { beforeEach, describe, expect, it, vi } from "vitest";
import { httpsMockFactory, mockHttp, resetHttpMock } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { tourPlan } from "../../../src/composite/tour-plan.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

/**
 * Regression for the live-eval finding (#3779): the contacts API can send the
 * literal string "null" for an empty name part, which produced map notes that
 * read "Reach null null". The map_locations notes must never surface that.
 */
function mockFanOut(monitorItems: unknown[]) {
  mockHttp([
    {
      method: "GET",
      path: /\/1\.5\/geo\/search/,
      status: 200,
      body: { results: [{ id: "100", country: "US", level: 8, name: "New York", parent_ids: [] }], parents: [] },
    },
    { method: "POST", path: "/1.5/monitor/filter", status: 204, body: "" },
    {
      method: "GET",
      path: "/1.5/monitor/filter",
      status: 200,
      body: { criteria: [{ type: "location_ids", is_excluded: false, locations: ["100"] }] },
    },
    { method: "GET", path: /\/1\.5\/monitor\?/, status: 200, body: { items: monitorItems } },
    { method: "GET", path: "/1.5/users/me", status: 200, body: { last_requested_lens: 5 } },
    { method: "GET", path: "/1.5/users/me", status: 200, body: { last_requested_lens: 5 } },
    {
      method: "GET",
      path: /\/1\.5\/lenses\/5\/leads\/wishlist/,
      status: 200,
      body: { items: [], computing_wishlist: false, computing_scoring: false },
    },
  ]);
}

describe("leadbay_tour_plan — notes never surface a 'null' name (#3779)", () => {
  it("drops the literal string 'null' from a contact name", async () => {
    const lead = {
      id: "m-null-str",
      name: "Stringy Null Co",
      location: { pos: [40.71, -74.0], full: "New York, NY, US", city: "New York" },
      recommended_contact: { first_name: "null", last_name: "null", job_title: "null" },
      split_ai_summary: { next_step: "Worth a stop" },
      last_monitor_action: "CONTACTED",
    };
    mockFanOut([lead]);

    const result: any = await tourPlan.execute(newClient(), { city: "New York" });

    expect(result.map_locations).toHaveLength(1);
    const notes = result.map_locations[0].notes;
    expect(notes).not.toContain("null");
    // With no usable name/channel, it falls back to the enrich prompt.
    expect(notes).toContain("Enrich a contact");
  });

  it("keeps a real first name when only the last name is the 'null' string", async () => {
    const lead = {
      id: "m-partial",
      name: "Partial Name Co",
      location: { pos: [40.71, -74.0], full: "New York, NY, US", city: "New York" },
      recommended_contact: { first_name: "Nick", last_name: "null", job_title: "Director", email: "nick@example.com" },
      split_ai_summary: { next_step: "Good fit" },
      last_monitor_action: "CONTACTED",
    };
    mockFanOut([lead]);

    const result: any = await tourPlan.execute(newClient(), { city: "New York" });

    const notes = result.map_locations[0].notes;
    expect(notes).toContain("Nick");
    expect(notes).not.toContain("null");
    expect(notes).toContain("Director");
  });
});
