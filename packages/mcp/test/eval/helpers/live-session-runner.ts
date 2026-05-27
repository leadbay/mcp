/**
 * Live session runner — drives a Leadbay eval session against the real
 * Leadbay API using the claude CLI.
 *
 * How it works:
 *   1. Write a temp eval settings file (clears hooks, disables plugins).
 *   2. Write a temp MCP config JSON that tells claude to spawn our
 *      live-mcp-server.ts (which uses real Leadbay auth, no HTTP mocking).
 *   3. Spawn: claude -p --input-format stream-json --output-format stream-json
 *             --verbose --mcp-config <tmp.json> --bare
 *   4. Write the initial user message to stdin as stream-json.
 *   5. Parse stdout events — collect tool_use calls, text blocks, results.
 *   6. Return the same MCPEvidence shape as cli-session-runner.ts.
 *
 * Differences from cli-session-runner.ts:
 *   - No BackendFixture serialisation — real HTTP goes to api-us.leadbay.app.
 *   - MCP server name is "leadbay-live" → --allowedTools mcp__leadbay-live__*.
 *   - LEADBAY_TOKEN + LEADBAY_REGION env vars passed to the spawned server.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import type {
  MCPEvidence,
  ToolCallRecord,
  TurnRecord,
  TerminalReason,
} from "./evidence.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to the live server source (compiled at runtime by tsx).
const LIVE_SERVER_SRC = resolve(__dirname, "live-mcp-server.ts");

// Resolve the tsx binary by walking up from the workspace root.
function findTsx(): string {
  const candidates = [
    resolve(__dirname, "..", "..", "..", "..", "..", "node_modules", ".pnpm", "node_modules", ".bin", "tsx"),
    resolve(__dirname, "..", "..", "..", "..", "..", "node_modules", ".bin", "tsx"),
    "tsx",
  ];
  for (const c of candidates) {
    try {
      if (c === "tsx") return c;
      const { existsSync } = require("node:fs") as typeof import("node:fs");
      if (existsSync(c)) return c;
    } catch { /* continue */ }
  }
  return "tsx";
}

export interface LiveSessionOpts {
  prompt: { name: string; body: string; args: Record<string, string | undefined> };
  /** Optional system prompt injected via --system. Used to pass the MCP prompt body. */
  systemPrompt?: string;
  max_turns?: number;
  fixture_id?: string;
  transcript_dir: string;
  model?: string;
  /** Leadbay API token. Falls back to LEADBAY_TOKEN env var. */
  token?: string;
  /** Leadbay region ("us" or "fr"). Falls back to LEADBAY_REGION env var, then "us". */
  region?: string;
}

export interface LiveSessionResult {
  evidence: MCPEvidence;
  cost: { tokens_in: number; tokens_out: number; cost_usd_session: number };
  durationMs: number;
}

