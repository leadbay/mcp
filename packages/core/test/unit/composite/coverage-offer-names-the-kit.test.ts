import { describe, it, expect } from "vitest";
import { buildFollowupNextSteps } from "../../../src/composite/pull-followups.js";

// Sibling of board-offer-names-the-kit.test.ts, for the option that commit
// missed. Both live in buildFollowupNextSteps, eleven lines apart: the call
// board was given the kit's name and the coverage board was left with the
// generic "Build a coverage board …" wording.
//
// The coverage board needs the routing MORE than the call board does, because
// there is no reasonable hand-built fallback:
//
//   - the sector list must come from `lb.portfolioSectors`, which derives it
//     from the leads the user actually holds. The guide records what a
//     hardcoded list did to one real portfolio: it offered a sector holding 3
//     leads while omitting the third-largest at 555.
//   - each figure must come from `lb.segmentCount`, which compares the filter
//     the server echoed against the one it sent. The Monitor filter is
//     server-stored and stateful, and a rejected criterion returns 200 with
//     the PREVIOUS filter still applied — a plausible number answering a
//     different question, which a hand-rolled count charts without noticing.
//
// The option is emitted whether or not a filter is active (that gate was
// removed deliberately — a server-stored filter survives sessions, so gating
// on it suppressed the offer forever once someone filtered once), so both
// branches must carry the routing.

function coverageOption(hasActiveFilter: boolean) {
  const res = buildFollowupNextSteps(1, false, null, hasActiveFilter);
  return res?.options.find((o) => o.label === "Coverage board");
}

describe("the coverage-board offer names the kit and its helpers", () => {
  for (const [name, hasActiveFilter] of [
    ["unfiltered", false],
    ["filtered", true],
  ] as const) {
    describe(`${name} Monitor`, () => {
      const opt = coverageOption(hasActiveFilter);

      it("is offered at all", () => {
        expect(opt).toBeDefined();
        expect(opt!.kind).toBe("build_artifact");
      });

      it("names the tool", () => {
        expect(opt!.description).toContain("leadbay_get_artifact_runtime");
      });

      it("points at the segment-coverage recipe, not the triage-board one", () => {
        expect(opt!.description).toMatch(/segment-coverage recipe/i);
        expect(opt!.description).not.toMatch(/triage-board recipe/i);
      });

      it("names portfolioSectors and forbids a hardcoded sector list", () => {
        expect(opt!.description).toContain("lb.portfolioSectors");
        expect(opt!.description).toMatch(/never hardcode/i);
      });

      it("names segmentCount and why it is the one that counts", () => {
        expect(opt!.description).toContain("lb.segmentCount");
        expect(opt!.description).toMatch(/echoed filter/i);
      });

      it("keeps the label short enough for AskUserQuestion", () => {
        expect(opt!.label.split(/\s+/).length).toBeLessThanOrEqual(5);
      });
    });
  }

  it("keeps the filtered branch's own denominator warning", () => {
    // The routing is appended to the branch text, never a replacement for it.
    expect(coverageOption(true)!.description).toMatch(
      /measure unfiltered for the denominator/i,
    );
  });

  it("is not offered when there is nothing to measure", () => {
    expect(buildFollowupNextSteps(0, false, null, false)).toBeNull();
  });
});
