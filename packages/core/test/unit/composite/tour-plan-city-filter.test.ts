import { beforeEach, describe, expect, it, vi } from "vitest";
import { httpsMockFactory, mockHttp, resetHttpMock } from "../../harness.js";
import { distinctTownPos } from "../../tour-plan-fixtures.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { tourPlan } from "../../../src/composite/tour-plan.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

/**
 * Discover-lead fixtures use the location shape the wishlist endpoint really
 * returns — probed live on 2026-09-15 against both prod tenants:
 * `{city?, state?, country, pos}`, with `country` always the two-letter code
 * and `full` never present. Real US cities arrive prefixed ("City of New
 * York"), real FR cities arrive hyphenated and accented ("Saint-Nazaire",
 * "Épernay"), and a handful of leads carry a state and no city at all.
 */
function lead(id: string, name: string, location: Record<string, unknown>) {
  return {
    id,
    name,
    location: { pos: distinctTownPos(String(location.city ?? "")), ...location },
    recommended_contact: null,
    split_ai_summary: { next_step: "Worth a visit" },
  };
}

/** Mocks the tour fan-out: pullFollowups (geo → monitor) + pullLeads (wishlist). */
function mockFanOut(wishlistItems: unknown[], monitorItems: unknown[] = []) {
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
    {
      method: "GET",
      path: "/1.6/monitor/filter",
      status: 200,
      body: { criteria: [{ type: "location_ids", is_excluded: false, locations: ["100"] }] },
    },
    { method: "GET", path: /\/1\.6\/monitor\?/, status: 200, body: { items: monitorItems } },
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

describe("leadbay_tour_plan — Discover city filter (product#4138)", () => {
  it("a tour of Austin drops the Boston and Chicago leads that share the country code", async () => {
    mockFanOut([
      lead("d-1", "Austin Co", { city: "Austin", state: "Texas", country: "US" }),
      lead("d-2", "Boston Co", { city: "Boston", state: "Massachusetts", country: "US" }),
      lead("d-3", "Chicago Co", { city: "Chicago", state: "Illinois", country: "US" }),
    ]);

    const result: any = await tourPlan.execute(newClient(), { city: "Austin" });

    expect(names(result)).toEqual(["Austin Co"]);
    expect(result.discover_filter_note).toBe(
      "Matched 1/3 Discover leads to 'Austin' by city; returning top 1.",
    );
  });

  it("a tour of Fréjus does not match every FR lead through the country code", async () => {
    mockFanOut([
      lead("d-1", "Fréjus Co", { city: "Fréjus", state: "Provence-Alpes-Côte d'Azur", country: "FR" }),
      lead("d-2", "Lyon Co", { city: "Lyon", state: "Auvergne-Rhône-Alpes", country: "FR" }),
      lead("d-3", "Roissy Co", { city: "Roissy-en-France", state: "Île-de-France", country: "FR" }),
    ]);

    const result: any = await tourPlan.execute(newClient(), { city: "Fréjus" });

    expect(names(result)).toEqual(["Fréjus Co"]);
  });

  it("a tour of New York keeps the city and leaves Buffalo and Albany behind", async () => {
    mockFanOut([
      lead("d-1", "Manhattan Co", { city: "City of New York", state: "New York", country: "US" }),
      lead("d-2", "Buffalo Co", { city: "Buffalo", state: "New York", country: "US" }),
      lead("d-3", "Albany Co", { city: "City of Albany", state: "New York", country: "US" }),
      lead("d-4", "York Co", { city: "York", state: "Pennsylvania", country: "US" }),
    ]);

    const result: any = await tourPlan.execute(newClient(), { city: "New York" });

    expect(names(result)).toEqual(["Manhattan Co"]);
  });

  it("returns no Discover lead, and says so, when the lens holds none in the city", async () => {
    mockFanOut([
      lead("d-1", "Boston Co", { city: "Boston", state: "Massachusetts", country: "US" }),
      lead("d-2", "Chicago Co", { city: "Chicago", state: "Illinois", country: "US" }),
    ]);

    const result: any = await tourPlan.execute(newClient(), { city: "Austin" });

    expect(result.discover_leads).toEqual([]);
    expect(result.discover_filter_note).toBe(
      "No Discover lead in the active lens is in 'Austin' (checked 2 candidates by city, then by state/region). Say so; do NOT present leads from elsewhere as if they were in 'Austin'.",
    );
  });

  it("a state or region hint falls back to the state field, including leads with no city", async () => {
    mockFanOut([
      lead("d-1", "Dallas Co", { city: "Dallas", state: "Texas", country: "US" }),
      lead("d-2", "Plano Co", { city: "Plano", state: "Texas", country: "US" }),
      lead("d-3", "Miami Co", { city: "Miami", state: "Florida", country: "US" }),
      lead("d-4", "Unplaced Texas Co", { state: "Texas", country: "US" }),
    ]);

    const result: any = await tourPlan.execute(newClient(), { city: "Texas" });

    expect(names(result)).toEqual(["Dallas Co", "Plano Co", "Unplaced Texas Co"]);
    expect(result.discover_filter_note).toBe(
      "Matched 3/4 Discover leads to 'Texas' by state/region; returning top 3.",
    );
  });

  it("an accented, hyphenated region hint matches the state field it is written differently from", async () => {
    mockFanOut([
      lead("d-1", "Courbevoie Co", { city: "Courbevoie", state: "Île-de-France", country: "FR" }),
      lead("d-2", "Nantes Co", { city: "Nantes", state: "Pays de la Loire", country: "FR" }),
    ]);

    const result: any = await tourPlan.execute(newClient(), { city: "ile de france" });

    expect(names(result)).toEqual(["Courbevoie Co"]);
  });

  it("a hyphenated city matches whichever way the hint spells it, and not its near-namesakes", async () => {
    const wishlist = [
      lead("d-1", "Nazaire Co", { city: "Saint-Nazaire", state: "Pays de la Loire", country: "FR" }),
      lead("d-2", "Savine Co", { city: "Sainte-Savine", state: "Grand Est", country: "FR" }),
      lead("d-3", "Cyr Co", { city: "Saint-Cyr-en-Val", state: "Centre-Val de Loire", country: "FR" }),
    ];

    mockFanOut(wishlist);
    const hyphenated: any = await tourPlan.execute(newClient(), { city: "Saint-Nazaire" });
    expect(names(hyphenated)).toEqual(["Nazaire Co"]);

    resetHttpMock();
    mockFanOut(wishlist);
    const spaced: any = await tourPlan.execute(newClient(), { city: "saint nazaire" });
    expect(names(spaced)).toEqual(["Nazaire Co"]);
  });

  it("a 'City, State' hint is a tour of the city, not of the state", async () => {
    mockFanOut([
      lead("d-1", "Austin Co", { city: "Austin", state: "Texas", country: "US" }),
      lead("d-2", "Houston Co", { city: "Houston", state: "Texas", country: "US" }),
    ]);

    const result: any = await tourPlan.execute(newClient(), { city: "Austin, TX" });

    expect(names(result)).toEqual(["Austin Co"]);
  });

  it("no city argument still returns the whole Discover page unfiltered", async () => {
    mockFanOut([
      lead("d-1", "Boston Co", { city: "Boston", state: "Massachusetts", country: "US" }),
      lead("d-2", "Chicago Co", { city: "Chicago", state: "Illinois", country: "US" }),
    ]);

    const result: any = await tourPlan.execute(newClient(), {});

    expect(names(result)).toEqual(["Boston Co", "Chicago Co"]);
    expect(result.discover_filter_note).toBe(
      "No city filter applied; returning top 2 Discover leads.",
    );
  });

  it("a tour of York does not pull in the New York leads", async () => {
    mockFanOut([
      lead("d-1", "Manhattan Co", { city: "City of New York", state: "New York", country: "US" }),
      lead("d-2", "York Co", { city: "York", state: "Pennsylvania", country: "US" }),
      lead("d-3", "Angeles Co", { city: "Los Angeles", state: "California", country: "US" }),
    ]);

    const result: any = await tourPlan.execute(newClient(), { city: "York" });

    expect(names(result)).toEqual(["York Co"]);
  });

  it("a tour of Austin does not pull in Port Austin or Austin Township", async () => {
    mockFanOut([
      lead("d-1", "Port Co", { city: "Port Austin", state: "Michigan", country: "US" }),
      lead("d-2", "Township Co", { city: "Austin Township", state: "Minnesota", country: "US" }),
    ]);

    const result: any = await tourPlan.execute(newClient(), { city: "Austin" });

    expect(result.discover_leads).toEqual([]);
  });

  it("strips the administrative prefix the US admin-area index puts on a town", async () => {
    mockFanOut([
      lead("d-1", "Islip Co", { city: "Town of Islip", state: "New York", country: "US" }),
      lead("d-2", "Ramapo Co", { city: "Town of Ramapo", state: "New York", country: "US" }),
    ]);

    const result: any = await tourPlan.execute(newClient(), { city: "Islip" });

    expect(names(result)).toEqual(["Islip Co"]);
  });

  it("resolves the abbreviations users actually type, through the Monitor alias table", async () => {
    const wishlist = [
      lead("d-1", "Manhattan Co", { city: "City of New York", state: "New York", country: "US" }),
      lead("d-2", "SF Co", { city: "San Francisco", state: "California", country: "US" }),
      lead("d-3", "LA Co", { city: "Los Angeles", state: "California", country: "US" }),
    ];

    mockFanOut(wishlist);
    expect(names(await tourPlan.execute(newClient(), { city: "NYC" }) as any)).toEqual(["Manhattan Co"]);

    resetHttpMock();
    mockFanOut(wishlist);
    expect(names(await tourPlan.execute(newClient(), { city: "SF" }) as any)).toEqual(["SF Co"]);

    resetHttpMock();
    mockFanOut(wishlist);
    expect(names(await tourPlan.execute(newClient(), { city: "LA" }) as any)).toEqual(["LA Co"]);
  });

  it("a tour of Washington DC does not fall through to the state of Washington", async () => {
    mockFanOut([
      lead("d-1", "Redmond Co", { city: "Redmond", state: "Washington", country: "US" }),
      lead("d-2", "Seattle Co", { city: "Seattle", state: "Washington", country: "US" }),
    ]);

    const result: any = await tourPlan.execute(newClient(), { city: "Washington DC" });

    expect(result.discover_leads).toEqual([]);
  });

  // A name that is both a town and a state cannot be told apart from the
  // corpus or from /geo/search, which returns "Washington" at level 4 and
  // level 8, "Texas" and "Florida" likewise. The regional fallback wins, and
  // the note says which field carried the match so the agent can say so too.
  it("a bare state-or-city name falls back to the state, and the note says so", async () => {
    mockFanOut([
      lead("d-1", "Redmond Co", { city: "Redmond", state: "Washington", country: "US" }),
      lead("d-2", "Seattle Co", { city: "Seattle", state: "Washington", country: "US" }),
      lead("d-3", "Dallas Co", { city: "Dallas", state: "Texas", country: "US" }),
    ]);

    const result: any = await tourPlan.execute(newClient(), { city: "Washington" });

    expect(names(result)).toEqual(["Redmond Co", "Seattle Co"]);
    expect(result.discover_filter_note).toContain("by state/region");
  });

  it("a bare city_id returns no Discover lead and names the argument that is missing", async () => {
    mockFanOut([
      lead("d-1", "Boston Co", { city: "Boston", state: "Massachusetts", country: "US" }),
      lead("d-2", "Chicago Co", { city: "Chicago", state: "Illinois", country: "US" }),
    ]);

    const result: any = await tourPlan.execute(newClient(), { city_id: "6027" });

    expect(result.discover_leads).toEqual([]);
    expect(result.discover_filter_note).toContain("passed an area id (6027) and no name");
  });

  it("an all-digit city is the area id it looks like, not a town called 38112", async () => {
    mockFanOut([
      lead("d-1", "Boston Co", { city: "Boston", state: "Massachusetts", country: "US" }),
      lead("d-2", "Chicago Co", { city: "Chicago", state: "Illinois", country: "US" }),
    ]);

    const result: any = await tourPlan.execute(newClient(), { city: "38112" });

    expect(result.discover_leads).toEqual([]);
    expect(result.discover_filter_note).toContain("passed an area id (38112) and no name");
  });

  it("city_id plus city scopes the follow-ups by id and the Discover leads by name", async () => {
    mockFanOut([
      lead("d-1", "Austin Co", { city: "Austin", state: "Texas", country: "US" }),
      lead("d-2", "Boston Co", { city: "Boston", state: "Massachusetts", country: "US" }),
    ]);

    const result: any = await tourPlan.execute(newClient(), { city: "Austin", city_id: "6027" });

    expect(names(result)).toEqual(["Austin Co"]);
  });

  it("reports only the leads the itinerary shows as seen", async () => {
    mockFanOut([
      lead("d-1", "Austin Co", { city: "Austin", state: "Texas", country: "US" }),
      lead("d-2", "Boston Co", { city: "Boston", state: "Massachusetts", country: "US" }),
    ]);

    const result: any = await tourPlan.execute(newClient(), { city: "Austin" });

    expect(result.map_locations.map((m: any) => m.name)).toEqual(["Austin Co"]);
    expect(result.map_summary.total_leads).toBe(1);
  });
});
