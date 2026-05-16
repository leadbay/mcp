import { describe, it } from "vitest";
import { describeIfSelected, selectTouchedKeys } from "../helpers/touchfiles.js";
import { runScenarioEval, setupScenarioFixtures } from "../helpers/run-eval.js";
import { qualifyTopNInvariants } from "../invariants/qualify-top-n.js";
import { SCENARIO } from "../scenarios/qualify-top-n/default-batch.scenario.js";
import { SCENARIO as RENDERING_SCENARIO } from "../scenarios/qualify-top-n/rendering-refresh-table.scenario.js";

const mode = describeIfSelected("leadbay_qualify_top_n", selectTouchedKeys());

describe.skipIf(mode === "skip")("eval: leadbay_qualify_top_n", () => {
  setupScenarioFixtures(SCENARIO);
  it(`${SCENARIO.name} scenario passes pyramid + invariants + mission-match`, async () => {
    await runScenarioEval({ scenario: SCENARIO, invariants: qualifyTopNInvariants, max_turns: 15 });
  });
});

// B23 regression — Phase 3 must defer to pull-leads-table + status-inline,
// not freeform summary prose.
describe.skipIf(mode === "skip")(
  "eval: leadbay_qualify_top_n — B23 rendering contract",
  () => {
    setupScenarioFixtures(RENDERING_SCENARIO);
    it(`${RENDERING_SCENARIO.name} renders qualify-status inline + pull-leads-table refresh (not prose summary)`, async () => {
      await runScenarioEval({
        scenario: RENDERING_SCENARIO,
        invariants: qualifyTopNInvariants,
        max_turns: 15,
      });
    });
  },
);
