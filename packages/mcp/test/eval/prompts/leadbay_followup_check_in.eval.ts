import { describe, it } from "vitest";
import { describeIfSelected, selectTouchedKeys } from "../helpers/touchfiles.js";
import { runScenarioEval, setupScenarioFixtures } from "../helpers/run-eval.js";
import { followupCheckInInvariants } from "../invariants/followup-check-in.js";
import { SCENARIO as ROUTING_SCENARIO } from "../scenarios/followup-check-in/routing-regression.scenario.js";
import { SCENARIO as PIVOT_SCENARIO } from "../scenarios/followup-check-in/cross-mode-pivot.scenario.js";
import { SCENARIO as GEO_SCENARIO } from "../scenarios/followup-check-in/geo-followup.scenario.js";

const mode = describeIfSelected("leadbay_followup_check_in", selectTouchedKeys());

// Primary regression — Discover-vs-Monitor routing.
describe.skipIf(mode === "skip")("eval: leadbay_followup_check_in — routing", () => {
  setupScenarioFixtures(ROUTING_SCENARIO);
  it(`${ROUTING_SCENARIO.name} calls pull_followups (not pull_leads) + renders the canonical table`, async () => {
    await runScenarioEval({
      scenario: ROUTING_SCENARIO,
      invariants: followupCheckInInvariants,
      max_turns: 15,
    });
  });
});

// Cross-mode pivot — agent must recognize the pivot offer.
describe.skipIf(mode === "skip")(
  "eval: leadbay_followup_check_in — cross-mode pivot",
  () => {
    setupScenarioFixtures(PIVOT_SCENARIO);
    it(`${PIVOT_SCENARIO.name} surfaces the cross-mode pivot offer to discovery`, async () => {
      await runScenarioEval({
        scenario: PIVOT_SCENARIO,
        invariants: followupCheckInInvariants,
        max_turns: 15,
      });
    });
  },
);

// Geo follow-up — agent must NOT fabricate an admin_area_id.
describe.skipIf(mode === "skip")(
  "eval: leadbay_followup_check_in — geo",
  () => {
    setupScenarioFixtures(GEO_SCENARIO);
    it(`${GEO_SCENARIO.name} handles geo follow-up without fabricating admin_area_id`, async () => {
      await runScenarioEval({
        scenario: GEO_SCENARIO,
        invariants: followupCheckInInvariants,
        max_turns: 15,
      });
    });
  },
);
