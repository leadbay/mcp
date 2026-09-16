import { beforeEach, describe, expect, it, vi } from "vitest";
import { httpsMockFactory, mockHttp, resetHttpMock } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { tourPlan } from "../../../src/composite/tour-plan.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

/**
 * Real coordinates, so the distances the tests assert are the distances a
 * driver would drive. Measured against these points:
 *
 *   Sacramento → West Sacramento    3.1 km
 *   Sacramento → Rancho Cordova    16.7 km
 *   Sacramento → Davis             21.8 km
 *   Sacramento → San Diego        760.5 km
 *   Paris → Ivry-sur-Seine          5.3 km
 *   Paris → Courbevoie              8.3 km
 *   Paris → Lyon                  391.5 km
 *   Colmar → Munster               16.9 km
 *   Austin → Boston             2,726.2 km
 *   Washington → Redmond        3,720.2 km
 */
const POS: Record<string, [number, number]> = {
  Sacramento: [38.5816, -121.4944],
  "West Sacramento": [38.5805, -121.5302],
  "Rancho Cordova": [38.5891, -121.3027],
  Davis: [38.5449, -121.7405],
  "San Diego": [32.7157, -117.1611],
  Paris: [48.8566, 2.3522],
  Courbevoie: [48.8973, 2.2569],
  "Ivry-sur-Seine": [48.8136, 2.3838],
  Lyon: [45.764, 4.8357],
  Colmar: [48.0794, 7.3585],
  Munster: [48.0406, 7.1381],
  Austin: [30.2672, -97.7431],
  Boston: [42.3601, -71.0589],
  Dallas: [32.7767, -96.797],
  Redmond: [47.674, -122.1215],
  Seattle: [47.6062, -122.3321],
};

