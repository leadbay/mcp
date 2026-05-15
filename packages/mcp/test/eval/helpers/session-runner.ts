/**
 * Session runner: drive a scripted Claude session against the in-process
 * @leadbay/mcp Server, capture the full MCPEvidence trail.
 *
 * Architecture:
 *   - Tools come from @leadbay/core's exported registries (compositeReadTools,
 *     compositeWriteTools, granularReadTools, granularWriteTools).
 *   - Each Tool's inputSchema becomes an Anthropic `tools[]` entry.
 *   - When the agent emits a `tool_use` block, the runner dispatches to the
 *     matching Tool.execute() with a mocked LeadbayClient (HTTP intercepted
 *     by backend-recorder).
 *   - The conversation continues until stop_reason="end_turn" OR max_turns,
 *     OR the agent exceeds a budget.
 *   - The runner returns Evidence with L1 (tool calls + final message),
 *     L2 (transcript + turns), and the leftover L3 fields for invariants
 *     and the judge to fill in.
 *
 * This is the bridge between Anthropic's tool_use protocol and the MCP
 * server's executeTool path. We deliberately do NOT spin up a real MCP
 * server process; we wire the tool registry directly. Same code paths,
 * 100x faster, fully deterministic.
 */
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type {
  Tool,
  LeadbayClient,
  ToolContext,
} from "@leadbay/core";
import {
  compositeReadTools,
  compositeWriteTools,
  granularReadTools,
  granularWriteTools,
} from "@leadbay/core";
import type {
  MCPEvidence,
  ToolCallRecord,
  TurnRecord,
  ProseBetweenToolCalls,
  TerminalReason,
} from "./evidence.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TURNS = 25;

export interface RunSessionOpts {
  prompt: { name: string; body: string; args: Record<string, string | undefined> };
  client?: Anthropic;
  model?: string;
  max_turns?: number;
  fixture_id?: string;
  /** Mocked HTTP client passed to every Tool.execute. */
  leadbayClient: LeadbayClient;
  /** Where to write the transcript jsonl. */
  transcript_dir: string;
  /** Optional restriction: only expose this subset of tools (defaults: all). */
  tool_subset?: string[];
  /** Optional budget — runner halts and writes terminal_reason=budget_exceeded if exceeded. */
  budget_max_turns?: number;
  budget_max_tokens?: number;
}

export interface SessionResult {
  evidence: MCPEvidence;
  cost: {
    tokens_in: number;
    tokens_out: number;
    cost_usd_session: number;
  };
  durationMs: number;
}

function allTools(): Tool[] {
  // De-dup by name (some tools are listed in both granular and composite
  // — the live design surfaces them in both for file-import companions).
  const seen = new Set<string>();
  const out: Tool[] = [];
  for (const t of [
    ...compositeReadTools,
    ...compositeWriteTools,
    ...granularReadTools,
    ...granularWriteTools,
  ]) {
    if (seen.has(t.name)) continue;
    seen.add(t.name);
    out.push(t);
  }
  return out;
}

function toAnthropicTools(
  tools: Tool[],
): Array<{ name: string; description: string; input_schema: Anthropic.Messages.Tool["input_schema"] }> {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Messages.Tool["input_schema"],
  }));
}

// Crude Sonnet pricing approximation: revise when running real billing.
function approxCostUsd(tokens_in: number, tokens_out: number): number {
  // $3/MTok input, $15/MTok output (Sonnet 4.6 list prices, 2026).
  return (tokens_in * 3 + tokens_out * 15) / 1_000_000;
}

function summarizeOutput(value: unknown): { ok: boolean; output_len: number; sample?: string } {
  try {
    const str = typeof value === "string" ? value : JSON.stringify(value);
    return {
      ok: true,
      output_len: str.length,
      sample: str.slice(0, 240),
    };
  } catch (err) {
    return { ok: false, output_len: 0, sample: String(err).slice(0, 240) };
  }
}

