/**
 * Shared eval-suite runner. Each per-prompt eval.ts imports its scenario
 * and a per-prompt invariants module, then calls runScenarioEval() — the
 * generic shape: render → runSession → invariants → pyramid → judge →
 * EvalCollector entry → assertions.
 *
 * This factors out boilerplate so the 6 per-prompt eval files stay short
 * (~30 lines each) and only encode prompt-specific bits.
 */
import { expect, beforeAll } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { getPrompt } from "../../../src/prompts.js";
import { mockHttp } from "../../harness.js";
import { runSession } from "./session-runner.js";
import { isPyramidComplete, type MCPEvidence, type InvariantResult } from "./evidence.js";
import { runMissionMatchJudge, type MissionMatchScenario } from "./mission-match-judge.js";
import { MISSION_MATCH_FLOOR, NO_FABRICATION_FLOOR } from "./budget-thresholds.js";
import { EvalCollector } from "./eval-collector.js";
import { LeadbayClient } from "@leadbay/core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROMPTFORGE_ROOT = resolve(__dirname, "..", "..", "..", "..", "promptforge");
const TRANSCRIPT_DIR = resolve(__dirname, "..", "..", "..", "..", "..", ".context", "evals", "transcripts");

export interface BackendFixture {
  method: string;
  path: string | RegExp;
  status: number;
  body: unknown;
}

export interface ScenarioLike {
  name: string;
  prompt: string;
  tier: "gate" | "periodic";
  args: Record<string, string | undefined>;
  backendFixtures: BackendFixture[];
  mission: MissionMatchScenario;
}

export interface RunScenarioEvalOpts {
  scenario: ScenarioLike;
  invariants: (e: MCPEvidence) => InvariantResult[];
  max_turns?: number;
}

export function setupScenarioFixtures(scenario: ScenarioLike): void {
  beforeAll(() => {
    mockHttp(
      scenario.backendFixtures.map((f) => ({
        method: f.method,
        path: f.path,
        status: f.status,
        body: f.body,
      })),
    );
  });
}

export async function runScenarioEval(opts: RunScenarioEvalOpts): Promise<void> {
  const { scenario, invariants, max_turns = 20 } = opts;

  const rendered = getPrompt(scenario.prompt, scenario.args);
  const block = rendered.messages[0]?.content as { type: string; text?: string };
  const promptBody = block?.type === "text" && typeof block.text === "string" ? block.text : "";
  expect(promptBody.length, "prompt body should not be empty").toBeGreaterThan(50);

  const leadbayClient = new LeadbayClient({
    baseUrl: "https://api-us.example",
    bearer: "test-token-not-real",
  });

  const sessionResult = await runSession({
    prompt: { name: scenario.prompt, body: promptBody, args: scenario.args },
    leadbayClient,
    transcript_dir: TRANSCRIPT_DIR,
    max_turns,
    fixture_id: scenario.name,
  });

  const inv = invariants(sessionResult.evidence);
  sessionResult.evidence.invariants = inv;

  const pyramid = isPyramidComplete(sessionResult.evidence, scenario.mission.required_calls);

  const judgeOutcome = await runMissionMatchJudge({
    promptforgeRoot: PROMPTFORGE_ROOT,
    scenario: scenario.mission,
    evidence: sessionResult.evidence,
  });
  if (judgeOutcome.ok) {
    sessionResult.evidence.judge_scores = judgeOutcome.value.scores;
    sessionResult.evidence.judge_reasoning = judgeOutcome.value.reasoning;
    sessionResult.evidence.failure_modes_present = judgeOutcome.value.failure_modes_present;
  }

  const breakdown: Record<string, number> = {};
  for (const c of sessionResult.evidence.tool_calls) {
    breakdown[c.name] = (breakdown[c.name] ?? 0) + 1;
  }
  const passed =
    pyramid.complete &&
    inv.every((i) => i.pass) &&
    judgeOutcome.ok &&
    judgeOutcome.value.scores.mission_match >= MISSION_MATCH_FLOOR;

  const collector = new EvalCollector();
  collector.add({
    name: `${scenario.prompt}/${scenario.name}`,
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
    max_inter_turn_ms: Math.max(0, ...sessionResult.evidence.turns.map((t) => t.latency_ms)),
    model: "claude-sonnet-4-6",
    evidence: sessionResult.evidence,
  });
  collector.finalize();

  expect(pyramid.complete, `pyramid incomplete: ${pyramid.missing.join(", ")}`).toBe(true);
  const failed = inv.filter((i) => !i.pass);
  expect(failed, `invariants failed: ${failed.map((i) => `${i.name} (${i.reason})`).join("; ")}`).toEqual([]);
  expect(judgeOutcome.ok, "judge call failed").toBe(true);
  if (judgeOutcome.ok) {
    expect(judgeOutcome.value.scores.mission_match).toBeGreaterThanOrEqual(MISSION_MATCH_FLOOR);
    expect(judgeOutcome.value.scores.no_fabrication).toBeGreaterThanOrEqual(NO_FABRICATION_FLOOR);
  }
}
