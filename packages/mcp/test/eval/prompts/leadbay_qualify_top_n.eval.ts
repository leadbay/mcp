import { describe, it } from "vitest";
import { describeIfSelected, selectTouchedKeys } from "../helpers/touchfiles.js";
import { runScenarioEval, setupScenarioFixtures } from "../helpers/run-eval.js";
import { qualifyTopNInvariants } from "../invariants/qualify-top-n.js";
import { SCENARIO } from "../scenarios/qualify-top-n/default-batch.scenario.js";

const mode = describeIfSelected("leadbay_qualify_top_n", selectTouchedKeys());

describe.skipIf(mode === "skip")("eval: leadbay_qualify_top_n", () => {
  setupScenarioFixtures(SCENARIO);
  it(`${SCENARIO.name} scenario passes pyramid + invariants + mission-match`, async () => {
    await runScenarioEval({ scenario: SCENARIO, invariants: qualifyTopNInvariants, max_turns: 15 });
  });
});
