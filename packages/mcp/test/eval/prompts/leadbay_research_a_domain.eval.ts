import { describe, it } from "vitest";
import { describeIfSelected, selectTouchedKeys } from "../helpers/touchfiles.js";
import { runScenarioEval, setupScenarioFixtures } from "../helpers/run-eval.js";
import { researchADomainInvariants } from "../invariants/research-a-domain.js";
import { SCENARIO } from "../scenarios/research-a-domain/clean-domain.scenario.js";
import { SCENARIO as RENDERING_SCENARIO } from "../scenarios/research-a-domain/rendering-card-contract.scenario.js";

const mode = describeIfSelected("leadbay_research_a_domain", selectTouchedKeys());

describe.skipIf(mode === "skip")("eval: leadbay_research_a_domain", () => {
  setupScenarioFixtures(SCENARIO);
  it(`${SCENARIO.name} scenario passes pyramid + invariants + mission-match`, async () => {
    await runScenarioEval({ scenario: SCENARIO, invariants: researchADomainInvariants, max_turns: 15 });
  });
});

// B23 regression — Phase 2 must defer to the research-company-card layout,
// not freeform narrative prose.
describe.skipIf(mode === "skip")(
  "eval: leadbay_research_a_domain — B23 rendering contract",
  () => {
    setupScenarioFixtures(RENDERING_SCENARIO);
    it(`${RENDERING_SCENARIO.name} renders research-company-card layout (not freeform narrative)`, async () => {
      await runScenarioEval({
        scenario: RENDERING_SCENARIO,
        invariants: researchADomainInvariants,
        max_turns: 15,
      });
    });
  },
);
