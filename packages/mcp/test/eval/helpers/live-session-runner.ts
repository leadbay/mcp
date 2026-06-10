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
 *   6. Return MCPEvidence with full session data.
 *
 * Real HTTP goes to api-us.leadbay.app / api-fr.leadbay.app.
 * MCP server name is "leadbay-live" → --allowedTools mcp__leadbay-live__*.
 * LEADBAY_TOKEN + LEADBAY_REGION env vars passed to the spawned server.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync, openSync, writeSync, closeSync } from "node:fs";
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
  /**
   * Ordered user messages for a multi-turn scenario. When set (length ≥ 1) the
   * runner drives one `claude -p` invocation per message, sharing a single
   * session id across turns (`--session-id` on turn 1, `--resume` after) so the
   * agent carries prior context forward. When unset, `prompt.body` is the single
   * turn. Tool calls are tagged with the 1-based user-turn index.
   */
  turns?: string[];
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
  cost: { tokens_in: number; tokens_out: number; tokens_cache_read: number; cost_usd_session: number };
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
    // Explicitly empty every hook type to prevent superpowers/claude-hook.js
    // from injecting PreToolUse skill-check directives into the eval session.
    hooks: {
      PreToolUse: [],
      PostToolUse: [],
      UserPromptSubmit: [],
      SessionStart: [],
      Stop: [],
    },
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

// ---------------------------------------------------------------------------
// Full human-readable log renderer
// ---------------------------------------------------------------------------

interface FullLogEvent {
  event: "session_start" | "system_prompt" | "assistant_turn" | "tool_result" | "rate_limit" | "session_result";
  turn?: number;
  stop_reason?: string;
  tokens?: { in: number; out: number; cache_hit?: number };
  text?: string;
  tool_calls?: Array<{ name: string; input: unknown }>;
  tool_result?: { tool_use_id: string; name: string; content: unknown };
  cost_usd?: number;
  final_message?: string;
  is_error?: boolean;
  [key: string]: unknown;
}