function hashForId(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

export async function runSession(opts: RunSessionOpts): Promise<SessionResult> {
  const startedAt = Date.now();
  const client = opts.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
  const model = opts.model ?? DEFAULT_MODEL;
  const max_turns = opts.budget_max_turns ?? opts.max_turns ?? DEFAULT_MAX_TURNS;
  const session_id = randomUUID();
  const transcriptPath = join(opts.transcript_dir, `${session_id}.transcript.jsonl`);
  mkdirSync(opts.transcript_dir, { recursive: true });

  const everyTool = allTools();
  const filteredTools = opts.tool_subset
    ? everyTool.filter((t) => opts.tool_subset!.includes(t.name))
    : everyTool;
  const toolByName = new Map(filteredTools.map((t) => [t.name, t]));
  const anthropicTools = toAnthropicTools(filteredTools);

  const evidence: MCPEvidence = {
    session: {
      session_id,
      prompt_name: opts.prompt.name,
      prompt_args: opts.prompt.args,
      fixture_id: opts.fixture_id,
      terminal_reason: "agent_stopped",
    },
    tool_calls: [],
    backend_requests: [],
    final_agent_message: "",
    transcript_path: transcriptPath,
    turns: [],
    prose_between_tool_calls: [],
    invariants: [],
  };

  let tokens_in_total = 0;
  let tokens_out_total = 0;
  let turn = 0;
  let lastFinishTs = startedAt;

  const transcriptHandle = openTranscript(transcriptPath);
  transcriptHandle.append({ kind: "session-start", session_id, prompt_name: opts.prompt.name, args: opts.prompt.args });

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: opts.prompt.body },
  ];
  transcriptHandle.append({ kind: "user-message", text_len: opts.prompt.body.length });

  const ctx: ToolContext = {
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  };

  let terminal_reason: TerminalReason = "agent_stopped";

  // The agent loop.
  while (turn < max_turns) {
    turn += 1;
    if (opts.budget_max_tokens && tokens_in_total + tokens_out_total >= opts.budget_max_tokens) {
      terminal_reason = "budget_exceeded";
      break;
    }

    let response: Anthropic.Messages.Message;
    try {
      response = await client.messages.create({
        model,
        max_tokens: 4096,
        tools: anthropicTools,
        messages,
      });
    } catch (err) {
      terminal_reason = "sdk_error";
      transcriptHandle.append({ kind: "sdk-error", turn, error: String((err as Error).message ?? err) });
      break;
    }

    tokens_in_total += response.usage.input_tokens;
    tokens_out_total += response.usage.output_tokens;
    const latency_ms = Date.now() - lastFinishTs;
    lastFinishTs = Date.now();

    const assistantBlocks = response.content;
    const assistantText = assistantBlocks
      .filter((b) => b.type === "text")
      .map((b) => ("text" in b ? b.text : ""))
      .join("\n");

    const assistantTurn: TurnRecord = {
      turn,
      role: "assistant",
      text_len: assistantText.length,
      tokens_in: response.usage.input_tokens,
      tokens_out: response.usage.output_tokens,
      latency_ms,
    };
    evidence.turns.push(assistantTurn);
    transcriptHandle.append({
      kind: "assistant-turn",
      turn,
      stop_reason: response.stop_reason,
      blocks: assistantBlocks.map((b) => b.type),
      text_len: assistantText.length,
    });

    // Record any text emitted between the previous tool call and this one.
    if (assistantText.length > 0) {
      evidence.prose_between_tool_calls.push({ after_turn: turn, text: assistantText });
    }

    if (response.stop_reason === "end_turn" || response.stop_reason === "stop_sequence") {
      evidence.final_agent_message = assistantText;
      terminal_reason = "agent_stopped";
      break;
    }
    if (response.stop_reason === "max_tokens") {
      terminal_reason = "budget_exceeded";
      break;
    }
    if (response.stop_reason !== "tool_use") {
      terminal_reason = "agent_stopped";
      evidence.final_agent_message = assistantText;
      break;
    }

    // Dispatch every tool_use block to the matching Tool.execute.
    const toolUseBlocks = assistantBlocks.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
    );

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const tool = toolByName.get(block.name);
      const startedToolAt = Date.now();
      if (!tool) {
        const record: ToolCallRecord = {
          turn,
          name: block.name,
          input: block.input,
          output_summary: { ok: false, output_len: 0, sample: `unknown tool: ${block.name}` },
          duration_ms: 0,
        };
        evidence.tool_calls.push(record);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify({ error: `tool not registered: ${block.name}` }),
          is_error: true,
        });
        continue;
      }
      try {
        const result = await tool.execute(opts.leadbayClient, block.input as never, ctx);
        const summary = summarizeOutput(result);
        evidence.tool_calls.push({
          turn,
          name: tool.name,
          input: block.input,
          output_summary: summary,
          duration_ms: Date.now() - startedToolAt,
        });
        transcriptHandle.append({
          kind: "tool-call",
          turn,
          name: tool.name,
          input_hash: hashForId(JSON.stringify(block.input ?? {})),
          output_len: summary.output_len,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: typeof result === "string" ? result : JSON.stringify(result),
        });
      } catch (err) {
        const message = String((err as Error).message ?? err);
        evidence.tool_calls.push({
          turn,
          name: tool.name,
          input: block.input,
          output_summary: { ok: false, output_len: message.length, sample: message.slice(0, 240) },
          duration_ms: Date.now() - startedToolAt,
        });
        transcriptHandle.append({ kind: "tool-error", turn, name: tool.name, error: message });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify({ error: message }),
          is_error: true,
        });
      }
    }

    messages.push({ role: "assistant", content: assistantBlocks });
    messages.push({ role: "user", content: toolResults });
  }

  if (turn >= max_turns && terminal_reason === "agent_stopped") {
    terminal_reason = "max_turns";
  }

  evidence.session.terminal_reason = terminal_reason;
  transcriptHandle.append({ kind: "session-end", terminal_reason, turns: turn });
  transcriptHandle.close();

  const cost_usd_session = approxCostUsd(tokens_in_total, tokens_out_total);

  return {
    evidence,
    cost: { tokens_in: tokens_in_total, tokens_out: tokens_out_total, cost_usd_session },
    durationMs: Date.now() - startedAt,
  };
}

interface TranscriptHandle {
  append: (entry: Record<string, unknown>) => void;
  close: () => void;
}

function openTranscript(path: string): TranscriptHandle {
  const lines: string[] = [];
  return {
    append: (entry) => {
      lines.push(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
    },
    close: () => writeFileSync(path, lines.join("\n") + "\n", "utf8"),
  };
}
