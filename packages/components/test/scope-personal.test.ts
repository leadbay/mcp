import { describe, it, expect, beforeEach } from "vitest";
import { lb, configure } from "../src/runtime.js";

// `leadbay_pull_followups` defaults `personal` to FALSE — the whole
// organisation. A board that never passes it therefore counts the org's book
// while its labels say "your leads". On a real admin account that gap was
// 7,232 org-wide against 115 personal: not a rounding difference, a different
// question.
//
// The helpers now forward the flag, and omit it entirely when the caller has
// no opinion, so the tool's own default still applies rather than the kit
// silently picking one.

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

const COUNT = { pagination: { total: 115 }, active_filters: { criteria: [] } };
const SAMPLE = { leads: [{ id: "1", sector_id: "5134" }] };

beforeEach(() => {
  calls = [];
});

describe("segmentCount scope", () => {
  it("asks for the caller's own book when personal is true", async () => {
    mock(COUNT);
    await lb.segmentCount({ personal: true, ask: "my coverage" });
    expect(calls[0].args.personal).toBe(true);
  });

  it("asks org-wide when personal is false", async () => {
    mock(COUNT);
    await lb.segmentCount({ personal: false, ask: "team coverage" });
    expect(calls[0].args.personal).toBe(false);
  });

  it("OMITS the flag when unspecified, leaving the tool's default intact", async () => {
    // Sending `personal: undefined` would serialise into the payload and is not
    // the same as not asking.
    mock(COUNT);
    await lb.segmentCount({ ask: "coverage" });
    expect("personal" in calls[0].args).toBe(false);
  });

  it("carries the scope alongside a sector filter", async () => {
    mock(COUNT);
    await lb.segmentCount({ sectorIds: ["5134"], personal: true, ask: "my supermarkets" });
    expect(calls[0].args.personal).toBe(true);
    const crit = (calls[0].args.set_filter as { criteria: unknown[] }).criteria;
    expect(crit).toEqual([{ type: "sector_ids", sectors: ["5134"], is_excluded: false }]);
  });
});

describe("portfolioSectors scope", () => {
  it("samples the caller's own book when personal is true", async () => {
    mock(SAMPLE);
    await lb.portfolioSectors({ personal: true, ask: "my sectors" });
    expect(calls[0].args.personal).toBe(true);
  });

  it("OMITS the flag when unspecified", async () => {
    mock(SAMPLE);
    await lb.portfolioSectors({ ask: "sectors" });
    expect("personal" in calls[0].args).toBe(false);
  });

  it("still reads the UNFILTERED book whatever the scope", async () => {
    // Scope and filter are independent: a stored Monitor filter would otherwise
    // narrow the sample to whatever was last measured.
    mock(SAMPLE);
    await lb.portfolioSectors({ personal: true, ask: "my sectors" });
    expect(calls[0].args.filtered).toBe(false);
  });
});

describe("the two scopes are consistent with each other", () => {
  it("a sector count and its dropdown sample agree on whose book it is", async () => {
    // The bug this prevents: a dropdown derived from the org's sectors above a
    // count of the user's leads, so the list offers sectors the user does not
    // hold and every one reads zero.
    mock(SAMPLE);
    await lb.portfolioSectors({ personal: true, ask: "x" });
    const sampleScope = calls[0].args.personal;
    mock(COUNT);
    await lb.segmentCount({ sectorIds: ["5134"], personal: true, ask: "x" });
    expect(calls[0].args.personal).toBe(sampleScope);
  });
});
