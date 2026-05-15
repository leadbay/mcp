/**
 * Canonical Evidence shape for MCP prompt/tool evaluations.
 *
 * Partitioned by source-of-truth (L1–L4) per the dolly blueprint §1.6,
 * adapted to MCP semantics: the "session" is a scripted Claude session
 * driving the in-process @leadbay/mcp Server; the "tool calls" are MCP
 * tool invocations; the "backend requests" are recorded Leadbay API
 * traffic (replayed in CI, recorded with EVAL_RECORD=1).
 *
 * Pyramid rule: `passed: true` requires L1 + L2 + L3 complete. L4 is
 * optional luxury, generated only after the test has otherwise passed.
 */

export type TerminalReason =
  | "agent_stopped"
  | "max_turns"
  | "tool_error"
  | "sdk_error"
  | "budget_exceeded";

export type EvalTier = "t0" | "t1" | "t2" | "t3" | "t4";

export interface ToolCallRecord {
  turn: number;
  name: string;
  input: unknown;
  output_summary: { ok: boolean; output_len: number; sample?: string };
  duration_ms: number;
}

export interface BackendRequestRecord {
  method: string;
  path: string;
  request_body_hash: string;
  response_status: number;
  response_body_hash: string;
  matched_recording?: string;
}

export interface TurnRecord {
  turn: number;
  role: "user" | "assistant" | "tool";
  text_len: number;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
}

export interface ProseBetweenToolCalls {
  after_turn: number;
  text: string;
}

export interface InvariantResult {
  name: string;
  pass: boolean;
  reason?: string;
}

export interface JudgeScores {
  mission_match: number;
  instruction_adherence: number;
  no_fabrication: number;
  tool_selection_fit: number;
}

export interface MCPEvidence {
  // L1 — Ground truth. Required for pass.
  session: {
    session_id: string;
    prompt_name: string;
    prompt_args: Record<string, string | undefined>;
    fixture_id?: string;
    terminal_reason: TerminalReason;
  };
  tool_calls: ToolCallRecord[];
  backend_requests: BackendRequestRecord[];
  final_agent_message: string;

  // L2 — Witness. Required for pass.
  transcript_path: string;
  turns: TurnRecord[];
  prose_between_tool_calls: ProseBetweenToolCalls[];

  // L3 — Synthesis. Required for pass.
  invariants: InvariantResult[];
  judge_scores?: JudgeScores;
  judge_reasoning?: string;
  failure_modes_present?: string[];

  // L4 — Optional luxury narrative.
  narrative?: string;
}

export interface EvalEntry {
  name: string;
  suite: "audit" | "integration" | "eval" | "replay";
  tier: EvalTier;
  touchfile_reason: string;
  passed: boolean;
  exit_reason: string;
  duration_ms: number;
  cost_usd_session: number;
  cost_usd_judges: number;
  turns_used: number;
  tool_call_count: number;
  tool_call_breakdown: Record<string, number>;
  shape_ratio: number;
  first_response_ms: number;
  max_inter_turn_ms: number;
  model: string;
  evidence: MCPEvidence;
}

/**
 * Pyramid check: an eval entry only deserves `passed: true` if every
 * required layer is complete. Empty `tool_calls` when the scenario
 * expected calls is an automatic L1 fail.
 */
export function isPyramidComplete(
  evidence: MCPEvidence,
  expected_calls: string[],
): { complete: boolean; missing: string[] } {
  const missing: string[] = [];

  // L1
  if (!evidence.session?.session_id) missing.push("L1.session.session_id");
  if (!evidence.session?.prompt_name) missing.push("L1.session.prompt_name");
  if (!evidence.session?.terminal_reason) missing.push("L1.session.terminal_reason");
  if (expected_calls.length > 0 && evidence.tool_calls.length === 0) {
    missing.push("L1.tool_calls (expected calls but none fired)");
  }
  if (!evidence.final_agent_message) missing.push("L1.final_agent_message");

  // L2
  if (!evidence.transcript_path) missing.push("L2.transcript_path");
  if (evidence.turns.length === 0) missing.push("L2.turns");

  // L3
  if (evidence.invariants.length === 0) missing.push("L3.invariants");
  // judge_scores may be absent when invariant pre-checks short-circuited,
  // so it isn't strictly required here; the test itself decides whether
  // the absence is fatal via its own assertion floor.

  return { complete: missing.length === 0, missing };
}

export function emptyEvidence(prompt_name: string): MCPEvidence {
  return {
    session: {
      session_id: "",
      prompt_name,
      prompt_args: {},
      terminal_reason: "sdk_error",
    },
    tool_calls: [],
    backend_requests: [],
    final_agent_message: "",
    transcript_path: "",
    turns: [],
    prose_between_tool_calls: [],
    invariants: [],
  };
}
