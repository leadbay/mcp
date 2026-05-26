/**
 * Shared eval-suite runner. Each per-prompt eval.ts imports its scenario
 * and a per-prompt invariants module, then calls runScenarioEval().
 *
 * Sessions always run via the claude CLI — no ANTHROPIC_API_KEY needed.
 * Claude Code's auth (subscription or API key) is reused transparently.
 *
 * Shape: render prompt → runSessionCLI → invariants → pyramid → judge →
 *        EvalCollector entry → assertions.
 */
import { expect } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { getPrompt } from "../../../src/prompts.js";
import { runSessionCLI } from "./cli-session-runner.js";
import { isPyramidComplete, type MCPEvidence, type InvariantResult } from "./evidence.js";
import { runMissionMatchJudge, type MissionMatchScenario } from "./mission-match-judge.js";
import { MISSION_MATCH_FLOOR, NO_FABRICATION_FLOOR } from "./budget-thresholds.js";
import { EvalCollector } from "./eval-collector.js";

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

/**
 * No-op kept for call-site compatibility. The CLI runner receives fixtures
 * directly via the EVAL_FIXTURES env var — no vi.mock setup needed.
 */
export function setupScenarioFixtures(_scenario: ScenarioLike): void {}

export async function runScenarioEval(opts: RunScenarioEvalOpts): Promise<void> {
  const { scenario, invariants, max_turns = 20 } = opts;

  const rendered = getPrompt(scenario.prompt, scenario.args);
  const block = rendered.messages[0]?.content as { type: string; text?: string };
  const promptBody = block?.type === "text" && typeof block.text === "string" ? block.text : "";
  expect(promptBody.length, "prompt body should not be empty").toBeGreaterThan(50);

  const sessionResult = await runSessionCLI({
    prompt: { name: scenario.prompt, body: promptBody, args: scenario.args },
    backendFixtures: scenario.backendFixtures,
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
    sessionResult.evidence.per_criterion = judgeOutcome.value.per_criterion;
  }

  if (judgeOutcome.ok) {
    const s = judgeOutcome.value.scores;
    const lines = [
      `\n── eval: ${scenario.name} ──────────────────────────────`,
      `  mission_match:          ${s.mission_match}/5`,
      `  instruction_adherence:  ${s.instruction_adherence}/5`,
      `  no_fabrication:         ${s.no_fabrication}/5`,
      `  tool_selection_fit:     ${s.tool_selection_fit}/5`,
    ];
    if (judgeOutcome.value.per_criterion?.length) {
      lines.push("  criteria:");
      for (const c of judgeOutcome.value.per_criterion) {
        lines.push(`    [${c.pass ? "✓" : "✗"}] ${c.criterion}`);
        lines.push(`        → ${c.reasoning}`);
      }
    }
    lines.push(`  tools called: ${sessionResult.evidence.tool_calls.map((t) => t.name).join(" → ")}`);
    lines.push(`  turns: ${sessionResult.evidence.turns.length}  duration: ${(sessionResult.durationMs / 1000).toFixed(1)}s`);
    lines.push("──────────────────────────────────────────────────");
    console.log(lines.join("\n"));
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
    model: process.env.EVAL_MODEL ?? "claude-sonnet-4-6",
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
