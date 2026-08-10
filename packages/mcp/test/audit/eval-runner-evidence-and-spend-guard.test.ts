/**
 * Audit: the eval-runner half of the #175 review findings.
 *
 * The live runner drives the real API, so two of its defects were expensive
 * rather than merely wrong:
 *   - tool results were never recorded, so a call that ERRORED still satisfied
 *     `required_calls` and reached the judge as a success;
 *   - `allowed_calls` was declared by scenarios and read by nobody;
 *   - the no-spend scenario leaned on a missing fixture, but fixtures are
 *     ignored on the live path — so the regression it guards would have been
 *     paid for in real credits.
 *
 * These assert the SOURCE contracts, because the runner itself only executes
 * under EVAL=1 with a live token and the `claude` CLI on PATH.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const EVAL_DIR = resolve(__dirname, "../eval");
const read = (p: string) => readFileSync(resolve(EVAL_DIR, p), "utf8");

const RUNNER = read("scenarios.eval.ts");
const SESSION = read("helpers/live-session-runner.ts");
const SERVER = read("helpers/live-mcp-server.ts");
const NO_SPEND = read("scenarios/getting-started/no-unprompted-enrich-spend.scenario.ts");

describe("audit: eval runner evidence + spend guard", () => {
  it("the session runner patches tool_result outcomes into the evidence", () => {
    // The record starts optimistic; the tool_result branch is what makes it
    // true. Without the patch every call reads ok:true forever.
    expect(SESSION).toMatch(/pendingResults/);
    expect(SESSION).toMatch(/tool_result/);
    expect(SESSION).toMatch(/function readToolResult/);
    // Our tools return {error:true,…} with a 200, so transport success alone
    // must not count as ok.
    expect(SESSION).toMatch(/is_error/);
    expect(SESSION).toMatch(/\.error === true/);
  });

  it("required_calls is satisfied only by calls that SUCCEEDED", () => {
    expect(RUNNER).toMatch(/output_summary\.ok/);
    expect(RUNNER).toMatch(/const succeeded/);
    // required + order read the succeeded set…
    expect(RUNNER).toMatch(/expect\(\s*succeeded,\s*\n?\s*`required call/);
    expect(RUNNER).toMatch(/for \(const name of succeeded\) if \(name === order\[cursor\]\)/);
    // …while forbidden still reads every call that FIRED: attempting a banned
    // call is the violation, whether or not it came back green.
    expect(RUNNER).toMatch(/expect\(called, `forbidden call \$\{name\} fired`\)/);
  });

  it("allowed_calls is enforced as a whitelist before the judge runs", () => {
    expect(RUNNER).toMatch(/sc\.mission\.allowed_calls\?\.length/);
    expect(RUNNER).toMatch(/outside allowed_calls/);
    // The whitelist has to admit the calls the scenario already declares
    // elsewhere, or every scenario using it fails on its own required calls.
    expect(RUNNER).toMatch(/\.\.\.\(sc\.mission\.required_calls \?\? \[\]\)/);
    expect(RUNNER).toMatch(/expect_calls/);
    // It must run BEFORE the judge — a scope breach is deterministic, and
    // deciding it on a judge score is the bug being fixed.
    expect(RUNNER.indexOf("outside allowed_calls")).toBeLessThan(
      RUNNER.indexOf("runMissionMatchJudge({"),
    );
  });

  it("the paid enrichment launch is blocked in no-spend scenarios", () => {
    // Guard lives in the spawned server, before the network.
    expect(SERVER).toMatch(/EVAL_NO_SPEND/);
    expect(SERVER).toMatch(/enrichment\\\/launch|enrichment\/launch/);
    expect(SERVER).toMatch(/withSpendGuard/);
    // Free discovery must stay live, or the scenario's own happy path dies.
    expect(SERVER).not.toMatch(/enrichment\/preview.*PAID|job_titles.*PAID/);

    // Threaded through the runner and switched on by the scenario itself.
    expect(SESSION).toMatch(/noSpend/);
    expect(RUNNER).toMatch(/noSpend: sc\.noSpend === true/);
    expect(NO_SPEND).toMatch(/noSpend: true/);
  });
});
