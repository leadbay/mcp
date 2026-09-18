import { describe, it, expect } from "vitest";
import { filterLanded } from "../../../src/composite/pull-followups.js";

// `POST /monitor/filter` answers 200 even when it stores nothing. A criterion
// written without its `type` discriminator — `{sector_ids:["5134"]}` rather than
// `{type:"sector_ids",sectors:["5134"]}` — is dropped, and the PREVIOUS filter
// stays in force. The caller gets a page of leads, a `pagination.total`, and no
// indication that any of it belongs to a different segment than the one asked
// for. Measured live: three consecutive calls for sectors 5133, 5136 and 5134
// all came back echoing a stale 5122 with the same three rows.
//
// The detector compares the SET of criterion types rather than whole objects,
// because the backend normalises what it stores (adds `is_excluded`, reorders
// keys) — a deep-equality check would cry wolf on every successful call.

const sector = (id: string) => ({ type: "sector_ids", is_excluded: false, sectors: [id] });

describe("filterLanded", () => {
  it("reports null when no filter was sent — nothing can have failed", () => {
    expect(filterLanded(undefined, null)).toBeNull();
    expect(filterLanded(undefined, { criteria: [sector("5122")] })).toBeNull();
  });

  it("reports null for an empty criteria list", () => {
    expect(filterLanded({ criteria: [] }, { criteria: [] })).toBeNull();
  });

  it("confirms a criterion that comes back", () => {
    expect(filterLanded({ criteria: [sector("5134")] }, { criteria: [sector("5134")] })).toBe(true);
  });

  it("tolerates backend normalisation of a stored criterion", () => {
    // Sent without is_excluded; the backend adds it. Same type, so it landed.
    const sent = { criteria: [{ type: "sector_ids", sectors: ["5134"] }] };
    expect(filterLanded(sent, { criteria: [sector("5134")] })).toBe(true);
  });

  it("catches the silent drop: no type discriminator, stale filter echoed", () => {
    // The exact shape that failed live.
    const sent = { criteria: [{ sector_ids: ["5134"] }] };
    const echoed = { criteria: [sector("5122")] };
    expect(filterLanded(sent, echoed)).toBe(false);
  });

  it("catches a drop even when the echo is empty", () => {
    expect(filterLanded({ criteria: [sector("5134")] }, { criteria: [] })).toBe(false);
    expect(filterLanded({ criteria: [sector("5134")] }, null)).toBe(false);
  });

  it("catches a PARTIAL drop, where one of two criteria was stored", () => {
    // The dangerous case: results look filtered, so a caller checking only
    // "did anything come back" would report the figures as correct.
    const sent = {
      criteria: [sector("5134"), { type: "size", sizes: [{ min: 50, max: 200 }] }],
    };
    const echoed = { criteria: [sector("5134")] };
    expect(filterLanded(sent, echoed)).toBe(false);
  });

  it("does not care about VALUE drift, only that the type was stored", () => {
    // Comparing values would be stricter, but the backend legitimately rewrites
    // them (a resolved location id, a normalised size band). Type presence is
    // the signal that survives normalisation.
    expect(filterLanded({ criteria: [sector("5134")] }, { criteria: [sector("5136")] })).toBe(true);
  });

  it("survives a malformed criterion without throwing", () => {
    expect(() => filterLanded({ criteria: [null as never] }, { criteria: [] })).not.toThrow();
    expect(filterLanded({ criteria: [null as never] }, { criteria: [] })).toBe(true);
  });
});
