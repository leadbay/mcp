#!/usr/bin/env tsx
/**
 * run-workflow.ts — Run live eval sessions for one or more workflows.
 *
 * Usage:
 *   npx tsx test/eval/scripts/run-workflow.ts --workflow 1,3
 *   npx tsx test/eval/scripts/run-workflow.ts --workflow 1 --model claude-sonnet-4-6
 *   npx tsx test/eval/scripts/run-workflow.ts   # runs all 11 workflows
 *
 * Auth: reads LEADBAY_TOKEN + LEADBAY_REGION from the environment.
 *
 * Each workflow is run against the real Leadbay test account (no fixtures).
 * Results are saved to EvalCollector and a summary table is printed at the end.
 * Exit code 1 if any workflow failed.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getWorkflowExpected, getWorkflowScenario, type WorkflowExpected } from "../helpers/workflows-parser.js";
import { runSessionLive } from "../helpers/live-session-runner.js";
import { getPrompt } from "../../../src/prompts.js";
import { isPyramidComplete, type MCPEvidence, type InvariantResult } from "../helpers/evidence.js";
import { runMissionMatchJudge, type MissionMatchScenario } from "../helpers/mission-match-judge.js";
import { MISSION_MATCH_FLOOR } from "../helpers/budget-thresholds.js";
import { EvalCollector } from "../helpers/eval-collector.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROMPTFORGE_ROOT = resolve(__dirname, "..", "..", "..", "..", "promptforge");
const TRANSCRIPT_DIR = resolve(__dirname, "..", "..", "..", "..", "..", ".context", "evals", "transcripts");

// ---------------------------------------------------------------------------
// Workflow → prompt name mapping.
// Workflows without a dedicated MCP prompt (e.g. #8 outreach drafting) map
// to null — the user message from the scenario block is used directly.
// ---------------------------------------------------------------------------

const WORKFLOW_PROMPT: Record<number, string | null> = {
  1:  "leadbay_daily_check_in",
  2:  "leadbay_followup_check_in",
  3:  "leadbay_research_a_domain",
  4:  "leadbay_import_file",
  5:  "leadbay_qualify_top_n",
  6:  "leadbay_refine_audience",
  7:  "leadbay_prospecting_overview",
  8:  null,   // no dedicated MCP prompt — agent uses tools directly from user message
  9:  "leadbay_log_outreach",
  10: "leadbay_plan_tour_in_city",
  11: "leadbay_setup_team_prospecting",
};

// Workflow names for the summary table.
const WORKFLOW_NAME: Record<number, string> = {
  1:  "Daily lead discovery",
  2:  "Follow-up check-in",
  3:  "Single-domain research",
  4:  "CSV import + qualify",
  5:  "AI qualify top-N",
  6:  "Audience refinement",
  7:  "Prospecting overview",
  8:  "Outreach drafting",
  9:  "Outreach logging",
  10: "Field sales tour",
  11: "Team prospecting",
};

const ALL_WORKFLOW_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

// ---------------------------------------------------------------------------
// deriveInvariants — builds InvariantResult[] from a WorkflowExpected
// ---------------------------------------------------------------------------

function deriveInvariants(evidence: MCPEvidence, expected: WorkflowExpected): InvariantResult[] {
  const results: InvariantResult[] = [];

  for (const name of expected.required_calls) {
    const count = evidence.tool_calls.filter((c) => c.name === name).length;
    results.push({
      name: `called_at_least_once.${name}`,
      pass: count >= 1,
      reason: count >= 1 ? undefined : `expected ≥1 call, observed ${count}`,
    });
  }

  for (const name of expected.forbidden_calls) {
    const count = evidence.tool_calls.filter((c) => c.name === name).length;
    results.push({
      name: `never_called.${name}`,
      pass: count === 0,
      reason: count === 0 ? undefined : `forbidden tool called ${count} times`,
    });
  }

  if (expected.required_order.length >= 2) {
    const sequence = expected.required_order;
    const observed: string[] = [];
    for (const c of evidence.tool_calls) {
      if (sequence.includes(c.name)) observed.push(c.name);
    }
    let i = 0;
    let orderOk = true;
    for (const name of sequence) {
      const idx = observed.indexOf(name, i);
      if (idx === -1) { orderOk = false; break; }
      i = idx + 1;
    }
    results.push({
      name: "called_in_order",
      pass: orderOk,
      reason: orderOk
        ? undefined
        : `sequence ${sequence.join(" → ")} not observed (got: ${observed.join(", ")})`,
    });
  }

  const haystack =
    evidence.final_agent_message + "\n" +
    evidence.prose_between_tool_calls.map((p) => p.text).join("\n");
  for (const needle of expected.required_byproducts) {
    results.push({
      name: `byproduct_present.${needle.slice(0, 30)}`,
      pass: haystack.includes(needle),
      reason: haystack.includes(needle) ? undefined : `expected phrase not in agent prose: "${needle}"`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// buildMissionScenario
// ---------------------------------------------------------------------------

function buildMissionScenario(
  workflowId: number,
  promptName: string,
  expected: WorkflowExpected,
): MissionMatchScenario {
  return {
    prompt_name: promptName,
    scenario_name: `workflow-${workflowId}`,
    user_intent: expected.success_criteria[0] ?? `workflow #${workflowId} contract`,
    required_calls: expected.required_calls,
    required_byproducts: expected.required_byproducts,
    forbidden_calls: expected.forbidden_calls,
    success_criteria: expected.success_criteria,
  };
}

// ---------------------------------------------------------------------------
// runOneWorkflow
// ---------------------------------------------------------------------------

interface WorkflowResult {
  id: number;
  name: string;
  passed: boolean;
  scores: { mission_match: number; instruction_adherence: number; no_fabrication: number; tool_selection_fit: number } | null;
  durationMs: number;
  error?: string;
}

async function runOneWorkflow(
  id: number,
  collector: EvalCollector,
  model?: string,
): Promise<WorkflowResult> {
  const workflowName = WORKFLOW_NAME[id] ?? `Workflow #${id}`;
  const promptNameOrNull = WORKFLOW_PROMPT[id];
  // promptNameOrNull may be undefined (key not in map) or null (no dedicated prompt).
  if (promptNameOrNull === undefined) {
    return { id, name: workflowName, passed: false, scores: null, durationMs: 0, error: `no prompt mapping for workflow #${id}` };
  }

  let expected: WorkflowExpected;
  let scenarioPrompt: string;

  try {
    expected = getWorkflowExpected(id);
    scenarioPrompt = getWorkflowScenario(id).prompt;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { id, name: workflowName, passed: false, scores: null, durationMs: 0, error: msg };
  }

  // Inject the MCP prompt body as a system prompt so the agent has full
  // phase instructions. The user message (scenarioPrompt) triggers routing;
  // the system prompt carries the execution instructions — same as the
  // fixture-based evals but pulling from the real prompts registry.
  const promptName = promptNameOrNull ?? `workflow-${id}`;
  let systemPrompt: string | undefined;
  if (promptNameOrNull !== null) {
    try {
      const rendered = getPrompt(promptNameOrNull, {});
      const block = rendered.messages[0]?.content as { type: string; text?: string };
      const body = block?.type === "text" && typeof block.text === "string" ? block.text : "";
      if (body.length >= 50) systemPrompt = body;
    } catch { /* no system prompt — agent uses bare user message */ }
  }

  const missionScenario = buildMissionScenario(id, promptName, expected);

  let sessionResult;
  try {
    sessionResult = await runSessionLive({
      prompt: { name: promptName, body: scenarioPrompt, args: {} },
      systemPrompt,
      transcript_dir: TRANSCRIPT_DIR,
      max_turns: 20,
      fixture_id: `workflow-${id}`,
      model,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { id, name: workflowName, passed: false, scores: null, durationMs: 0, error: `session failed: ${msg}` };
  }

  const inv = deriveInvariants(sessionResult.evidence, expected);
  sessionResult.evidence.invariants = inv;

  const pyramid = isPyramidComplete(sessionResult.evidence, expected.required_calls);

  const judgeOutcome = await runMissionMatchJudge({
    promptforgeRoot: PROMPTFORGE_ROOT,
    scenario: missionScenario,
    evidence: sessionResult.evidence,
  });

  if (judgeOutcome.ok) {
    sessionResult.evidence.judge_scores = judgeOutcome.value.scores;
    sessionResult.evidence.judge_reasoning = judgeOutcome.value.reasoning;
    sessionResult.evidence.failure_modes_present = judgeOutcome.value.failure_modes_present;
    sessionResult.evidence.per_criterion = judgeOutcome.value.per_criterion;
  }

  // Print per-workflow scorecard.
  if (judgeOutcome.ok) {
    const s = judgeOutcome.value.scores;
    const lines = [
      `\n── eval: workflow #${id} — ${workflowName} ─────────────────────────`,
      `  prompt: ${scenarioPrompt}`,
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
    lines.push("──────────────────────────────────────────────────────────────");
    console.log(lines.join("\n"));
  } else {
    console.log(`\n── eval: workflow #${id} — ${workflowName} — judge failed ──`);
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

  collector.add({
    name: `${promptName}/workflow-${id}`,
    suite: "eval",
    tier: "t3",
    touchfile_reason: "run-workflow script",
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
    model: model ?? process.env.EVAL_MODEL ?? "claude-sonnet-4-6",
    evidence: sessionResult.evidence,
  });

  return {
    id,
    name: workflowName,
    passed,
    scores: judgeOutcome.ok ? judgeOutcome.value.scores : null,
    durationMs: sessionResult.durationMs,
  };
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { workflowIds: number[]; model?: string } {
  const args = process.argv.slice(2);
  let workflowIds: number[] = [];
  let model: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--workflow" && args[i + 1]) {
      workflowIds = args[i + 1].split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
      i++;
    } else if (args[i] === "--model" && args[i + 1]) {
      model = args[i + 1];
      i++;
    }
  }

  if (workflowIds.length === 0) {
    workflowIds = ALL_WORKFLOW_IDS;
  }

  return { workflowIds, model };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { workflowIds, model } = parseArgs();

  console.log(`\nLeadbay live eval — workflows: ${workflowIds.join(", ")}`);
  if (model) console.log(`Model: ${model}`);
  console.log(`Token: ${process.env.LEADBAY_TOKEN ? "set" : "NOT SET — will fail"}`);
  console.log(`Region: ${process.env.LEADBAY_REGION ?? "us (default)"}\n`);

  const collector = new EvalCollector();
  const results: WorkflowResult[] = [];

  for (const id of workflowIds) {
    console.log(`\nRunning workflow #${id}: ${WORKFLOW_NAME[id] ?? "unknown"}…`);
    const result = await runOneWorkflow(id, collector, model);
    results.push(result);
  }

  collector.finalize();

  // Summary table.
  const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);

  console.log("\n");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Live Eval Summary");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(
    `  ${"#".padEnd(3)} ${"Workflow".padEnd(28)} ${"Result".padEnd(8)} ${"MM".padEnd(4)} ${"IA".padEnd(4)} ${"NF".padEnd(4)} ${"TSF".padEnd(4)} ${"Time".padEnd(7)}`
  );
  console.log("  " + "─".repeat(65));

  let anyFailed = false;
  for (const r of results) {
    const status = r.error ? "ERROR" : r.passed ? "PASS" : "FAIL";
    if (!r.passed) anyFailed = true;
    const mm = r.scores ? String(r.scores.mission_match) : "-";
    const ia = r.scores ? String(r.scores.instruction_adherence) : "-";
    const nf = r.scores ? String(r.scores.no_fabrication) : "-";
    const tsf = r.scores ? String(r.scores.tool_selection_fit) : "-";
    const dur = `${(r.durationMs / 1000).toFixed(1)}s`;
    console.log(
      `  ${pad(String(r.id), 3)} ${pad(r.name, 28)} ${pad(status, 8)} ${pad(mm, 4)} ${pad(ia, 4)} ${pad(nf, 4)} ${pad(tsf, 4)} ${dur}`
    );
    if (r.error) {
      console.log(`      ERROR: ${r.error}`);
    }
  }

  console.log("═══════════════════════════════════════════════════════════════");

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log(`\n  ${passed}/${total} workflows passed.\n`);

  if (anyFailed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("run-workflow fatal:", err);
  process.exit(1);
});
