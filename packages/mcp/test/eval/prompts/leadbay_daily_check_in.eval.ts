/**
 * Eval suite for leadbay_daily_check_in.
 *
 * Runs the prompt against a scripted Claude session with mocked Leadbay
 * backend, captures Evidence, runs invariants, runs the mission-match
 * judge, asserts the floor.
 *
 * Selection: only runs when EVAL=1 and the touchfile diff indicates the
 * prompt or its dependencies changed.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { getPrompt } from "../../../src/prompts.js";
import { mockHttp } from "../../harness.js";
import { runSession } from "../helpers/session-runner.js";
import { dailyCheckInInvariants } from "../invariants/daily-check-in.js";
import { isPyramidComplete } from "../helpers/evidence.js";
import { runMissionMatchJudge } from "../helpers/mission-match-judge.js";
import { describeIfSelected, selectTouchedKeys } from "../helpers/touchfiles.js";
import {
  MISSION_MATCH_FLOOR,
  NO_FABRICATION_FLOOR,
} from "../helpers/budget-thresholds.js";
import { EvalCollector } from "../helpers/eval-collector.js";
import { SCENARIO } from "../scenarios/daily-check-in/clean-batch.scenario.js";
import { LeadbayClient } from "@leadbay/core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROMPTFORGE_ROOT = resolve(__dirname, "..", "..", "..", "..", "promptforge");
const TRANSCRIPT_DIR = resolve(__dirname, "..", "..", "..", "..", "..", ".context", "evals", "transcripts");

const selected = selectTouchedKeys();
const mode = describeIfSelected("leadbay_daily_check_in", selected);

describe.skipIf(mode === "skip")("eval: leadbay_daily_check_in", () => {
  const collector = new EvalCollector();

  beforeAll(() => {
    mockHttp(
      SCENARIO.backendFixtures.map((f) => ({
        method: f.method,
        path: f.path,
        status: f.status,
        body: f.body,
      })),
    );
  });

  it("clean-batch scenario passes pyramid + invariants + mission-match", async () => {
    // 1. Build the prompt body via the live MCP getPrompt() — same code
    //    path real clients hit.
    const rendered = getPrompt(SCENARIO.prompt, SCENARIO.args);
    const block = rendered.messages[0]?.content as { type: string; text?: string };
    const promptBody = block?.type === "text" && typeof block.text === "string" ? block.text : "";
    expect(promptBody.length).toBeGreaterThan(50);

    // 2. Run the session.
    const leadbayClient = new LeadbayClient({
      baseUrl: "https://api-us.example",
      bearer: "test-token-not-real",
    });
    const sessionResult = await runSession({
      prompt: { name: SCENARIO.prompt, body: promptBody, args: SCENARIO.args },
      leadbayClient,
      transcript_dir: TRANSCRIPT_DIR,
      max_turns: 12,
      fixture_id: SCENARIO.name,
    });

    // 3. Run invariants.
    const invariants = dailyCheckInInvariants(sessionResult.evidence);
    sessionResult.evidence.invariants = invariants;

    // 4. Pyramid completeness.
    const pyramid = isPyramidComplete(sessionResult.evidence, SCENARIO.mission.required_calls);

    // 5. Mission-match judge.
    const judgeOutcome = await runMissionMatchJudge({
      promptforgeRoot: PROMPTFORGE_ROOT,
      scenario: SCENARIO.mission,
      evidence: sessionResult.evidence,
    });

    if (judgeOutcome.ok) {
      sessionResult.evidence.judge_scores = judgeOutcome.value.scores;
      sessionResult.evidence.judge_reasoning = judgeOutcome.value.reasoning;
      sessionResult.evidence.failure_modes_present = judgeOutcome.value.failure_modes_present;
    }

    // 6. Record EvalEntry.
    const breakdown: Record<string, number> = {};
    for (const c of sessionResult.evidence.tool_calls) {
      breakdown[c.name] = (breakdown[c.name] ?? 0) + 1;
    }
    const passed =
      pyramid.complete &&
      invariants.every((i) => i.pass) &&
      judgeOutcome.ok &&
      judgeOutcome.value.scores.mission_match >= MISSION_MATCH_FLOOR &&
      judgeOutcome.value.scores.no_fabrication >= NO_FABRICATION_FLOOR;

    collector.add({
      name: "leadbay_daily_check_in/clean-batch",
      suite: "eval",
      tier: "t3",
      touchfile_reason: "selected by touchfile diff",
      passed,
      exit_reason: sessionResult.evidence.session.terminal_reason,
      duration_ms: sessionResult.durationMs,
      cost_usd_session: sessionResult.cost.cost_usd_session,
      cost_usd_judges: 0,
      turns_used: sessionResult.evidence.turns.length,
      tool_call_count: sessionResult.evidence.tool_calls.length,
      tool_call_breakdown: breakdown,
      shape_ratio:
        sessionResult.evidence.turns.length > 0
          ? sessionResult.evidence.tool_calls.length / sessionResult.evidence.turns.length
          : 0,
      first_response_ms: sessionResult.evidence.turns[0]?.latency_ms ?? 0,
      max_inter_turn_ms: Math.max(
        0,
        ...sessionResult.evidence.turns.map((t) => t.latency_ms),
      ),
      model: "claude-sonnet-4-6",
      evidence: sessionResult.evidence,
    });
    collector.finalize();

    // 7. Assertions.
    expect(pyramid.complete, `pyramid incomplete: ${pyramid.missing.join(", ")}`).toBe(true);
    const failedInvariants = invariants.filter((i) => !i.pass);
    expect(
      failedInvariants,
      `invariants failed: ${failedInvariants.map((i) => `${i.name} (${i.reason})`).join("; ")}`,
    ).toEqual([]);
    expect(judgeOutcome.ok, "judge call failed").toBe(true);
    if (judgeOutcome.ok) {
      expect(
        judgeOutcome.value.scores.mission_match,
        `mission_match below floor: ${judgeOutcome.value.scores.mission_match} (reasoning: ${judgeOutcome.value.reasoning})`,
      ).toBeGreaterThanOrEqual(MISSION_MATCH_FLOOR);
      expect(
        judgeOutcome.value.scores.no_fabrication,
        `no_fabrication below floor: ${judgeOutcome.value.scores.no_fabrication}`,
      ).toBeGreaterThanOrEqual(NO_FABRICATION_FLOOR);
    }
  });
});
