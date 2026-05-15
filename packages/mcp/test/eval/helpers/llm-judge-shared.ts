/**
 * Shared utilities for any LLM-as-judge call inside the eval suite.
 *
 * Three things this module enforces:
 * - Untrusted-text wrapping: any data sourced from a previous model
 *   (sent body, intercepted backend payload, agent prose) is wrapped in
 *   <<<UNTRUSTED_*>>> sentinels with explicit instructions to the judge
 *   to treat the content as data, not commands. Defeats injection.
 * - Defensive output parsing: numeric scores clamped to [1,5];
 *   non-numeric coerced to 1; failure_modes_present filtered to the
 *   exact vocabulary supplied by the frontmatter rubric.
 * - Retry/timeout policy: one retry with exponential backoff on
 *   transient errors (429, JSON parse, timeout) per the eng-review T2
 *   decision. On second failure: judge_scores undefined, L3 incomplete.
 */
import Anthropic from "@anthropic-ai/sdk";
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

export interface JudgeCallOpts<T> {
  client: Anthropic;
  model: string;
  prompt: string;
  parser: (raw: string) => T;     // throws on malformed; classifier handles retry
  max_tokens?: number;
}

/**
 * Run a judge call with retry policy per eng-review T2.
 * One retry with exponential backoff (delays in JUDGE_RETRY_DELAYS_MS).
 * Returns ok=false on second failure; caller writes
 * judge_scores: undefined and L3 stays incomplete.
 */
export async function callJudge<T>(opts: JudgeCallOpts<T>): Promise<JudgeOutcome<T>> {
  let lastError: { error: JudgeError; message: string } | null = null;
  const attempts = JUDGE_RETRY_DELAYS_MS.length + 1; // initial + retries
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await delay(JUDGE_RETRY_DELAYS_MS[attempt - 1]);
    }
    try {
      const response = await opts.client.messages.create({
        model: opts.model,
        max_tokens: opts.max_tokens ?? 1024,
        messages: [{ role: "user", content: opts.prompt }],
      });
      const block = response.content.find((c) => c.type === "text");
      const raw = block && "text" in block ? block.text : "";
      const value = opts.parser(raw);
      return {
        ok: true,
        value,
        raw,
        tokens_in: response.usage.input_tokens,
        tokens_out: response.usage.output_tokens,
      };
    } catch (err) {
      lastError = { error: classifyError(err), message: String((err as Error)?.message ?? err) };
      if (lastError.error === "content_filter") break; // never retry content-filter
    }
  }
  return { ok: false, error: lastError!.error, message: lastError!.message };
}