function hashForId(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

// Write a minimal eval settings file that clears all hooks and disables plugins.
// This prevents the superpowers system (and any other plugin) from injecting
// Skill/ToolSearch/LSP directives that distract the agent from Leadbay tools.
function writeEvalSettings(tmpDir: string): string {
  const settingsPath = join(tmpDir, "eval-settings.json");
  const settings = {
    // Empty hooks object clears all user-global hooks for this session.
    hooks: {},
    // Disable all plugins so superpowers/context7/etc. don't inject tools.
    enabledPlugins: {},
  };
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
  return settingsPath;
}

// Write a temp MCP config pointing at our live server.
function writeMcpConfig(
  tmpDir: string,
  token: string,
  region: string,
): string {
  const configPath = join(tmpDir, "mcp-config.json");
  const tsxBin = findTsx();
  const config = {
    mcpServers: {
      "leadbay-live": {
        command: tsxBin,
        args: [LIVE_SERVER_SRC],
        env: {
          LEADBAY_TOKEN: token,
          LEADBAY_REGION: region,
        },
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
  return configPath;
}

// Stream-json event types we care about.
interface StreamAssistantEvent {
  type: "assistant";
  message: {
    content: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: unknown }
    >;
    stop_reason: string | null;
    usage?: { input_tokens: number; output_tokens: number };
  };
}

interface StreamResultEvent {
  type: "result";
  subtype: string;
  is_error: boolean;
  result: string;
  stop_reason?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

type StreamEvent =
  | StreamAssistantEvent
  | StreamResultEvent
  | { type: string; [key: string]: unknown };

function parseStreamLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as StreamEvent;
  } catch {
    return null;
  }
}

export async function runSessionLive(opts: LiveSessionOpts): Promise<LiveSessionResult> {
  const startedAt = Date.now();
  const session_id = randomUUID();
  const max_turns = opts.max_turns ?? 25;

  const token = opts.token ?? process.env.LEADBAY_TOKEN ?? "";
  const region = opts.region ?? process.env.LEADBAY_REGION ?? "us";

  if (!token) {
    throw new Error("live-session-runner: LEADBAY_TOKEN env var or opts.token is required");
  }

  mkdirSync(opts.transcript_dir, { recursive: true });
  const transcriptPath = join(opts.transcript_dir, `${session_id}.transcript.jsonl`);
  const transcriptLines: string[] = [];
  const appendTranscript = (entry: Record<string, unknown>) => {
    transcriptLines.push(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
  };

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

  appendTranscript({ kind: "session-start", session_id, prompt_name: opts.prompt.name, args: opts.prompt.args });

  const tmpDir = mkdtempSync("/tmp/leadbay-live-eval-");
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let terminal_reason: TerminalReason = "agent_stopped";

  try {
    const mcpConfigPath = writeMcpConfig(tmpDir, token, region);
    const evalSettingsPath = writeEvalSettings(tmpDir);

    const modelFlag = opts.model ?? process.env.EVAL_MODEL;

    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--mcp-config", mcpConfigPath,
      "--dangerously-skip-permissions",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--settings", evalSettingsPath,
      // Only allow tools from our live MCP server — blocks Bash, Glob,
      // Read, Edit, Skill, ToolSearch, LSP etc. from superpowers/Claude Code.
      "--allowedTools", "mcp__leadbay-live__*",
    ];
    if (opts.systemPrompt) args.push("--system-prompt", opts.systemPrompt);
    if (modelFlag) args.push("--model", modelFlag);

    const proc = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Feed the initial user message.
    const userMsg = JSON.stringify({
      type: "user",
      message: { role: "user", content: opts.prompt.body },
    });
    proc.stdin.write(userMsg + "\n");

    let turn = 0;
    let lastFinishTs = startedAt;
    let finalText = "";
    let lastAssistantText = "";
    let done = false;

    const stderrChunks: Buffer[] = [];
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    await new Promise<void>((resolveP, rejectP) => {
      let lineBuffer = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        lineBuffer += chunk.toString("utf8");
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";

        for (const line of lines) {
          const event = parseStreamLine(line);
          if (!event) continue;

          if (event.type === "assistant") {
            const ev = event as StreamAssistantEvent;
            turn += 1;
            const latency_ms = Date.now() - lastFinishTs;
            lastFinishTs = Date.now();

            const textBlocks = ev.message.content.filter(
              (b): b is { type: "text"; text: string } => b.type === "text",
            );
            const assistantText = textBlocks.map((b) => b.text).join("\n");

            const toolUseBlocks = ev.message.content.filter(
              (b): b is { type: "tool_use"; id: string; name: string; input: unknown } =>
                b.type === "tool_use",
            );

            const tRec: TurnRecord = {
              turn,
              role: "assistant",
              text_len: assistantText.length,
              tokens_in: ev.message.usage?.input_tokens ?? 0,
              tokens_out: ev.message.usage?.output_tokens ?? 0,
              latency_ms,
            };
            evidence.turns.push(tRec);

            if (assistantText.length > 0) {
              evidence.prose_between_tool_calls.push({ after_turn: turn, text: assistantText });
              lastAssistantText = assistantText;
            }

            // Record tool calls. Strip the MCP server prefix (mcp__<server-name>__)
            // so tool names match the bare names used by invariants.
            for (const block of toolUseBlocks) {
              const bareName = block.name.replace(/^mcp__[^_]+__/, "");
              const rec: ToolCallRecord = {
                turn,
                name: bareName,
                input: block.input,
                output_summary: { ok: true, output_len: 0 },
                duration_ms: 0,
              };
              evidence.tool_calls.push(rec);
              appendTranscript({
                kind: "tool-call",
                turn,
                name: bareName,
                input_hash: hashForId(JSON.stringify(block.input ?? {})),
              });
            }

            appendTranscript({
              kind: "assistant-turn",
              turn,
              stop_reason: ev.message.stop_reason,
              blocks: ev.message.content.map((b) => b.type),
              text_len: assistantText.length,
            });

            if (
              ev.message.stop_reason === "end_turn" ||
              ev.message.stop_reason === "stop_sequence"
            ) {
              finalText = assistantText;
              terminal_reason = "agent_stopped";
            }

            if (turn >= max_turns) {
              terminal_reason = "max_turns";
              proc.stdin.end();
            }
          }

          if (event.type === "result") {
            const ev = event as StreamResultEvent;
            if (ev.is_error) {
              terminal_reason = "sdk_error";
            } else {
              terminal_reason = "agent_stopped";
              finalText = (ev.result && ev.result.length > 0) ? ev.result : lastAssistantText;
              if (ev.usage) {
                totalTokensIn = ev.usage.input_tokens;
                totalTokensOut = ev.usage.output_tokens;
              }
            }
            done = true;
            proc.stdin.end();
          }
        }
      });

      proc.stdout.on("end", () => {
        if (!done) terminal_reason = "agent_stopped";
        resolveP();
      });

      proc.on("error", (err) => rejectP(err));

      proc.on("close", (code) => {
        if (!done && code !== 0) {
          const stderr = Buffer.concat(stderrChunks).toString("utf8").slice(0, 500);
          rejectP(new Error(`claude exited with code ${code}: ${stderr}`));
        } else {
          resolveP();
        }
      });
    });

    evidence.final_agent_message = finalText;
    evidence.session.terminal_reason = terminal_reason;

    appendTranscript({ kind: "session-end", terminal_reason, turns: turn, tokens_in: totalTokensIn, tokens_out: totalTokensOut });
    writeFileSync(transcriptPath, transcriptLines.join("\n") + "\n", "utf8");
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  return {
    evidence,
    cost: { tokens_in: 0, tokens_out: 0, cost_usd_session: 0 },
    durationMs: Date.now() - startedAt,
  };
}
