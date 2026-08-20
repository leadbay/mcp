/**
 * `forbidden_calls` must be enforced BEFORE the live session, not asserted after it.
 *
 * `scenarios.eval.ts` iterates the recorded calls once `runSessionLive` has
 * returned. On a live run that is an assertion about a mutation it did not
 * prevent: the live server enables write tools and points at the real API, so a
 * regression calling `leadbay_new_lens` / `leadbay_adjust_audience` /
 * `leadbay_update_lens_filter` had already written to the test tenant by the
 * time the check ran. A scenario whose whole claim is "this must mutate
 * nothing" cannot be the thing that mutates it.
 *
 * This is the same lesson the no-spend switch learned earlier — it was moved to
 * the HTTP boundary after a post-hoc check let a real charge through — so it is
 * pinned the same way, and separately, so neither can regress on its own.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RUNNER = readFileSync(resolve(__dirname, "../eval/scenarios.eval.ts"), "utf8");
const MCP_SERVER = readFileSync(
  resolve(__dirname, "../eval/helpers/live-mcp-server.ts"),
  "utf8",
);

describe("audit: forbidden_calls are armed before the session", () => {
  it("the runner exports the denylist to the server BEFORE runSessionLive", () => {
    const armIdx = RUNNER.indexOf("LEADBAY_EVAL_FORBIDDEN_TOOLS");
    const runIdx = RUNNER.indexOf("await runSessionLive");
    expect(
      armIdx,
      "scenarios.eval.ts must pass mission.forbidden_calls to the live server"
    ).toBeGreaterThan(-1);
    expect(
      armIdx,
      "the denylist must be armed BEFORE the session, or it only reports mutations that already happened"
    ).toBeLessThan(runIdx);
  });

  it("the runner clears it between scenarios", () => {
    // A leaked denylist would silently disarm write tools for every later
    // scenario in the same process, and those scenarios would still pass.
    expect(RUNNER).toMatch(/delete process\.env\.LEADBAY_EVAL_FORBIDDEN_TOOLS/);
  });

  it("the live server refuses the call before any HTTP", () => {
    expect(MCP_SERVER).toMatch(/LEADBAY_EVAL_FORBIDDEN_TOOLS/);
    expect(MCP_SERVER).toMatch(/EVAL_FORBIDDEN_CALL/);
    // It must replace `execute`, not filter the catalog: an agent cannot call a
    // tool it cannot see, so hiding it would make every forbidden_calls
    // assertion vacuously true.
    expect(
      MCP_SERVER,
      "the forbidden tool must stay listed and throw on execute, not be removed from the catalog"
    ).toMatch(/tool\.execute = async/);
  });

  it("an unknown tool name in forbidden_calls is a hard error", () => {
    // Otherwise a rename or typo arms nothing, and the scenario reads as a pass
    // while protecting the tenant from nothing at all.
    expect(MCP_SERVER).toMatch(/unmatched/);
    expect(MCP_SERVER).toMatch(/forbidden_calls names unknown tools/);
  });
});
