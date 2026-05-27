/**
 * Eval suite for leadbay_prospecting_overview (WORKFLOWS.md #7).
 *
 * Tests that the agent calls leadbay_account_status, reports factual
 * quota/state data, and proposes a concrete next step without executing
 * anything unilaterally.
 */
import { describe, it } from "vitest";
import { describeIfSelected, selectTouchedKeys } from "../helpers/touchfiles.js";
import { runScenarioEval, setupScenarioFixtures } from "../helpers/run-eval.js";
import { prospectingOverviewInvariants } from "../invariants/prospecting-overview.js";
import { SCENARIO } from "../scenarios/prospecting-overview/account-state-report.scenario.js";

const mode = describeIfSelected("leadbay_prospecting_overview", selectTouchedKeys());

describe.skipIf(mode === "skip")("eval: leadbay_prospecting_overview", () => {
  setupScenarioFixtures(SCENARIO);
  it(`${SCENARIO.name} passes pyramid + invariants + mission-match`, async () => {
    await runScenarioEval({
      scenario: SCENARIO,
      invariants: prospectingOverviewInvariants,
      max_turns: 10,
    });
  });
});
