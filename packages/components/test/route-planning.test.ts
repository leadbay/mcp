import { describe, it, expect } from "vitest";
import { lb } from "../src/runtime.js";

// The route helpers, extracted from the first route-planner artifact where
// each was hand-rolled. They are here because all three are easy to get
// subtly wrong in a way nothing surfaces: a plane-geometry distance still
// returns a number, a dropped waypoint still opens Google Maps, and a lead at
// 0,0 still puts a pin on the map.

const PARIS: [number, number] = [48.8566, 2.3522];
const LYON: [number, number] = [45.764, 4.8357];
const MARSEILLE: [number, number] = [43.2965, 5.3698];

describe("lb.leadPos rejects what is not a position", () => {
  it("reads location.pos", () => {
    expect(lb.leadPos({ location: { pos: [48.8566, 2.3522] } })).toEqual(PARIS);
  });

  it("a lead with no coordinates is null, not an exception", () => {
    // Normal on an imported book — most leads are ungeocoded. The map must
    // list them somewhere else, not crash and not silently drop them.
    expect(lb.leadPos({ location: {} })).toBeNull();
    expect(lb.leadPos({})).toBeNull();
    expect(lb.leadPos(null)).toBeNull();
  });

  it("rejects 0,0 — the API's sentinel, not a lead in the Gulf of Guinea", () => {
    expect(lb.leadPos({ location: { pos: [0, 0] } })).toBeNull();
  });

  it("rejects out-of-range and non-numeric values", () => {
    expect(lb.leadPos({ location: { pos: [91, 0] } })).toBeNull();
    expect(lb.leadPos({ location: { pos: [0, 181] } })).toBeNull();
    expect(lb.leadPos({ location: { pos: ["48.8", "2.3"] } })).toBeNull();
    expect(lb.leadPos({ location: { pos: [NaN, 2] } })).toBeNull();
    expect(lb.leadPos({ location: { pos: [48.8] } })).toBeNull();
  });
});

describe("lb.distanceKm is great-circle, not flat", () => {
  it("matches the known Paris–Lyon distance", () => {
    expect(lb.distanceKm(PARIS, LYON)).toBeGreaterThan(390);
    expect(lb.distanceKm(PARIS, LYON)).toBeLessThan(400);
  });

  it("is symmetric and zero for a point against itself", () => {
    expect(lb.distanceKm(PARIS, LYON)).toBeCloseTo(lb.distanceKm(LYON, PARIS), 6);
    expect(lb.distanceKm(PARIS, PARIS)).toBe(0);
  });

  it("does not treat a degree of longitude as a degree of latitude", () => {
    // At French latitudes a degree of longitude is ~73km against ~111km for
    // latitude. Euclidean maths would make these two equal and mis-order a
    // route east-west.
    const northSouth = lb.distanceKm([45, 5], [46, 5]);
    const eastWest = lb.distanceKm([45, 5], [45, 6]);
    expect(northSouth).toBeGreaterThan(eastWest * 1.3);
  });
});

describe("lb.routeUrl builds something the rep can actually drive", () => {
  const stop = (pos: [number, number]) => ({ pos });

  it("one stop is a destination, not an origin", () => {
    const r = lb.routeUrl([stop(LYON)])!;
    expect(r.url).toContain("destination=45.764%2C4.8357");
    expect(r.url).not.toContain("origin=");
  });

  it("several stops become origin, waypoints and destination in order", () => {
    const r = lb.routeUrl([stop(PARIS), stop(LYON), stop(MARSEILLE)])!;
    expect(r.url).toContain("origin=48.8566%2C2.3522");
    expect(r.url).toContain("destination=43.2965%2C5.3698");
    expect(r.url).toContain("waypoints=45.764%2C4.8357");
    expect(r.truncated).toBe(0);
  });

  it("REPORTS the stops it had to drop rather than losing them quietly", () => {
    // Google Maps caps at origin + 9 waypoints + destination. A longer route
    // opens fine and is missing its tail — the rep drives a day that ends
    // early and never learns why.
    const many = Array.from({ length: 15 }, (_, i) => stop([45 + i * 0.1, 5] as [number, number]));
    const r = lb.routeUrl(many)!;
    expect(r.used).toBe(11);
    expect(r.truncated).toBe(4);
  });

  it("an empty route is null, not a URL to nowhere", () => {
    expect(lb.routeUrl([])).toBeNull();
  });

  it("skips malformed stops instead of emitting a broken URL", () => {
    const r = lb.routeUrl([{ pos: undefined } as any, stop(LYON)])!;
    expect(r.used).toBe(1);
    expect(r.url).toContain("destination=45.764");
  });
});

describe("lb.routeDistanceKm totals the legs in order", () => {
  it("sums each hop, not the straight line end to end", () => {
    const viaLyon = lb.routeDistanceKm([{ pos: PARIS }, { pos: LYON }, { pos: MARSEILLE }]);
    const direct = lb.distanceKm(PARIS, MARSEILLE);
    expect(viaLyon).toBeGreaterThan(direct);
  });

  it("a single stop covers no distance", () => {
    expect(lb.routeDistanceKm([{ pos: PARIS }])).toBe(0);
    expect(lb.routeDistanceKm([])).toBe(0);
  });
});

describe("lb.orderByProximity gives a sane default order", () => {
  it("visits the nearest next stop rather than the API's order", () => {
    const stops = [
      { id: "paris", pos: PARIS },
      { id: "marseille", pos: MARSEILLE },
      { id: "lyon", pos: LYON },
    ];
    // From Paris, Lyon is nearer than Marseille — the arbitrary input order
    // would drive Paris → Marseille → back up to Lyon.
    expect(lb.orderByProximity(stops).map((s) => s.id)).toEqual(["paris", "lyon", "marseille"]);
  });

  it("shortens the total against the unordered list", () => {
    const stops = [
      { id: "a", pos: PARIS },
      { id: "b", pos: MARSEILLE },
      { id: "c", pos: LYON },
    ];
    expect(lb.routeDistanceKm(lb.orderByProximity(stops))).toBeLessThan(
      lb.routeDistanceKm(stops),
    );
  });

  it("leaves one or two stops alone — nothing to reorder", () => {
    const two = [{ id: "a", pos: PARIS }, { id: "b", pos: LYON }];
    expect(lb.orderByProximity(two).map((s) => s.id)).toEqual(["a", "b"]);
    expect(lb.orderByProximity([]).length).toBe(0);
  });

  it("can start from where the rep is, not from the first lead", () => {
    const stops = [
      { id: "paris", pos: PARIS },
      { id: "marseille", pos: MARSEILLE },
      { id: "lyon", pos: LYON },
    ];
    // Starting in Marseille, the route should run south to north.
    expect(lb.orderByProximity(stops, MARSEILLE).map((s) => s.id)).toEqual([
      "marseille",
      "lyon",
      "paris",
    ]);
  });
});
