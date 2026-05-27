/**
 * Eval suite for leadbay_plan_tour_in_city (WORKFLOWS.md #10).
 *
 * Tests that the agent calls leadbay_tour_plan (not raw pull_followups +
 * pull_leads), produces a mixed Monitor + Discover itinerary for the
 * requested city, filters out geo-mismatched Discover leads, and does not
 * log outreach unilaterally.
 */
import { describe, it } from "vitest";
import { describeIfSelected, selectTouchedKeys } from "../helpers/touchfiles.js";
import { runScenarioEval, setupScenarioFixtures } from "../helpers/run-eval.js";
import { planTourInCityInvariants } from "../invariants/plan-tour-in-city.js";
import { SCENARIO } from "../scenarios/plan-tour-in-city/city-itinerary.scenario.js";

const mode = describeIfSelected("leadbay_plan_tour_in_city", selectTouchedKeys());

describe.skipIf(mode === "skip")("eval: leadbay_plan_tour_in_city", () => {
  setupScenarioFixtures(SCENARIO);
  it(`${SCENARIO.name} passes pyramid + invariants + mission-match`, async () => {
    await runScenarioEval({
      scenario: SCENARIO,
      invariants: planTourInCityInvariants,
      max_turns: 15,
    });
  });
});
