/**
 * Shared eval-suite runner. Each per-prompt eval.ts imports its scenario
 * and a per-prompt invariants module, then calls runScenarioEval() — the
 * generic shape: render → runSession → invariants → pyramid → judge →
 * EvalCollector entry → assertions.
 *
 * This factors out boilerplate so the 6 per-prompt eval files stay short
 * (~30 lines each) and only encode prompt-specific bits.
 *
 * Backend selection (in priority order):
 *   1. ANTHROPIC_API_KEY set → SDK runner (session-runner.ts) — fastest, full
 *      token counts. Used in CI.
 *   2. claude CLI in PATH → CLI runner (cli-session-runner.ts) — uses the
 *      user's Claude.ai subscription, no API key needed. Works inside Claude
 *      Code. Spins up a real MCP server process with fixtures baked in.
 *   3. Neither → clear error.
 */
import { expect, beforeAll } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { getPrompt } from "../../../src/prompts.js";
import { mockHttp } from "../../harness.js";
import { runSession } from "./session-runner.js";
import { runSessionCLI } from "./cli-session-runner.js";
import { hasCLI } from "./llm-judge-shared.js";
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

/** Used by the SDK runner path — sets up vi.mock(node:https) fixtures. */
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

function useSDKRunner(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export async function runScenarioEval(opts: RunScenarioEvalOpts): Promise<void> {
  const { scenario, invariants, max_turns = 20 } = opts;

  const rendered = getPrompt(scenario.prompt, scenario.args);
  const block = rendered.messages[0]?.content as { type: string; text?: string };
  const promptBody = block?.type === "text" && typeof block.text === "string" ? block.text : "";
  expect(promptBody.length, "prompt body should not be empty").toBeGreaterThan(50);

  let sessionResult: Awaited<ReturnType<typeof runSession>>;

  if (useSDKRunner()) {
    // SDK path: vi.mock(node:https) is already active via setupScenarioFixtures.
    const leadbayClient = new LeadbayClient({
      baseUrl: "https://api-us.example",
      bearer: "test-token-not-real",
    });
    sessionResult = await runSession({
      prompt: { name: scenario.prompt, body: promptBody, args: scenario.args },
      leadbayClient,
      transcript_dir: TRANSCRIPT_DIR,
      max_turns,
      fixture_id: scenario.name,
    });
  } else if (hasCLI()) {
    // CLI path: spawns fixture-mcp-server as a real MCP server, drives the
    // session via claude -p --input-format stream-json.
    sessionResult = await runSessionCLI({
      prompt: { name: scenario.prompt, body: promptBody, args: scenario.args },
      backendFixtures: scenario.backendFixtures,
      transcript_dir: TRANSCRIPT_DIR,
      max_turns,
      fixture_id: scenario.name,
    });
  } else {
    throw new Error(
      "No execution backend available. " +
      "Set ANTHROPIC_API_KEY for CI, or run inside Claude Code (claude CLI in PATH) " +
      "to use your subscription.",
    );
  }

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
