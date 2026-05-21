import { describe, it } from "vitest";
import { describeIfSelected, selectTouchedKeys } from "../helpers/touchfiles.js";
import { runScenarioEval, setupScenarioFixtures } from "../helpers/run-eval.js";
import { workCampaignInvariants } from "../invariants/work-campaign.js";
import { SCENARIO } from "../scenarios/work-campaign/default-readiness.scenario.js";

const mode = describeIfSelected("leadbay_work_campaign", selectTouchedKeys());

describe.skipIf(mode === "skip")("eval: leadbay_work_campaign", () => {
  setupScenarioFixtures(SCENARIO);
  it(`${SCENARIO.name} scenario passes pyramid + invariants + mission-match`, async () => {
    await runScenarioEval({ scenario: SCENARIO, invariants: workCampaignInvariants, max_turns: 12 });
  });
});
