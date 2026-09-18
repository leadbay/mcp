import { describe, it, expect, beforeEach } from "vitest";
import { lb, configure } from "../src/runtime.js";

// `trusted` once compared sector ids and nothing else. `city` / `cityId` are
// first-class inputs to segmentCount, so a city-only call put BOTH sides of that
// comparison at the empty string: a silently-dropped location criterion read as
// trusted, and the board charted a count for a segment nobody asked for. That is
// the precise failure this flag exists to catch — it just was not caught on the
// city path. Raised in review on the PR.
//
// The check is now generic over criterion TYPES, mirroring `filterLanded` in
// packages/core. It cannot import that helper: the kit is a zero-dependency
// browser bundle, so the logic is shared by design rather than by reference.

let calls: Array<Record<string, unknown>>;
const mock = (applied: unknown[], total = 42) => {
  calls = [];
  configure({
    call: async (_tool: string, args: Record<string, unknown>) => {
      calls.push(args);
      return { pagination: { total }, active_filters: { criteria: applied } };
    },
  });
};

const sector = (id: string) => ({ type: "sector_ids", is_excluded: false, sectors: [id] });
const location = (id: string) => ({ type: "location_ids", is_excluded: false, locations: [id] });

beforeEach(() => {
  calls = [];
});

describe("segmentCount trusts a city segment only when the city landed", () => {
  it("distrusts a city-only call whose criterion was silently dropped", async () => {
    // The reviewer's case: 200 OK, nothing stored, count is the whole book.
    mock([]);
    const r = await lb.segmentCount({ city: "Lyon", ask: "coverage in Lyon" });
    expect(r.trusted).toBe(false);
  });

  it("trusts a city-only call whose location criterion came back", async () => {
    mock([location("123")]);
    const r = await lb.segmentCount({ city: "Lyon", ask: "coverage in Lyon" });
    expect(r.trusted).toBe(true);
  });

  it("distrusts a city call answered by a STALE sector filter", async () => {
    mock([sector("5122")]);
    const r = await lb.segmentCount({ city: "Lyon", ask: "coverage in Lyon" });
    expect(r.trusted).toBe(false);
  });

  it("guards cityId on the same terms as city", async () => {
    mock([]);
    const r = await lb.segmentCount({ cityId: "123", ask: "coverage" });
    expect(r.trusted).toBe(false);
    expect(calls[0].city_id).toBe("123");
  });

  it("requires BOTH criteria when a sector and a city are asked for together", async () => {
    // The dangerous partial: results look filtered, so a caller checking only
    // "did anything come back" would report the figure as correct.
    mock([sector("5134")]);
    const r = await lb.segmentCount({
      sectorIds: ["5134"],
      city: "Lyon",
      ask: "supermarkets in Lyon",
    });
    expect(r.trusted).toBe(false);
  });

  it("trusts a sector+city call when both came back", async () => {
    mock([sector("5134"), location("123")]);
    const r = await lb.segmentCount({
      sectorIds: ["5134"],
      city: "Lyon",
      ask: "supermarkets in Lyon",
    });
    expect(r.trusted).toBe(true);
  });

  it("still checks sector VALUES, not merely that a sector criterion exists", async () => {
    // A stale sector filter is still a sector filter; a type-only check would
    // wave 5122 through when 5134 was asked for.
    mock([sector("5122")]);
    const r = await lb.segmentCount({ sectorIds: ["5134"], ask: "supermarkets" });
    expect(r.trusted).toBe(false);
  });

  it("does not value-check a location, whose id the server resolves", async () => {
    // The caller sends free text and never learns which admin_area_id it became,
    // so there is nothing to compare — presence is the only honest check.
    mock([location("999")]);
    const r = await lb.segmentCount({ city: "Lyon", ask: "coverage in Lyon" });
    expect(r.trusted).toBe(true);
  });
});

describe("the unfiltered whole-book count", () => {
  it("is trusted when the echo is genuinely empty", async () => {
    mock([], 7232);
    const r = await lb.segmentCount({ ask: "my whole book" });
    expect(r.trusted).toBe(true);
    expect(r.total).toBe(7232);
  });

  it("is DISTRUSTED when a leftover filter is still narrowing it", async () => {
    // Asking for no criteria means the count should be the whole book. An echo
    // carrying a criterion means a stored filter survived and the total is a
    // slice — fatal for a denominator every percentage divides by.
    mock([sector("5152")], 555);
    const r = await lb.segmentCount({ ask: "my whole book" });
    expect(r.trusted).toBe(false);
  });
});
