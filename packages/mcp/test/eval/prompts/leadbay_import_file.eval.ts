/**
 * Eval suite for leadbay_import_file.
 * Sessions run via the claude CLI — Claude Code's auth is reused.
 */
import { describe, it } from "vitest";
import { importFileInvariants } from "../invariants/import-file.js";
import { runScenarioEval, setupScenarioFixtures } from "../helpers/run-eval.js";
import { describeIfSelected, selectTouchedKeys } from "../helpers/touchfiles.js";
import { SCENARIO } from "../scenarios/import-file/dirty-hubspot-deals.scenario.js";

const selected = selectTouchedKeys();
const mode = describeIfSelected("leadbay_import_file", selected);

describe.skipIf(mode === "skip")("eval: leadbay_import_file", () => {
  setupScenarioFixtures(SCENARIO);

  it(`${SCENARIO.name} passes pyramid + invariants + mission-match`, async () => {
    await runScenarioEval({
      scenario: SCENARIO,
      invariants: importFileInvariants,
      max_turns: 25,
    });
  });
});
