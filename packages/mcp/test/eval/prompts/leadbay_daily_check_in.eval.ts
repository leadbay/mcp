/**
 * Eval suite for leadbay_daily_check_in.
 *
 * Sessions run via the claude CLI — Claude Code's auth is reused.
 * Selection: only runs when EVAL=1 and touchfile diff matches.
 */
import { describe, it } from "vitest";
import { dailyCheckInInvariants } from "../invariants/daily-check-in.js";
import { runScenarioEval, setupScenarioFixtures } from "../helpers/run-eval.js";
import { describeIfSelected, selectTouchedKeys } from "../helpers/touchfiles.js";
import { SCENARIO } from "../scenarios/daily-check-in/clean-batch.scenario.js";
import { SCENARIO as RENDERING_SCENARIO } from "../scenarios/daily-check-in/rendering-table-contract.scenario.js";

const selected = selectTouchedKeys();
const mode = describeIfSelected("leadbay_daily_check_in", selected);

describe.skipIf(mode === "skip")("eval: leadbay_daily_check_in", () => {
  setupScenarioFixtures(SCENARIO);

  it(`${SCENARIO.name} passes pyramid + invariants + mission-match`, async () => {
    await runScenarioEval({
      scenario: SCENARIO,
      invariants: dailyCheckInInvariants,
      max_turns: 12,
    });
  });
});

describe.skipIf(mode === "skip")(
  "eval: leadbay_daily_check_in — B23 rendering contract",
  () => {
    setupScenarioFixtures(RENDERING_SCENARIO);
    it(`${RENDERING_SCENARIO.name} renders pull-leads table + Today's nudges (not prose list)`, async () => {
      await runScenarioEval({
        scenario: RENDERING_SCENARIO,
        invariants: dailyCheckInInvariants,
        max_turns: 15,
      });
    });
  },
);
