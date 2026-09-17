import { describe, it, expect, beforeEach } from "vitest";
import { lb, configure } from "../src/runtime.js";
import { ARTIFACT_USAGE_GUIDE as GUIDE } from "../../core/src/artifact-runtime.generated.js";

// Counting a segment is one cheap call — the Monitor filter plus count:1, read
// off pagination.total. Two traps make a hand-rolled version wrong, and BOTH
// were observed against the live FR API:
//
//   1. the filter is server-side and stateful, so calls are not independent;
//   2. a rejected criterion returns 200 with the PREVIOUS filter applied, so a
//      plausible number silently answers a different question.
//
// The second is why segmentCount returns `trusted`.

const flat = GUIDE.replace(/\s+/g, " ");

describe("lb.segmentCount", () => {
  beforeEach(() => configure({}));

  it("asks for one row and reads the total off pagination", async () => {
    let sent: Record<string, unknown> = {};
    configure({
      call: (_t, args) => {
        sent = args;
        return Promise.resolve({
          pagination: { total: 3656 },
          active_filters: { criteria: [{ type: "sector_ids", sectors: ["5134"], is_excluded: false }] },
        });
      },
    });
    const r = await lb.segmentCount({ sectorIds: ["5134"], ask: "coverage" });

    expect(sent.count).toBe(1);          // a count, not a page of leads
    expect(r.total).toBe(3656);
    expect(r.trusted).toBe(true);
  });

  it("flags a count the server did not actually filter for", async () => {
    // The live failure: a criterion the API would not store, answered with the
    // stale filter and a 200. The number looks fine and means something else.
    configure({
      call: () =>
        Promise.resolve({
          pagination: { total: 7102 },
          active_filters: { criteria: [{ type: "last_action_date", last_days: 0 }] },
        }),
    });
    const r = await lb.segmentCount({ sectorIds: ["5134"], ask: "coverage" });

    expect(r.total).toBe(7102);
    expect(r.trusted).toBe(false);       // never chart this
  });

  it("sends the COMPLETE criteria set, never a delta", async () => {
    // The filter is one stored item per user; a delta would inherit whatever
    // the previous call left behind.
    let sent: Record<string, unknown> = {};
    configure({
      call: (_t, args) => {
        sent = args;
        return Promise.resolve({
          pagination: { total: 1279 },
          active_filters: { criteria: [{ type: "sector_ids", sectors: ["5136"] }] },
        });
      },
    });
    await lb.segmentCount({ sectorIds: ["5136"], ask: "coverage" });
    const f = sent.set_filter as { criteria: Array<Record<string, unknown>> };
    expect(Array.isArray(f.criteria)).toBe(true);
    expect(f.criteria[0]).toMatchObject({ type: "sector_ids", sectors: ["5136"] });
  });

  it("an unfiltered call sends empty criteria, which clears the stored filter", async () => {
    let sent: Record<string, unknown> = {};
    configure({
      call: (_t, args) => {
        sent = args;
        return Promise.resolve({ pagination: { total: 7102 }, active_filters: { criteria: [] } });
      },
    });
    const r = await lb.segmentCount({ ask: "baseline" });
    expect((sent.set_filter as { criteria: unknown[] }).criteria).toEqual([]);
    expect(r.trusted).toBe(true);
    expect(r.total).toBe(7102);
  });

  it("passes a free-text city through for server-side geo resolution", async () => {
    let sent: Record<string, unknown> = {};
    configure({
      call: (_t, args) => {
        sent = args;
        return Promise.resolve({ pagination: { total: 12 }, active_filters: { criteria: [] } });
      },
    });
    await lb.segmentCount({ city: "Lyon", ask: "coverage" });
    expect(sent.city).toBe("Lyon");      // the composite resolves it via /geo/search
  });

  it("treats a missing total as 0 rather than NaN", async () => {
    configure({ call: () => Promise.resolve({ active_filters: { criteria: [] } }) });
    const r = await lb.segmentCount({ ask: "coverage" });
    expect(r.total).toBe(0);
  });
});

describe("the guide documents the segment recipe", () => {
  it("warns that the filter is stateful", () => {
    expect(flat).toMatch(/The filter is server-side and STATEFUL/i);
    expect(flat).toMatch(/never a delta/i);
  });

  it("warns that a rejected criterion fails silently with a 200", () => {
    expect(flat).toMatch(/A rejected criterion fails SILENTLY/i);
    expect(flat).toMatch(/Never chart an untrusted count/i);
  });

  it("is honest about what cannot be built this way", () => {
    // A histogram or density map needs aggregation the API does not expose.
    expect(flat).toMatch(/What you cannot build this way/i);
    expect(flat).toMatch(/label the chart as a sample with its\s*n/i);
    expect(flat).toMatch(/Both want a backend stats endpoint/i);
  });

  it("records the observed 54s worst case so callers budget for it", () => {
    expect(flat).toMatch(/observed at \*\*54 s\*\*|54 s/);
    expect(flat).toMatch(/not a parallel burst/i);
  });
});
