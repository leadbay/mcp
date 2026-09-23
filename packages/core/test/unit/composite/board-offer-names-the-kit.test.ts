import { describe, it, expect } from "vitest";
import { buildPullLeadsNextSteps } from "../../../src/composite/pull-leads.js";

// A batch tool's `next_steps` is the machine-readable half of the board offer,
// and it is what an agent actually acts on — the NEXT STEPS snippet's `Calls`
// column never reaches the payload.
//
// Shipping the offer pre-built (buildPullLeadsNextSteps) fixed the model
// DROPPING the board. It did not fix the model BUILDING it wrong: the option
// said "Build an interactive lead triage board" and named no tool, so
// `kind: "build_artifact"` was the only routing hint — and "artifact" is the
// generic verb, not "artifact kit".
//
// Observed failure: an agent read that option, went straight to the host's
// Artifact tool, hand-wrote a page with an invented palette, and persisted
// keep/skip to artifact-local storage. The board looked plausible and wrote
// NOTHING to Leadbay — no taste, no CRM status. The rep's triage evaporated.
//
// So the offer must name the tool in the text the model reads.

describe("the triage-board offer names leadbay_get_artifact_runtime", () => {
  const ns = buildPullLeadsNextSteps({
    leadCount: 5,
    hasMore: true,
    nextPage: 1,
  });

  it("is still the first option", () => {
    expect(ns).not.toBeNull();
    expect(ns!.options[0].kind).toBe("build_artifact");
  });

  it("names the tool, so the agent routes instead of hand-rolling", () => {
    expect(ns!.options[0].description).toContain("leadbay_get_artifact_runtime");
  });

  it("points at the canonical recipe rather than leaving the layout open", () => {
    // Without this the agent invents a card shape; the recipe is what makes
    // every board the same board.
    expect(ns!.options[0].description).toMatch(/canonical triage-board recipe/i);
  });

  it("says to build from the batch in hand, not to re-call the tool", () => {
    expect(ns!.options[0].description).toMatch(/in hand/i);
    expect(ns!.options[0].description).toMatch(/do NOT re-call/i);
  });

  it("keeps the label short enough for AskUserQuestion", () => {
    // The host caps option labels at ~5 words; the routing detail rides in the
    // description precisely so the label can stay a button.
    expect(ns!.options[0].label.split(/\s+/).length).toBeLessThanOrEqual(5);
  });

  it("leaves the warming-up branch alone — no board to offer yet", () => {
    const warming = buildPullLeadsNextSteps({
      leadCount: 0,
      hasMore: false,
      nextPage: null,
      computingWishlist: true,
    });
    expect(warming!.options.some((o) => o.description.includes("leadbay_get_artifact_runtime"))).toBe(
      false,
    );
  });
});
