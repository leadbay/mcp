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

const MCP_SERVER = readFileSync(
  resolve(__dirname, "../eval/helpers/live-mcp-server.ts"),
  "utf8",
);

describe("audit: eval runner guards", () => {
  it("blocks paid endpoints BEFORE dispatch, not after the session", () => {
    // The post-hoc input check could only report a spend that had already
    // happened: by the time it ran, the live server had called the real API
    // and charged the account. The block now sits at the HTTP boundary, so it
    // holds regardless of which tool or argument shape reaches for it.
    expect(MCP_SERVER).toMatch(/LEADBAY_EVAL_NO_PAID_CALLS/);
    expect(MCP_SERVER).toMatch(/PAID_PATHS/);
    // Which paths those patterns actually cover is tested behaviourally in
    // eval-no-spend-paths.test.ts — a source grep can't tell a guard that
    // blocks every reveal route from one that blocks only the bulk endpoint,
    // which is precisely how the first version leaked.
    expect(MCP_SERVER).toMatch(/refused/);
    // …and the runner must arm it BEFORE runSessionLive, not after.
    const armIdx = RUNNER.indexOf("LEADBAY_EVAL_NO_PAID_CALLS");
    const runIdx = RUNNER.indexOf("await runSessionLive");
    expect(armIdx, "kill switch must be armed before the session").toBeGreaterThan(-1);
    expect(armIdx).toBeLessThan(runIdx);
  });

  it("required_order walks the SUCCEEDED sequence", () => {
    // On the raw list, a failed account_status then a successful pull_leads
    // then a successful account_status satisfies account_status → pull_leads,
    // though the real order is reversed.
    expect(RUNNER).toMatch(/okSequence/);
    expect(RUNNER).toMatch(/succeeded \$\{okSequence/);
  });

  it("an unresolved tool call is a failure, not a success", () => {
    // Provisional records start not-ok, and anything still pending at session
    // end is swept — a result that never arrived is evidence of nothing.
    expect(SESSION).toMatch(/no tool_result observed/);
    expect(SESSION).toMatch(/session ended before this call's tool_result arrived/);
  });
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

  it("the whitelist admits mandatory setup, and only that", () => {
    // leadbay_daily_check_in opens with leadbay_account_status, so a scenario
    // scoped to pull_leads would otherwise flag a correct precheck as stray.
    // The exemption is one named call, not the prompt's full expected_calls —
    // that would let its whole workflow through and void the declared scope.
    expect(RUNNER).toMatch(/PROMPT_SETUP_CALLS/);
    expect(RUNNER).toMatch(/leadbay_account_status/);
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

  it("scopes per-turn success to the turn that declared it", () => {
    // Searching the whole session let a success on any other turn mask a
    // failure on the turn under test.
    expect(RUNNER).toMatch(/c\.turn === i \+ 1/);
  });

  it("has no memory-tool exemption left to get wrong", () => {
    // The exemption existed because the server instructions told the agent to
    // capture and recall on its own initiative, so memory traffic was protocol
    // rather than scope. With the memory tools retired (product#3996) there is
    // no such traffic, and an exemption for tools that no longer exist would
    // silently widen what counts as in-scope.
    expect(RUNNER).not.toMatch(/agentMemory/);
    expect(RUNNER).not.toMatch(/leadbay_get_agent_memory/);
  });

  it("whitelists only mandatory setup, not a prompt's whole success path", () => {
    // Folding in every expected_call would let the prompt's entire workflow
    // through and defeat the point of a scenario declaring its scope.
    expect(RUNNER).toMatch(/PROMPT_SETUP_CALLS/);
    expect(RUNNER).not.toMatch(/\.\.\.promptExpected/);
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