function lead(
  id: string,
  name: string,
  city: string,
  over: Record<string, unknown> = {},
) {
  return {
    id,
    name,
    location: { city, country: "US", pos: POS[city], ...over },
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

describe("leadbay_tour_plan — the next town over (product#4141)", () => {
  it("a tour of Sacramento reaches West Sacramento, 3 km away, and not San Diego", async () => {
    mockFanOut([
      lead("d-1", "Sacramento Co", "Sacramento"),
      lead("d-2", "West Sac Co", "West Sacramento"),
      lead("d-3", "San Diego Co", "San Diego"),
    ]);

    const result: any = await tourPlan.execute(newClient(), { city: "Sacramento" });

    expect(names(result)).toEqual(["Sacramento Co", "West Sac Co"]);
    expect(result.discover_filter_note).toContain("plus 1 within 20 km of it");
    expect(result.discover_filter_note).toContain("1 in 'Sacramento' and 1 in West Sacramento");
  });

  it("the default 20 km reaches Rancho Cordova at 17 km and stops before Davis at 22", async () => {
    mockFanOut([
      lead("d-1", "Sacramento Co", "Sacramento"),
      lead("d-2", "Cordova Co", "Rancho Cordova"),
      lead("d-3", "Davis Co", "Davis"),
    ]);

    const result: any = await tourPlan.execute(newClient(), { city: "Sacramento" });

    expect(names(result)).toEqual(["Sacramento Co", "Cordova Co"]);
  });

  it("the town's own leads come first and the neighbours after", async () => {
    mockFanOut([
      lead("d-1", "West Sac Co", "West Sacramento"),
      lead("d-2", "Cordova Co", "Rancho Cordova"),
      lead("d-3", "Sacramento Co", "Sacramento"),
    ]);

    const result: any = await tourPlan.execute(newClient(), { city: "Sacramento" });

    expect(names(result)).toEqual(["Sacramento Co", "West Sac Co", "Cordova Co"]);
  });

  it("radius_km 0 keeps the tour inside the town that was named", async () => {
    mockFanOut([
      lead("d-1", "Sacramento Co", "Sacramento"),
      lead("d-2", "West Sac Co", "West Sacramento"),
    ]);

    const result: any = await tourPlan.execute(newClient(), {
      city: "Sacramento",
      radius_km: 0,
    });

    expect(names(result)).toEqual(["Sacramento Co"]);
    expect(result.discover_filter_note).toBe(
      "Matched 1/2 Discover leads to 'Sacramento' by city; returning top 1.",
    );
  });

  // "j'ai un rdv le 19 aout à COLMAR identifier moi stp les prospects dans un
  // rayon de 10km autour de COLMAR" — a real prod call. Munster is 17 km out,
  // so the number the user says is the number that decides.
  it("the 10 km a user asks for is the 10 km applied", async () => {
    const wishlist = [
      lead("d-1", "Colmar Co", "Colmar", { country: "FR" }),
      lead("d-2", "Munster Co", "Munster", { country: "FR" }),
    ];

    mockFanOut(wishlist);
    const tight: any = await tourPlan.execute(newClient(), {
      city: "Colmar",
      radius_km: 10,
    });
    expect(names(tight)).toEqual(["Colmar Co"]);

    resetHttpMock();
    mockFanOut(wishlist);
    const wide: any = await tourPlan.execute(newClient(), {
      city: "Colmar",
      radius_km: 20,
    });
    expect(names(wide)).toEqual(["Colmar Co", "Munster Co"]);
  });

  it("a tour of Paris reaches Courbevoie and Ivry-sur-Seine, and not Lyon", async () => {
    mockFanOut([
      lead("d-1", "Paris Co", "Paris", { country: "FR" }),
      lead("d-2", "Courbevoie Co", "Courbevoie", { country: "FR" }),
      lead("d-3", "Ivry Co", "Ivry-sur-Seine", { country: "FR" }),
      lead("d-4", "Lyon Co", "Lyon", { country: "FR" }),
    ]);

    const result: any = await tourPlan.execute(newClient(), { city: "Paris" });

    expect(names(result)).toEqual(["Paris Co", "Courbevoie Co", "Ivry Co"]);
    expect(result.discover_filter_note).toContain("Courbevoie, Ivry-sur-Seine");
  });

  it("with no lead in the town itself, the follow-ups there place the neighbours", async () => {
    mockFanOut(
      [lead("d-1", "West Sac Co", "West Sacramento"), lead("d-2", "San Diego Co", "San Diego")],
      [lead("m-1", "Sacramento Customer", "Sacramento")],
    );

    const result: any = await tourPlan.execute(newClient(), { city: "Sacramento" });

    expect(names(result)).toEqual(["West Sac Co"]);
    expect(result.discover_filter_note).toBe(
      "No Discover lead in the active lens names 'Sacramento' as its town; 1/2 are within 20 km of it. Returning top 1, in West Sacramento. Name the town each stop is actually in rather than calling them all 'Sacramento'.",
    );
  });

  it("says plainly when nothing is in the town and nothing is near it either", async () => {
    mockFanOut(
      [lead("d-1", "San Diego Co", "San Diego")],
      [lead("m-1", "Sacramento Customer", "Sacramento")],
    );

    const result: any = await tourPlan.execute(newClient(), { city: "Sacramento" });

    expect(result.discover_leads).toEqual([]);
    expect(result.discover_filter_note).toBe(
      "No Discover lead in the active lens names 'Sacramento' as its town, and none is within 20 km of the leads that do (checked 1 candidates). Say so; do NOT present leads from elsewhere as if they were in 'Sacramento'.",
    );
  });

  // product#4138 was a substring test that put every American company on a
  // tour of Austin. Distance has to keep that shut.
  it("a tour of Austin still does not reach Boston", async () => {
    mockFanOut([lead("d-1", "Austin Co", "Austin"), lead("d-2", "Boston Co", "Boston")]);

    const result: any = await tourPlan.execute(newClient(), { city: "Austin" });

    expect(names(result)).toEqual(["Austin Co"]);
  });

  it("a tour of Washington DC does not reach Redmond through the radius", async () => {
    mockFanOut([lead("d-1", "Redmond Co", "Redmond"), lead("d-2", "Seattle Co", "Seattle")]);

    const result: any = await tourPlan.execute(newClient(), { city: "Washington DC" });

    expect(result.discover_leads).toEqual([]);
  });

  // The FR prod portfolio answers a Monitor filter of location_ids ["412"]
  // (Nantes) with leads in Paris, Amiens and Bordeaux. Anchoring on a
  // follow-up whose own record does not name the town put the whole Paris
  // cluster on a tour of Colmar — product#4138 all over again.
  it("a follow-up that is not in the town does not anchor the tour", async () => {
    mockFanOut(
      [lead("d-1", "West Sac Co", "West Sacramento"), lead("d-2", "Boston Co", "Boston")],
      [lead("m-1", "Boston Customer", "Boston")],
    );

    const result: any = await tourPlan.execute(newClient(), { city: "Sacramento" });

    expect(result.discover_leads).toEqual([]);
    expect(result.discover_filter_note).toContain(
      "No Discover lead in the active lens is in 'Sacramento' (checked 2 candidates by city, then by state/region)",
    );
  });

  // A region ask is for the whole region. 20 km around one customer in Dallas
  // is not Texas, so the state pass has to win before proximity is consulted.
  it("a region hint still returns the whole state, not 20 km of one customer", async () => {
    mockFanOut(
      [
        lead("d-1", "Austin Co", "Austin", { state: "Texas" }),
        lead("d-2", "Dallas Co", "Dallas", { state: "Texas" }),
        lead("d-3", "Boston Co", "Boston", { state: "Massachusetts" }),
      ],
      [lead("m-1", "Dallas Customer", "Dallas", { state: "Texas" })],
    );

    const result: any = await tourPlan.execute(newClient(), { city: "Texas" });

    expect(names(result)).toEqual(["Austin Co", "Dallas Co"]);
    expect(result.discover_filter_note).toContain("by state/region");
  });

  it("a lead with no coordinates is never pulled in as a neighbour", async () => {
    mockFanOut([
      lead("d-1", "Sacramento Co", "Sacramento"),
      lead("d-2", "Unplaced Co", "Nowhere Town", { pos: null }),
    ]);

    const result: any = await tourPlan.execute(newClient(), { city: "Sacramento" });

    expect(names(result)).toEqual(["Sacramento Co"]);
  });

  // An id carries no name, so no follow-up under it can be checked against the
  // town, and the radius has nothing trustworthy to start from.
  it("a bare city_id still returns nothing and names the missing argument", async () => {
    mockFanOut(
      [lead("d-1", "West Sac Co", "West Sacramento")],
      [lead("m-1", "Sacramento Customer", "Sacramento")],
    );

    const result: any = await tourPlan.execute(newClient(), { city_id: "6027" });

    expect(result.discover_leads).toEqual([]);
    expect(result.discover_filter_note).toContain("passed an area id (6027) and no name");
  });

  // 6 of the 60 live US wishlist leads carry coordinates and no town name.
  it("a stop whose record names no town is counted, not printed as an empty name", async () => {
    mockFanOut(
      [
        {
          id: "d-1",
          name: "Unnamed Town Co",
          location: { state: "California", country: "US", pos: [38.585, -121.5] },
          recommended_contact: null,
          split_ai_summary: { next_step: "Worth a visit" },
        },
      ],
      [lead("m-1", "Sacramento Customer", "Sacramento")],
    );

    const result: any = await tourPlan.execute(newClient(), { city: "Sacramento" });

    expect(names(result)).toEqual(["Unnamed Town Co"]);
    expect(result.discover_filter_note).toContain("1 whose record names no town");
    expect(result.discover_filter_note).not.toContain(", in .");
  });

  it("radius_km 0 does not claim a 0 km search was run", async () => {
    mockFanOut(
      [lead("d-1", "West Sac Co", "West Sacramento")],
      [lead("m-1", "Sacramento Customer", "Sacramento")],
    );

    const result: any = await tourPlan.execute(newClient(), {
      city: "Sacramento",
      radius_km: 0,
    });

    expect(result.discover_leads).toEqual([]);
    expect(result.discover_filter_note).not.toContain("0 km");
  });

  it("the radius never filters the Monitor half, which the backend scoped server-side", async () => {
    mockFanOut(
      [lead("d-1", "Sacramento Co", "Sacramento")],
      [lead("m-1", "San Diego Customer", "San Diego")],
    );

    const result: any = await tourPlan.execute(newClient(), { city: "Sacramento" });

    expect(result.monitor_leads.map((l: any) => l.name)).toEqual(["San Diego Customer"]);
  });
});
