import { describe, it } from "vitest";
import { describeIfSelected, selectTouchedKeys } from "../helpers/touchfiles.js";
import { runScenarioEval, setupScenarioFixtures } from "../helpers/run-eval.js";
import { logOutreachInvariants } from "../invariants/log-outreach.js";
import { SCENARIO } from "../scenarios/log-outreach/user-confirmed.scenario.js";

const mode = describeIfSelected("leadbay_log_outreach", selectTouchedKeys());

describe.skipIf(mode === "skip")("eval: leadbay_log_outreach", () => {
  setupScenarioFixtures(SCENARIO);
  it(`${SCENARIO.name} scenario passes pyramid + invariants + mission-match`, async () => {
    await runScenarioEval({ scenario: SCENARIO, invariants: logOutreachInvariants, max_turns: 12 });
  });
});
