/**
 * Audit: the eval runner's own guards, from the Codex review on PR #175.
 *
 * These are source-level assertions rather than a live run, because the thing
 * being pinned is that the runner CANNOT be satisfied by a failed call, a
 * stray tool, or an unblocked paid launch. A live eval proves the happy path;
 * only reading the guards proves they exist at all — and all three were absent
 * on the run that scored 5/5/5/5, which is exactly why that score was softer
 * evidence than it looked.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RUNNER = readFileSync(
  resolve(__dirname, "../eval/scenarios.eval.ts"),
  "utf8",
);
const SESSION = readFileSync(
  resolve(__dirname, "../eval/helpers/live-session-runner.ts"),
  "utf8",
);

describe("audit: eval runner guards", () => {
  it("records each tool call's REAL outcome from its tool_result", () => {
    // The runner used to stamp every call `ok: true, output_len: 0` and never
    // revisit it, so a call failing with LAST_PROMPT_REQUIRED or BAD_INPUT
    // still satisfied required_calls and reached the judge as a success.
    expect(SESSION).toMatch(/pendingToolCalls/);
    expect(SESSION).toMatch(/event\.type === "user"/);
    expect(SESSION).toMatch(/tool_result/);
    // The outcome must consider both the host's is_error flag and a 200-shaped
    // error envelope, which is how these tools actually report failure.
    expect(SESSION).toMatch(/is_error/);
    expect(SESSION).toMatch(/enveloped/);
  });

  it("a failed required call does not satisfy required_calls", () => {
    expect(RUNNER).toMatch(/output_summary\.ok/);
    expect(RUNNER).toMatch(/fired but FAILED/);
  });

  it("enforces allowed_calls instead of only collecting it", () => {
    // Scenarios declared a whitelist that was never checked, so a consent
    // scenario could fan out to extra real tools and still be judged purely
    // on prose.
    expect(RUNNER).toMatch(/allowed_calls/);
    expect(RUNNER).toMatch(/outside required \+ allowed_calls/);
  });

  it("the spend guard is actually wired to where scenarios declare it", () => {
    // It shipped declared at the scenario top level and read from `mission`,
    // so it never once ran — a guard that exists in review but not at runtime
    // is worse than no guard, because it reads as covered. The runner now
    // accepts both placements.
    expect(RUNNER).toMatch(/sc\.mission\.no_paid_calls \|\| sc\.no_paid_calls/);
    const scenario = readFileSync(
      resolve(__dirname, "../eval/scenarios/getting-started/no-unprompted-enrich-spend.scenario.ts"),
      "utf8",
    );
    expect(scenario).toMatch(/no_paid_calls:\s*true/);
    // …and it sits inside mission, the canonical home.
    const missionIdx = scenario.indexOf("mission: {");
    expect(scenario.indexOf("no_paid_calls")).toBeGreaterThan(missionIdx);
  });

  it("per-turn expect_calls require SUCCESS, not just presence", () => {
    // The judge's own pre-check reads raw evidence and ignores outcomes, so a
    // failed call could satisfy a turn and reach the judge looking fine.
    expect(RUNNER).toMatch(/expected call \$\{name\} never succeeded/);
    expect(RUNNER).toMatch(/fired but FAILED/);
  });

  it("the whitelist admits the prompt's own mandated setup calls", () => {
    // leadbay_daily_check_in opens with leadbay_account_status; a scenario
    // listing only pull_leads would otherwise flag a correct precheck as stray.
    expect(RUNNER).toMatch(/PROMPT_META/);
    expect(RUNNER).toMatch(/expected_calls/);
  });

  it("only a TOP-LEVEL error envelope marks a call failed", () => {
    // A nested uppercase `code` is routine in a successful result —
    // account_status returns user+org plus quota_error.code when the quota
    // subrequest fails, and the prompt handles that. The old whole-JSON regex
    // marked those calls failed.
    expect(SESSION).toMatch(/top\.error !== undefined/);
    expect(SESSION).toMatch(/top\.ok === false/);
    expect(SESSION).not.toMatch(/"code"\\s\*:\\s\*"\[A-Z_\]\+"/);
  });

  it("blocks paid calls structurally, not via ignored fixtures", () => {
    // backendFixtures cannot gate spend: the live runner ignores fixtures and
    // calls the real API, so "no launch fixture" would have let a regression
    // charge the account rather than fail on an undeclared endpoint.
    expect(RUNNER).toMatch(/no_paid_calls/);
    expect(RUNNER).toMatch(/must never spend/);
    // Checked on real inputs — the args that actually cost money.
    expect(RUNNER).toMatch(/i\.confirm === true/);
    expect(RUNNER).toMatch(/i\.email === true/);
    expect(RUNNER).toMatch(/i\.enrich === true/);
  });
});
