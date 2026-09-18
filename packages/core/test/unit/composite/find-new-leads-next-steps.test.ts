import { describe, it, expect } from "vitest";
import { buildFindNewLeadsNextSteps } from "../../../src/composite/find-new-leads.js";

// find_new_leads relied on a snippet row in its description — one of EIGHT the
// model picks 2-3 from, competing with rows about stalled jobs, cost caps and
// quota stops that are genuinely more urgent. The board could legitimately lose
// that contest. next_steps is mapped into the host widget verbatim and in
// order, so the offer no longer depends on that judgement.
//
// The branching is the reason prose could not express it: a board is only the
// right offer when rows actually LANDED.

type Opt = { label: string; description: string; kind: string };
type Steps = { question: string; options: Opt[] } | null;

/** The builder is pure, so these exercise it directly — no HTTP harness, and
 *  the branch conditions are named rather than reconstructed from a mocked
 *  job snapshot. */
function buildVia(state: {
  delivered: number;
  stillRunning: boolean;
  stopReason?: string | null;
  truncated?: boolean;
}): Steps {
  return buildFindNewLeadsNextSteps(
    state.delivered,
    state.stillRunning,
    state.stopReason ?? null,
    state.truncated ?? false,
    "job-1",
  ) as Steps;
}

describe("leadbay_find_new_leads NEXT STEPS", () => {
  it("leads with the board once rows have landed", () => {
    const s = buildVia({ delivered: 10, stillRunning: false })!;
    expect(s.options[0].kind).toBe("build_artifact");
    expect(s.options[0].label).toBe("Triage board");
  });

  it("does NOT lead with a board while the job is still running", () => {
    // A half-empty board in front of the user is worse than a wait.
    const s = buildVia({ delivered: 0, stillRunning: true })!;
    expect(s.options[0].kind).toBe("pull_next_page");
    expect(s.options.some((o) => o.kind === "build_artifact")).toBe(false);
  });

  it("offers a partial board when a running job has already delivered", () => {
    const s = buildVia({ delivered: 4, stillRunning: true })!;
    expect(s.options[0].label).toBe("Check progress");
    const board = s.options.find((o) => o.kind === "build_artifact");
    expect(board?.description).toMatch(/delivered so far/i);
  });

  it("offers a reshape, not a board, when nothing was delivered", () => {
    const s = buildVia({ delivered: 0, stillRunning: false })!;
    expect(s.options.some((o) => o.kind === "build_artifact")).toBe(false);
    expect(s.options[0].label).toBe("Reshape and retry");
  });

  it("surfaces a cost-cap stop right after the board", () => {
    const s = buildVia({ delivered: 6, stillRunning: false, stopReason: "max_cost" })!;
    expect(s.options[0].kind).toBe("build_artifact");
    expect(s.options[1].label).toBe("Raise the cap");
  });

  it("surfaces a quota stop right after the board", () => {
    const s = buildVia({ delivered: 6, stillRunning: false, stopReason: "quota" })!;
    expect(s.options[1].label).toBe("Check quota");
  });

  it("offers the paid-for rows a truncated drain left behind", () => {
    const s = buildVia({ delivered: 50, stillRunning: false, truncated: true })!;
    expect(s.options.some((o) => o.label === "Fetch the rest")).toBe(true);
  });

  it("never exceeds the widget's four-option cap", () => {
    // Worst case: delivered + a stop reason + truncation + qualify.
    const s = buildVia({
      delivered: 50,
      stillRunning: false,
      stopReason: "max_cost",
      truncated: true,
    })!;
    expect(s.options.length).toBeLessThanOrEqual(4);
    expect(s.options[0].kind).toBe("build_artifact");
  });

  it("every option carries label, description and kind", () => {
    const s = buildVia({ delivered: 10, stillRunning: false })!;
    expect(s.question).toBeTruthy();
    for (const o of s.options) {
      expect(o.label).toBeTruthy();
      expect(o.description).toBeTruthy();
      expect(o.kind).toBeTruthy();
      // Labels are button text on AskUserQuestion — five words at most.
      expect(o.label.split(/\s+/).length).toBeLessThanOrEqual(5);
      // A description that merely repeats the label tells the agent nothing.
      expect(o.description.length).toBeGreaterThan(o.label.length);
    }
  });
});
