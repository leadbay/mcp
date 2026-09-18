import { describe, it, expect, beforeEach } from "vitest";
import { lb, configure } from "../src/runtime.js";

// Second review round. The type check was one-directional: `everyTypeLanded`
// asks "did everything I wanted arrive?" and never "did anything arrive that I
// did NOT want?". The stored Monitor filter is cumulative, so narrowing a
// segment leaves the dropped criterion in force — sector+city narrowed to
// sector-only still counts leads fenced to a city nobody asked about, while
// every requested type is dutifully present.
//
// An unrequested criterion narrows a count exactly as a dropped one widens it.
// Both are the same bug: a plausible number answering a different question.

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
const size = () => ({ type: "size", is_excluded: false, sizes: [{ min: 50, max: 200 }] });

beforeEach(() => {
  calls = [];
});

describe("a stale criterion the caller did not ask for", () => {
  it("distrusts sector-only when a narrowed-away CITY survived", async () => {
    // The reviewer's case. Previously trusted: sector_ids was wanted and
    // present, sector values matched, so the subset check passed — while the
    // count was still fenced to a city.
    mock([sector("5134"), location("123")]);
    const r = await lb.segmentCount({ sectorIds: ["5134"], ask: "supermarkets" });
    expect(r.trusted).toBe(false);
  });

  it("distrusts sector-only when an unrelated SIZE criterion survived", async () => {
    // Nothing in the kit ever sends `size`, which is the point: any criterion
    // type the caller did not ask for narrows the answer.
    mock([sector("5134"), size()]);
    const r = await lb.segmentCount({ sectorIds: ["5134"], ask: "supermarkets" });
    expect(r.trusted).toBe(false);
  });

  it("distrusts city-only when a narrowed-away SECTOR survived", async () => {
    mock([location("123"), sector("5152")]);
    const r = await lb.segmentCount({ city: "Lyon", ask: "coverage in Lyon" });
    expect(r.trusted).toBe(false);
  });

  it("still trusts a clean narrowed call", async () => {
    // The same narrowing, this time actually applied.
    mock([sector("5134")]);
    const r = await lb.segmentCount({ sectorIds: ["5134"], ask: "supermarkets" });
    expect(r.trusted).toBe(true);
  });

  it("still trusts a clean sector+city call", async () => {
    mock([sector("5134"), location("123")]);
    const r = await lb.segmentCount({
      sectorIds: ["5134"],
      city: "Lyon",
      ask: "supermarkets in Lyon",
    });
    expect(r.trusted).toBe(true);
  });
});

describe("the unfiltered case falls out of the same rule", () => {
  it("trusts an empty echo", async () => {
    mock([], 7232);
    const r = await lb.segmentCount({ ask: "my whole book" });
    expect(r.trusted).toBe(true);
    expect(r.total).toBe(7232);
  });

  it("distrusts any surviving criterion, since none was wanted", async () => {
    // With nothing requested, "nothing extra" IS "the echo is empty" — the
    // dedicated unfiltered branch this replaced is no longer needed.
    mock([sector("5152")], 555);
    const r = await lb.segmentCount({ ask: "my whole book" });
    expect(r.trusted).toBe(false);
  });

  it("distrusts a leftover location on an unfiltered count", async () => {
    mock([location("123")], 900);
    const r = await lb.segmentCount({ ask: "my whole book" });
    expect(r.trusted).toBe(false);
  });
});

describe("the check stays symmetric", () => {
  it("catches a DROPPED criterion as well as an extra one", async () => {
    mock([sector("5134")]);
    const r = await lb.segmentCount({
      sectorIds: ["5134"],
      city: "Lyon",
      ask: "supermarkets in Lyon",
    });
    expect(r.trusted).toBe(false);
  });

  it("ignores a criterion with no type rather than counting it as extra", async () => {
    // A malformed echo entry is not evidence of a surviving filter; the value
    // and presence checks are what decide.
    mock([sector("5134"), { sectors: ["5134"] }]);
    const r = await lb.segmentCount({ sectorIds: ["5134"], ask: "supermarkets" });
    expect(r.trusted).toBe(true);
  });
});
