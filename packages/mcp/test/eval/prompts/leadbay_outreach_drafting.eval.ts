/**
 * Eval suite for outreach drafting workflow (WORKFLOWS.md #8).
 *
 * There is no dedicated MCP prompt for outreach drafting — the agent uses
 * leadbay_prepare_outreach + leadbay_research_lead_by_id directly. This
 * eval tests the tool-level contract: the brief is assembled, the draft
 * uses real data, and report_outreach is NOT called (that is a separate
 * user-initiated step).
 */
import { describe, it } from "vitest";
import { describeIfSelected, selectTouchedKeys } from "../helpers/touchfiles.js";
import { runScenarioEval, setupScenarioFixtures } from "../helpers/run-eval.js";
import { outreachDraftingInvariants } from "../invariants/outreach-drafting.js";
import { SCENARIO } from "../scenarios/outreach-drafting/prepare-brief.scenario.js";

const mode = describeIfSelected("leadbay_outreach_drafting", selectTouchedKeys());

describe.skipIf(mode === "skip")("eval: outreach drafting (leadbay_prepare_outreach)", () => {
  setupScenarioFixtures(SCENARIO);
  it(`${SCENARIO.name} passes pyramid + invariants + mission-match`, async () => {
    await runScenarioEval({
      scenario: SCENARIO,
      invariants: outreachDraftingInvariants,
      max_turns: 12,
    });
  });
});
