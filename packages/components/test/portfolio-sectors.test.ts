import { describe, it, expect, beforeEach } from "vitest";
import { lb, configure } from "../src/runtime.js";

// The board's sector dropdown was four hand-typed options. Measured against a
// real 7,232-lead portfolio, that list was wrong in both directions: it offered
// a sector holding 3 leads, and omitted the third-largest one (5152, 555 leads)
// entirely.
//
// There is no group-by on the Monitor, but every lead carries `sector_id`, so
// one page of followups names the sectors that actually matter. This is the
// cheap honest answer — NOT paging all 7,232 leads, which is 37 calls to refine
// an ordering the first page already gets right.

const SECTORS = {
  "5134": "Supermarchés",
  "5136": "Hypermarchés",
  "5152": "Commerce de détail de quincaillerie",
  "5133": "Supérettes",
};

/** Shapes a followups response from a list of sector ids, one lead each. */
const leadsFrom = (ids: Array<string | null>) => ({
  leads: ids.map((sector_id) => ({ id: "x", sector_id })),
});

let calls: Array<{ tool: string; args: Record<string, unknown> }>;
const mock = (res: unknown) => {
  calls = [];
  configure({
    call: async (tool: string, args: Record<string, unknown>) => {
      calls.push({ tool, args });
      return res;
    },
  });
};

beforeEach(() => {
  calls = [];
});

describe("lb.portfolioSectors", () => {
  it("tallies sector_id off real followups and resolves the names", async () => {
    mock(leadsFrom(["5134", "5134", "5136", "5152"]));
    const out = await lb.portfolioSectors({ sectors: SECTORS, ask: "coverage" });
    expect(out.map((s) => [s.id, s.sampled, s.label])).toEqual([
      ["5134", 2, "Supermarchés"],
      ["5136", 1, "Hypermarchés"],
      ["5152", 1, "Commerce de détail de quincaillerie"],
    ]);
  });

  it("orders by the USER's holding, not by sector size", async () => {
    // The whole point: 5152 outranks 5133 here because this user holds more of
    // it, though nationally Supérettes is the larger sector.
    mock(leadsFrom(["5133", "5152", "5152", "5152"]));
    const out = await lb.portfolioSectors({ sectors: SECTORS, ask: "coverage" });
    expect(out[0].id).toBe("5152");
    expect(out[0].sampled).toBe(3);
  });

  it("takes ONE page, not the whole portfolio", async () => {
    mock(leadsFrom(["5134"]));
    await lb.portfolioSectors({ sectors: SECTORS, ask: "coverage" });
    expect(calls).toHaveLength(1);
    expect(calls[0].tool).toBe("leadbay_pull_followups");
    expect(calls[0].args.count).toBe(200);
  });

  it("reads the UNFILTERED book, so a stored filter cannot skew the list", async () => {
    // The Monitor filter is server-side and sticky: whatever the last call set
    // is still in force. Sampling through it would report that filter's sectors
    // as the portfolio's.
    mock(leadsFrom(["5134"]));
    await lb.portfolioSectors({ sectors: SECTORS, ask: "coverage" });
    expect(calls[0].args.filtered).toBe(false);
  });

  it("honours a custom sample size", async () => {
    mock(leadsFrom(["5134"]));
    await lb.portfolioSectors({ sample: 50, sectors: SECTORS, ask: "coverage" });
    expect(calls[0].args.count).toBe(50);
  });

  it("labels an id the taxonomy does not carry, rather than blanking it", async () => {
    // 5154 appeared in a real sample and is absent from the visible taxonomy —
    // invisible sectors need includeInvisible. An unresolved id is expected.
    mock(leadsFrom(["5154", "5134"]));
    const out = await lb.portfolioSectors({ sectors: SECTORS, ask: "coverage" });
    const odd = out.find((s) => s.id === "5154")!;
    expect(odd.label).toBe("Sector 5154");
    expect(odd.resolved).toBe(false);
    expect(out.find((s) => s.id === "5134")!.resolved).toBe(true);
  });

  it("skips leads with no sector rather than inventing a bucket", async () => {
    mock(leadsFrom(["5134", null, "", "5134"]));
    const out = await lb.portfolioSectors({ sectors: SECTORS, ask: "coverage" });
    expect(out).toHaveLength(1);
    expect(out[0].sampled).toBe(2);
  });

  it("returns an empty list for an empty book, without throwing", async () => {
    mock({ leads: [] });
    await expect(lb.portfolioSectors({ sectors: SECTORS, ask: "x" })).resolves.toEqual([]);
    mock({});
    await expect(lb.portfolioSectors({ sectors: SECTORS, ask: "x" })).resolves.toEqual([]);
  });

  it("works with no taxonomy at all — every label falls back", async () => {
    mock(leadsFrom(["5134", "5136"]));
    const out = await lb.portfolioSectors({ ask: "coverage" });
    expect(out.every((s) => !s.resolved)).toBe(true);
    expect(out[0].label).toMatch(/^Sector \d+$/);
  });

  it("carries the trigger phrase through to the call", async () => {
    mock(leadsFrom(["5134"]));
    await lb.portfolioSectors({ sectors: SECTORS, ask: "how well do we cover sector X" });
    expect(calls[0].args._triggered_by).toBe("how well do we cover sector X");
  });
});
