/**
 * Shared utilities for any LLM-as-judge call inside the eval suite.
 *
 * The judge always runs via the `claude` CLI — the same binary Claude Code
 * uses. No ANTHROPIC_API_KEY required; Claude Code's auth (subscription or
 * API key) is transparently reused by the child process.
 *
 * Three things this module enforces:
 * - Untrusted-text wrapping: agent prose / tool outputs are wrapped in
 *   <<<UNTRUSTED_*>>> sentinels so the judge treats them as data, not commands.
 * - Defensive output parsing: numeric scores clamped to [1,5];
 *   non-numeric coerced to 1; failure_modes_present filtered to the
 *   exact vocabulary supplied by the frontmatter rubric.
 * - Retry policy: one retry with exponential backoff on transient errors
 *   (JSON parse, timeout) per eng-review T2 decision.
 */
import { execSync } from "node:child_process";
import { JUDGE_RETRY_DELAYS_MS } from "./budget-thresholds.js";

export type JudgeError =
  | "rate_limited"
  | "malformed_json"
  | "timeout"
  | "content_filter"
  | "network"
  | "unknown";

export interface JudgeResult<T> {
  ok: true;
  value: T;
  raw: string;
  tokens_in: number;
  tokens_out: number;
}

export interface JudgeFailure {
  ok: false;
  error: JudgeError;
  message: string;
}

export type JudgeOutcome<T> = JudgeResult<T> | JudgeFailure;

export function wrapUntrusted(label: string, content: string): string {
  return `<<<UNTRUSTED_${label}>>>\n${content}\n<<<END_UNTRUSTED_${label}>>>`;
}

export function clampScore(raw: unknown, min = 1, max = 5): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function constrainEnumArray(
  raw: unknown,
  vocabulary: readonly string[],
): string[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(vocabulary);
  return raw.filter((v): v is string => typeof v === "string" && allowed.has(v));
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function classifyError(err: unknown): JudgeError {
  const msg = String((err as Error)?.message ?? err);
  if (/rate.?limit|429/i.test(msg)) return "rate_limited";
  if (/timeout|timed out/i.test(msg)) return "timeout";
  if (/content.?filter|safety/i.test(msg)) return "content_filter";
  if (/network|ECONN|ENOTFOUND/i.test(msg)) return "network";
  if (/JSON|parse/i.test(msg)) return "malformed_json";
  return "unknown";
}

// ---------------------------------------------------------------------------
// CLI execution
// ---------------------------------------------------------------------------

/** Returns true if the `claude` CLI binary is available in PATH. */
export function hasCLI(): boolean {
  try {
    execSync("claude --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Shell out to `claude -p "<prompt>"` and return stdout.
 * Used for all judge calls — Claude Code's auth is reused transparently.
 */
export function callClaudeCLI(prompt: string, model?: string): string {
  const modelFlag = model ? `--model ${JSON.stringify(model)}` : "";
  return execSync(`claude -p ${JSON.stringify(prompt)} ${modelFlag}`.trim(), {
    encoding: "utf8",
    timeout: 90_000,
  });
}

// ---------------------------------------------------------------------------
// Judge call with retry
// ---------------------------------------------------------------------------

export interface JudgeCallOpts<T> {
  prompt: string;
  model?: string;
  parser: (raw: string) => T;
}

/**
 * Run a judge call via the claude CLI with retry policy per eng-review T2.
 * One retry with exponential backoff (delays in JUDGE_RETRY_DELAYS_MS).
 * Returns ok=false on second failure.
 */
export async function callJudge<T>(opts: JudgeCallOpts<T>): Promise<JudgeOutcome<T>> {
  let lastError: { error: JudgeError; message: string } | null = null;
  const attempts = JUDGE_RETRY_DELAYS_MS.length + 1;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await delay(JUDGE_RETRY_DELAYS_MS[attempt - 1]);
    }
    try {
      const raw = callClaudeCLI(opts.prompt, opts.model);
      const value = opts.parser(raw);
      return { ok: true, value, raw, tokens_in: 0, tokens_out: 0 };
    } catch (err) {
      lastError = { error: classifyError(err), message: String((err as Error)?.message ?? err) };
      if (lastError.error === "content_filter") break;
    }
  }

  return { ok: false, error: lastError!.error, message: lastError!.message };
}
