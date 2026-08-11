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
