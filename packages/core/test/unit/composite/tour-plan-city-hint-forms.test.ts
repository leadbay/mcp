import { beforeEach, describe, expect, it, vi } from "vitest";
import { httpsMockFactory, mockHttp, resetHttpMock } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { tourPlan } from "../../../src/composite/tour-plan.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

/**
 * Two towns with different names are different places. Every fixture below
 * therefore gets its own cell of a 2-degree grid, ~200 km from every other
 * one, so the radius pass added for product#4141 never reads one of these as
 * a neighbour of another. A fixture that wants two towns next to each other
 * passes its own `pos`; those live in tour-plan-nearby-towns.test.ts.
 */
const gridCells = new Map<string, [number, number]>();
function posFor(city: string): [number, number] {
  const known = gridCells.get(city);
  if (known) return known;
  const n = gridCells.size;
  const cell: [number, number] = [20 + (n % 20) * 2, -120 + Math.floor(n / 20) * 2];
  gridCells.set(city, cell);
  return cell;
}

function lead(id: string, name: string, location: Record<string, unknown>) {
  return {
    id,
    name,
    location: { pos: posFor(String(location.city ?? "")), ...location },
    recommended_contact: null,
    split_ai_summary: { next_step: "Worth a visit" },
  };
}

function mockFanOut(wishlistItems: unknown[]) {
  mockHttp([
    {
      method: "GET",
      path: /\/1\.6\/geo\/search/,
      status: 200,
      body: {
        results: [{ id: "100", country: "US", level: 8, name: "Somewhere", parent_ids: [] }],
        parents: [],
      },
    },
    { method: "POST", path: "/1.6/monitor/filter", status: 204, body: "" },
    { method: "GET", path: "/1.6/monitor/filter", status: 200, body: { criteria: [] } },
    { method: "GET", path: /\/1\.6\/monitor\?/, status: 200, body: { items: [] } },
    { method: "GET", path: "/1.6/users/me", status: 200, body: { last_requested_lens: 5 } },
    { method: "GET", path: "/1.6/users/me", status: 200, body: { last_requested_lens: 5 } },
    {
      method: "GET",
      path: /\/1\.6\/lenses\/5\/leads\/wishlist/,
      status: 200,
      body: { items: wishlistItems, computing_wishlist: false, computing_scoring: false },
    },
  ]);
}

const names = (r: any) => r.discover_leads.map((l: any) => l.name);

/**
 * No lead here is in Washington DC or in New York City. Every hint below
 * therefore has to return nothing; a lead coming back means the hint fell
 * through to the state of Washington or the state of New York.
 */
const NO_CITY_MATCH = [
  lead("d-1", "Redmond Co", { city: "Redmond", state: "Washington", country: "US" }),
  lead("d-2", "Seattle Co", { city: "Seattle", state: "Washington", country: "US" }),
  lead("d-3", "Buffalo Co", { city: "Buffalo", state: "New York", country: "US" }),
  lead("d-4", "Austin Co", { city: "Austin", state: "Texas", country: "US" }),
];

describe("leadbay_tour_plan — how the city hint is spelled (product#4150)", () => {
  // The three forms take three different paths through cityHintCore: the whole
  // hint hits the alias table, the leading segment hits it, and neither does.
  it.each([
    ["Washington, DC", []],
    ["Washington DC", []],
    ["washington, d.c.", []],
    ["New York, NY", []],
    ["NYC", []],
    ["Washington, DC, USA", []],
    ["New York, NY, USA", []],
    ["  Washington ,  DC  ", []],
    ["Austin, TX", ["Austin Co"]],
    ["Austin, TX, USA", ["Austin Co"]],
  ])("a tour of '%s' returns %j", async (hint, expected) => {
    mockFanOut(NO_CITY_MATCH);

    const result: any = await tourPlan.execute(newClient(), { city: hint as string });

    expect(names(result)).toEqual(expected);
  });

  it("the ambiguity recovery's own spelling is a city, not a region", async () => {
    // `ambiguous_locations` tells the agent to re-call with the candidate's
    // `name`, and the US admin-area index spells those "City of New York" and
    // "Town of Islip". Without the prefix being read as a city claim, this
    // falls back to the state of New York and returns Buffalo.
    mockFanOut(NO_CITY_MATCH);

    const result: any = await tourPlan.execute(newClient(), { city: "City of New York" });

    expect(names(result)).toEqual([]);
  });

  it("a prefixed hint still finds the town it names", async () => {
    mockFanOut([
      lead("d-1", "Manhattan Co", { city: "City of New York", state: "New York", country: "US" }),
      lead("d-2", "Buffalo Co", { city: "Buffalo", state: "New York", country: "US" }),
    ]);

    const result: any = await tourPlan.execute(newClient(), { city: "City of New York" });

    expect(names(result)).toEqual(["Manhattan Co"]);
  });

  it("a region hint still falls back to the state", async () => {
    mockFanOut(NO_CITY_MATCH);

    const result: any = await tourPlan.execute(newClient(), { city: "Texas" });

    expect(names(result)).toEqual(["Austin Co"]);
    expect(result.discover_filter_note).toContain("by state/region");
  });
});