function renderFullLog(rawJsonlPath: string, outPath: string, opts: {
  promptName: string;
  userMessage: string;
  systemPrompt?: string | null;
}): void {
  // Let read errors propagate — caller wraps in try/catch and logs them.
  const raw = readFileSync(rawJsonlPath, "utf8");

  const lines = raw.split("\n").filter((l) => l.trim());

  // Build a map of tool_use_id → tool name so results can be annotated.
  const toolNames = new Map<string, string>();

  const events: FullLogEvent[] = [];
  let turnNum = 0;

  // Header event
  events.push({
    event: "session_start",
    prompt_name: opts.promptName,
    user_message: opts.userMessage,
    ...(opts.systemPrompt ? { system_prompt_preview: opts.systemPrompt.slice(0, 500) + (opts.systemPrompt.length > 500 ? "…" : "") } : {}),
  });

  for (const line of lines) {
    let ev: Record<string, unknown>;
    try { ev = JSON.parse(line) as Record<string, unknown>; } catch { continue; }

    if (ev["kind"] === "session-init") continue;
    const type = ev["type"] as string | undefined;

    if (type === "system") {
      const msg = ev["message"] as { content?: unknown } | undefined;
      const content = msg?.content ?? "";
      const text = typeof content === "string" ? content
        : Array.isArray(content)
          ? (content as Array<Record<string, unknown>>).filter((b) => b["type"] === "text").map((b) => b["text"] as string).join("\n")
          : JSON.stringify(content);
      events.push({ event: "system_prompt", text });
      continue;
    }

    if (type === "assistant") {
      turnNum++;
      const msg = ev["message"] as { content: unknown[]; stop_reason?: string; usage?: { input_tokens: number; output_tokens: number } } | undefined;
      if (!msg) continue;

      const textBlocks: string[] = [];
      const toolCalls: Array<{ name: string; input: unknown }> = [];

      for (const block of (msg.content as Array<Record<string, unknown>>)) {
        if (block["type"] === "text") {
          const t = (block["text"] as string ?? "").trim();
          if (t) textBlocks.push(t);
        } else if (block["type"] === "tool_use") {
          const rawName = block["name"] as string ?? "";
          const name = rawName.replace(/^mcp__[^_]+__/, "");
          const id = block["id"] as string ?? "";
          if (id) toolNames.set(id, name);
          toolCalls.push({ name, input: block["input"] });
        }
      }

      const entry: FullLogEvent = {
        event: "assistant_turn",
        turn: turnNum,
        stop_reason: msg.stop_reason ?? undefined,
      };
      if (msg.usage) entry.tokens = { in: msg.usage.input_tokens, out: msg.usage.output_tokens };
      if (textBlocks.length) entry.text = textBlocks.join("\n");
      if (toolCalls.length) entry.tool_calls = toolCalls;
      events.push(entry);
      continue;
    }

    if (type === "user") {
      const msg = ev["message"] as { content: unknown[] } | undefined;
      if (!msg) continue;
      for (const block of (msg.content as Array<Record<string, unknown>>)) {
        if (block["type"] === "tool_result") {
          const id = block["tool_use_id"] as string ?? "?";
          const name = toolNames.get(id) ?? "unknown";
          const content = block["content"];
          // Parse tool result content: may be string, [{type:"text",text:...}], or raw object
          let parsed: unknown = content;
          if (typeof content === "string") {
            try { parsed = JSON.parse(content); } catch { parsed = content; }
          } else if (Array.isArray(content)) {
            const textParts = (content as Array<Record<string, unknown>>)
              .filter((b) => b["type"] === "text")
              .map((b) => b["text"] as string)
              .join("\n");
            try { parsed = JSON.parse(textParts); } catch { parsed = textParts; }
          }
          events.push({
            event: "tool_result",
            turn: turnNum,
            tool_result: { tool_use_id: id, name, content: parsed },
          });
        }
      }
      continue;
    }

    if (type === "rate_limit_event") {
      events.push({ event: "rate_limit", ...ev });
      continue;
    }

    if (type === "result") {
      const res = ev as { is_error?: boolean; result?: string; stop_reason?: string; total_cost_usd?: number; usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number } };
      const entry: FullLogEvent = {
        event: "session_result",
        is_error: res.is_error ?? false,
        stop_reason: res.stop_reason,
      };
      if (res.total_cost_usd !== undefined) entry.cost_usd = res.total_cost_usd;
      if (res.usage) entry.tokens = { in: res.usage.input_tokens, out: res.usage.output_tokens, cache_hit: res.usage.cache_read_input_tokens };
      if (res.result) entry.final_message = res.result;
      events.push(entry);
    }
  }

  const doc = {
    generated_at: new Date().toISOString(),
    prompt_name: opts.promptName,
    user_message: opts.userMessage,
    turns: turnNum,
    events,
  };

  writeFileSync(outPath, JSON.stringify(doc, null, 2), "utf8");
}

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
  const rawLogPath = join(opts.transcript_dir, `${session_id}.raw.jsonl`);
  const fullLogPath = join(opts.transcript_dir, `${session_id}.full.json`);
  const stderrLogPath = join(opts.transcript_dir, `${session_id}.stderr.txt`);

  const transcriptLines: string[] = [];
  const appendTranscript = (entry: Record<string, unknown>) => {
    transcriptLines.push(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
  };

  // appendRaw writes to rawLogFd (opened below after fd variables are declared).
  const appendRaw = (line: string) => {
    if (rawLogFd >= 0) writeSync(rawLogFd, line + "\n");
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

  // Real-time verbose output
  const verbose = process.env.EVAL_VERBOSE !== "0";
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
  const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
  const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
  const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
  const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
  const gray = (s: string) => `\x1b[90m${s}\x1b[0m`;

  if (verbose) {
    process.stderr.write(`\n${bold("▶ SESSION")} ${dim(session_id.slice(0, 8))}\n`);
    process.stderr.write(`${bold("  prompt:")} ${opts.prompt.name}\n`);
    process.stderr.write(`${bold("  user:")}   ${cyan(opts.prompt.body)}\n`);
    if (opts.systemPrompt) {
      const preview = opts.systemPrompt.slice(0, 120).replace(/\n/g, " ");
      process.stderr.write(`${bold("  system:")} ${dim(preview + (opts.systemPrompt.length > 120 ? "…" : ""))}\n`);
    }
    process.stderr.write(`${bold("  full log:")} ${fullLogPath}\n`);
    process.stderr.write(`${bold("  raw log:")} ${rawLogPath}\n`);
    process.stderr.write(`${bold("  stderr:")}  ${stderrLogPath}\n`);
    process.stderr.write("\n");
  }

  const tmpDir = mkdtempSync("/tmp/leadbay-live-eval-");
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalTokensCacheRead = 0;
  let terminal_reason: TerminalReason = "agent_stopped";

  // File descriptors hoisted so finally can close them regardless of where an error occurs.
  let rawLogFd = -1;
  let stderrFd = -1;

  try {
    rawLogFd = openSync(rawLogPath, "w");
    stderrFd = openSync(stderrLogPath, "w");
    const mcpConfigPath = writeMcpConfig(tmpDir, token, region);
    const evalSettingsPath = writeEvalSettings(tmpDir);

    const modelFlag = opts.model ?? process.env.EVAL_MODEL;

    // Multi-turn driving: `claude -p` exits after each result, so a multi-turn
    // conversation is N sequential invocations sharing one session id — turn 1
    // sets `--session-id`, later turns `--resume` it (context carries forward).
    // A single-turn scenario is just the one-element case. opts.turns, when set,
    // is the ordered list of user messages; otherwise fall back to opts.prompt.body.
    const userMessages =
      opts.turns && opts.turns.length > 0 ? opts.turns : [opts.prompt.body];

    const baseArgs = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--mcp-config", mcpConfigPath,
      "--dangerously-skip-permissions",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--settings", evalSettingsPath,
      // Only allow tools from our live MCP server.
      "--allowedTools", "mcp__leadbay-live__*",
      // Explicitly block built-in Claude Code tools that leak through.
      "--disallowedTools", "ToolSearch,WebFetch,WebSearch,Bash,Read,Edit,Write,Glob,Grep,LS,Skill,LSP,Agent",
    ];
    if (opts.systemPrompt) baseArgs.push("--system-prompt", opts.systemPrompt);
    if (modelFlag) baseArgs.push("--model", modelFlag);

    let turn = 0;
    let lastFinishTs = startedAt;
    let finalText = "";
    let lastAssistantText = "";

    // userTurn is the 1-based index of the user message currently being
    // processed. Tool calls and prose are tagged with it so per-turn invariants
    // (expect_calls/forbid_calls) and carry-over judging can attribute evidence
    // to the right turn — independent of how many assistant messages a turn took.
    for (let userTurnIdx = 0; userTurnIdx < userMessages.length; userTurnIdx++) {
      const userTurn = userTurnIdx + 1;
      const userMessage = userMessages[userTurnIdx];

      // First turn establishes the session id; subsequent turns resume it.
      const args = [...baseArgs];
      if (userTurnIdx === 0) args.push("--session-id", session_id);
      else args.push("--resume", session_id);

      const proc = spawn("claude", args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Feed this turn's user message.
      const userMsg = JSON.stringify({
        type: "user",
        message: { role: "user", content: userMessage },
      });
      proc.stdin.write(userMsg + "\n");

      appendRaw(JSON.stringify({ ts: new Date().toISOString(), kind: "session-init", user_turn: userTurn, prompt_name: opts.prompt.name, user_message: userMessage, system_prompt: opts.systemPrompt ?? null }));

      if (verbose && userMessages.length > 1) {
        process.stderr.write(`\n${bold(`▶ TURN ${userTurn}/${userMessages.length}`)} ${cyan(userMessage)}\n`);
      }

      let done = false;

      // Stream stderr directly to file so we capture MCP server startup logs,
      // tool result payloads, and any claude internal debug output.
      const stderrChunks: Buffer[] = [];
      proc.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
        writeSync(stderrFd, chunk);
      });

      await new Promise<void>((resolveP, rejectP) => {
      let lineBuffer = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        lineBuffer += chunk.toString("utf8");
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";

        for (const line of lines) {
          // Write every raw line to the full log before any filtering.
          if (line.trim()) appendRaw(line);

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

            if (verbose) {
              process.stderr.write(`${gray(`─── turn ${turn} (${latency_ms}ms) ───────────────────────────────────────`)}\n`);

              // Tool calls
              for (const block of toolUseBlocks) {
                const bareName = block.name.replace(/^mcp__[^_]+__/, "");
                const isLeadbay = bareName.startsWith("leadbay_");
                const label = isLeadbay ? yellow(`⚡ ${bareName}`) : gray(`  ${bareName} (filtered)`);
                process.stderr.write(`${label}\n`);
                if (isLeadbay && block.input && typeof block.input === "object") {
                  const inputStr = JSON.stringify(block.input, null, 2)
                    .split("\n")
                    .map((l) => gray(`    ${l}`))
                    .join("\n");
                  process.stderr.write(inputStr + "\n");
                }
              }

              // Agent prose
              if (assistantText.trim()) {
                const lines = assistantText.split("\n");
                const preview = lines.slice(0, 8).join("\n");
                const truncated = lines.length > 8;
                process.stderr.write(cyan("  ┌ agent\n"));
                for (const l of preview.split("\n")) {
                  process.stderr.write(cyan(`  │ `) + l + "\n");
                }
                if (truncated) process.stderr.write(cyan(`  │ `) + dim(`… (${lines.length - 8} more lines)`) + "\n");
                process.stderr.write(cyan("  └\n"));
              }

              const tokIn = ev.message.usage?.input_tokens ?? 0;
              const tokOut = ev.message.usage?.output_tokens ?? 0;
              if (tokIn || tokOut) {
                process.stderr.write(gray(`    tokens: ${tokIn} in / ${tokOut} out\n`));
              }
            }

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
            // `turn` is tagged with the USER-turn index (not the assistant-message
            // counter) so per-turn invariants attribute calls to the right turn.
            for (const block of toolUseBlocks) {
              const bareName = block.name.replace(/^mcp__[^_]+__/, "");
              const rec: ToolCallRecord = {
                turn: userTurn,
                name: bareName,
                input: block.input,
                output_summary: { ok: true, output_len: 0 },
                duration_ms: 0,
              };
              evidence.tool_calls.push(rec);
              appendTranscript({
                kind: "tool-call",
                turn: userTurn,
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
              // Accumulate across turns — each turn is a separate process that
              // reports its own result usage.
              if (ev.usage) {
                totalTokensIn += ev.usage.input_tokens;
                totalTokensOut += ev.usage.output_tokens;
                totalTokensCacheRead += (ev.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
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
    } // end per-turn loop

    if (verbose) {
      const dur = ((Date.now() - startedAt) / 1000).toFixed(1);
      process.stderr.write(`\n${green("✓ done")} — ${turn} assistant turns, ${userMessages.length} user turn(s), ${dur}s\n\n`);
    }

    evidence.final_agent_message = finalText;
    evidence.session.terminal_reason = terminal_reason;

    appendTranscript({ kind: "session-end", terminal_reason, turns: turn, tokens_in: totalTokensIn, tokens_out: totalTokensOut });
    writeFileSync(transcriptPath, transcriptLines.join("\n") + "\n", "utf8");

    // Close raw log fd before rendering so all bytes are flushed.
    try { if (rawLogFd >= 0) { closeSync(rawLogFd); rawLogFd = -1; } } catch { /* ignore */ }
    evidence.full_log_path = fullLogPath;
    try {
      renderFullLog(rawLogPath, fullLogPath, {
        promptName: opts.prompt.name,
        userMessage: opts.prompt.body,
        systemPrompt: opts.systemPrompt,
      });
    } catch (err) {
      process.stderr.write(`\n[live-session-runner] renderFullLog failed: ${err}\n`);
    }

    if (verbose) {
      process.stderr.write(`${bold("  full log:")} ${fullLogPath}\n\n`);
    }
  } finally {
    try { if (rawLogFd >= 0) closeSync(rawLogFd); } catch { /* ignore */ }
    try { if (stderrFd >= 0) closeSync(stderrFd); } catch { /* ignore */ }
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  return {
    evidence,
    cost: { tokens_in: totalTokensIn, tokens_out: totalTokensOut, tokens_cache_read: totalTokensCacheRead, cost_usd_session: 0 },
    durationMs: Date.now() - startedAt,
  };
}
