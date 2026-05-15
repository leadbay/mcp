import { describe, it } from "vitest";
import { describeIfSelected, selectTouchedKeys } from "../helpers/touchfiles.js";
import { runScenarioEval, setupScenarioFixtures } from "../helpers/run-eval.js";
import { researchADomainInvariants } from "../invariants/research-a-domain.js";
import { SCENARIO } from "../scenarios/research-a-domain/clean-domain.scenario.js";

const mode = describeIfSelected("leadbay_research_a_domain", selectTouchedKeys());

describe.skipIf(mode === "skip")("eval: leadbay_research_a_domain", () => {
  setupScenarioFixtures(SCENARIO);
  it(`${SCENARIO.name} scenario passes pyramid + invariants + mission-match`, async () => {
    await runScenarioEval({ scenario: SCENARIO, invariants: researchADomainInvariants, max_turns: 15 });
  });
});
