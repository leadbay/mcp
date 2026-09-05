/**
 * LIVE smoke + E2E suite for @leadbay/mcp — spawns the built stdio server as a
 * subprocess (the same path Claude Desktop uses) and exercises every read-only
 * compound tool against the real Leadbay API.
 *
 * Auth (in priority order):
 *   1. LEADBAY_TEST_TOKEN — a real bearer token. Easiest.
 *   2. LEADBAY_TEST_EMAIL + macOS Keychain. Set once with:
 *        security add-generic-password -s leadbay-mcp-test -a you@example.com -w 'pwd'
 *      The test reads via `security find-generic-password ... -w`.
 *   3. Refuses to run when LEADBAY_TEST_PASSWORD is set (plaintext on disk is forbidden).
 *
 * Judge: LEADBAY_E2E_JUDGE = "anthropic" (default — claude-opus-4-7 + extended
 * thinking) | "heuristic" (no LLM) | "off" (no judge at all). When "anthropic",
 * ANTHROPIC_API_KEY is required, otherwise the suite skips with reason.
 *
 * Per composite: deterministic shape checks first, then (if data passes those
 * gates) an LLM judge with extended thinking decides if the output is
 * substantive + actionable for an agent. PII is redacted before the LLM call.
 *
 * Aggregate report written to .context/mcp-e2e-report-<timestamp>.json.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolveRegion } from "@leadbay/core";
import Anthropic from "@anthropic-ai/sdk";

// ─── Auth resolution ────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const BIN = path.resolve(__dirname, "..", "..", "dist", "bin.js");

const REGION = (process.env.LEADBAY_TEST_REGION ?? "us") as "us" | "fr";
const BASE_URL = process.env.LEADBAY_TEST_BASE_URL;

if (process.env.LEADBAY_TEST_PASSWORD) {
  throw new Error(
    "[smoke] LEADBAY_TEST_PASSWORD is set in env — refused. Use macOS Keychain instead:\n" +
      "  security add-generic-password -s leadbay-mcp-test -a $LEADBAY_TEST_EMAIL -w 'YourPassword'\n" +
      "Then unset LEADBAY_TEST_PASSWORD."
  );
}

function passwordFromKeychain(account: string): string | null {
  const out = spawnSync("security", [
    "find-generic-password",
    "-s",
    "leadbay-mcp-test",
    "-a",
    account,
    "-w",
  ]);
  if (out.status !== 0) return null;
  const pwd = out.stdout.toString().trim();
  return pwd || null;
}

let SKIP_REASON: string | null = null;
let TOKEN: string | null = process.env.LEADBAY_TEST_TOKEN ?? null;
let RESOLVED_EMAIL: string | null = null;
let RESOLVED_REGION: "us" | "fr" = REGION;

const hasBuild = existsSync(BIN);
if (!hasBuild) {
  SKIP_REASON = `missing built bin at ${BIN} — run \`pnpm --filter @leadbay/mcp build\` first`;
}

if (!SKIP_REASON && !TOKEN) {
  const email = process.env.LEADBAY_TEST_EMAIL;
  if (!email) {
    SKIP_REASON =
      "no LEADBAY_TEST_TOKEN and no LEADBAY_TEST_EMAIL — set one to run live smoke";
  } else {
    const password = passwordFromKeychain(email);
    if (!password) {
      SKIP_REASON =
        `LEADBAY_TEST_EMAIL=${email} set but Keychain entry missing — run:\n` +
        `  security add-generic-password -s leadbay-mcp-test -a ${email} -w 'YourPassword'`;
    } else {
      // Keychain login happens lazily in beforeAll so the skip path stays sync.
      RESOLVED_EMAIL = email;
    }
  }
}

if (SKIP_REASON) {
  console.log(`[smoke] SMOKE_SKIPPED: ${SKIP_REASON}`);
}

// ─── Judge config ───────────────────────────────────────────────────────────

type JudgeMode = "anthropic" | "heuristic" | "off";
const JUDGE_MODE: JudgeMode = ((): JudgeMode => {
  const raw = (process.env.LEADBAY_E2E_JUDGE ?? "anthropic").toLowerCase();
  if (raw === "anthropic" || raw === "heuristic" || raw === "off") return raw;
  return "anthropic";
})();
const JUDGE_MODEL = process.env.LEADBAY_E2E_JUDGE_MODEL ?? "claude-opus-4-7";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? null;

if (JUDGE_MODE === "anthropic" && !ANTHROPIC_KEY) {
  console.log(
    "[smoke] LEADBAY_E2E_JUDGE=anthropic but ANTHROPIC_API_KEY missing — judge will downgrade to 'heuristic' for this run."
  );
}

const effectiveJudgeMode: JudgeMode =
  JUDGE_MODE === "anthropic" && !ANTHROPIC_KEY ? "heuristic" : JUDGE_MODE;

// ─── PII redaction ──────────────────────────────────────────────────────────

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// Require a leading + or () so we don't redact ISO timestamps / numeric IDs.
const PHONE_RE = /(\+\d[\d \-().]{6,}\d|\(\d{2,4}\)[\d \-]{6,}\d)/g;

function redactPII(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(EMAIL_RE, "[REDACTED_EMAIL]").replace(PHONE_RE, "[REDACTED_PHONE]");
  }
  if (Array.isArray(value)) return value.map(redactPII);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Drop common address-shaped keys entirely; redact everything else recursively.
      if (/^(address|street|postal_code|zip|phone|email|mobile)$/i.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactPII(v);
      }
    }
    return out;
  }
  return value;
}

// ─── Heuristic gates ────────────────────────────────────────────────────────

const PLACEHOLDER_RE = /\b(example\.com|TBD|TODO|placeholder|lorem ipsum)\b/i;

function deepFindPlaceholder(value: unknown): string | null {
  if (typeof value === "string") {
    return PLACEHOLDER_RE.test(value) ? value.slice(0, 80) : null;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = deepFindPlaceholder(v);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      const hit = deepFindPlaceholder(v);
      if (hit) return hit;
    }
  }
  return null;
}

interface HeuristicResult {
  ok: boolean;
  reason?: string;
}

function checkRequiredKeys(obj: Record<string, unknown>, keys: string[]): HeuristicResult {
  const missing = keys.filter((k) => !(k in obj));
  if (missing.length) return { ok: false, reason: `missing required keys: ${missing.join(", ")}` };
  const placeholder = deepFindPlaceholder(obj);
  if (placeholder) return { ok: false, reason: `placeholder detected: ${placeholder}` };
  return { ok: true };
}

// ─── LLM judge ──────────────────────────────────────────────────────────────

interface Verdict {
  verdict: "good" | "weak" | "broken";
  cited_fields: string[];
  reason: string;
}

async function judgeWithAnthropic(
  toolName: string,
  args: unknown,
  output: unknown
): Promise<Verdict> {
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY! });
  const redacted = redactPII(output);
  const prompt = `You are evaluating an MCP tool that an AI agent will consume to do real B2B outreach.

Tool: ${toolName}
Input args: ${JSON.stringify(args, null, 2)}
Output (PII redacted): ${JSON.stringify(redacted, null, 2)}

Judge:
1. Is the data substantive — real entities with non-trivial fields, not empty/placeholder?
2. Is it actionable for an outreach agent — could the agent take a next step from this?
3. Any obvious quality issues — broken refs, contradictions, hallucinated fields?

Use your thinking budget to inspect specific fields. Return STRICT JSON (no prose, no code fences):
{"verdict": "good" | "weak" | "broken", "cited_fields": [string], "reason": string}

\`cited_fields\` MUST list the JSON paths you actually inspected (e.g. "leads[0].firmographics.name"). An empty list means you did not inspect anything — return "broken" in that case.`;

  const response = await anthropic.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 8000,
    thinking: { type: "enabled", budget_tokens: 4000 },
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";
  const json = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  let parsed: Verdict;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return {
      verdict: "broken",
      cited_fields: [],
      reason: `judge returned non-JSON: ${raw.slice(0, 200)}`,
    };
  }
  // Sycophancy guard: a "good" verdict with empty cited_fields is rewritten to "broken".
  if (parsed.verdict === "good" && (!parsed.cited_fields || parsed.cited_fields.length === 0)) {
    return {
      verdict: "broken",
      cited_fields: [],
      reason: `judge said "good" but cited no fields (sycophancy guard): ${parsed.reason}`,
    };
  }
  return parsed;
}

async function judge(toolName: string, args: unknown, output: unknown): Promise<Verdict> {
  if (effectiveJudgeMode === "off") {
    return { verdict: "good", cited_fields: ["(judge disabled)"], reason: "LEADBAY_E2E_JUDGE=off" };
  }
  if (effectiveJudgeMode === "heuristic") {
    return {
      verdict: "good",
      cited_fields: ["(heuristic-only)"],
      reason: "LEADBAY_E2E_JUDGE=heuristic — no LLM call",
    };
  }
  return judgeWithAnthropic(toolName, args, output);
}

// ─── Aggregate report ───────────────────────────────────────────────────────

interface ReportEntry {
  tool: string;
  args: unknown;
  heuristic: HeuristicResult;
  verdict: Verdict | null;
  excerpt: unknown;
  duration_ms: number;
}

const REPORT: ReportEntry[] = [];

function writeReport() {
  if (REPORT.length === 0) return;
  const dir = path.join(REPO_ROOT, ".context");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `mcp-e2e-report-${Date.now()}.json`);
  const summary = {
    total: REPORT.length,
    good: REPORT.filter((r) => r.verdict?.verdict === "good").length,
    weak: REPORT.filter((r) => r.verdict?.verdict === "weak").length,
    broken: REPORT.filter((r) => r.verdict?.verdict === "broken").length,
    judge_mode: effectiveJudgeMode,
    judge_model: effectiveJudgeMode === "anthropic" ? JUDGE_MODEL : null,
  };
  writeFileSync(file, JSON.stringify({ summary, entries: REPORT }, null, 2));
  console.log(`[smoke] report written: ${file}`);
  console.log(`[smoke] summary: ${JSON.stringify(summary)}`);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    const text = (result.content as any[])?.[0]?.text ?? "(no text)";
    throw new Error(`tool ${name} returned isError: ${text}`);
  }
  const content = result.content as any[];
  const text = content[0].text;
  return JSON.parse(text);
}

async function exerciseAndJudge(
  client: Client,
  toolName: string,
  args: Record<string, unknown>,
  requiredKeys: string[]
): Promise<{ result: any; verdict: Verdict | null }> {
  const t0 = Date.now();
  const result = await callTool(client, toolName, args);
  const heuristic = checkRequiredKeys(result, requiredKeys);

  let verdict: Verdict | null = null;
  if (!heuristic.ok) {
    verdict = { verdict: "broken", cited_fields: [], reason: heuristic.reason ?? "heuristic failure" };
  } else {
    verdict = await judge(toolName, args, result);
  }

  REPORT.push({
    tool: toolName,
    args,
    heuristic,
    verdict,
    excerpt: redactPII(result),
    duration_ms: Date.now() - t0,
  });
  return { result, verdict };
}

// ─── Suite ──────────────────────────────────────────────────────────────────

const runLive = !SKIP_REASON;

describe.skipIf(!runLive)("@leadbay/mcp — live composite suite (#3504)", () => {
  let client: Client;
  let pulledLeadIds: string[] = [];

  beforeAll(async () => {
    if (!TOKEN && RESOLVED_EMAIL) {
      const password = passwordFromKeychain(RESOLVED_EMAIL)!;
      const resolved = await resolveRegion(RESOLVED_EMAIL, password, REGION);
      TOKEN = resolved.token;
      RESOLVED_REGION = resolved.region;
      if (!resolved.verified) {
        throw new Error(
          `[smoke] login succeeded but account ${RESOLVED_EMAIL} is not verified (verified=false). Verify the account before running E2E.`
        );
      }
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      LEADBAY_TOKEN: TOKEN!,
      LEADBAY_REGION: RESOLVED_REGION,
    };
    if (BASE_URL) env.LEADBAY_BASE_URL = BASE_URL;

    const transport = new StdioClientTransport({
      command: "node",
      args: [BIN],
      env: env as Record<string, string>,
    });
    client = new Client({ name: "smoke", version: "0.0.1" }, {});
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    if (client) await client.close();
    writeReport();
  });

  it("leadbay_account_status — returns user + organization", async () => {
    const { result, verdict } = await exerciseAndJudge(
      client,
      "leadbay_account_status",
      {},
      ["user", "organization"]
    );
    expect(result.user).toBeDefined();
    expect(result.organization?.id).toBeTruthy();
    expect(verdict?.verdict, `judge: ${verdict?.reason}`).not.toBe("broken");
  }, 60_000);

  it("leadbay_pull_leads — returns leads array", async () => {
    const { result, verdict } = await exerciseAndJudge(
      client,
      "leadbay_pull_leads",
      { count: 3 },
      ["leads"]
    );
    expect(Array.isArray(result.leads)).toBe(true);
    pulledLeadIds = result.leads
      .map((l: any) => l?.id)
      .filter((id: unknown): id is string => typeof id === "string");
    expect(verdict?.verdict, `judge: ${verdict?.reason}`).not.toBe("broken");

    if (pulledLeadIds.length === 0) {
      console.log("[smoke] no leads returned — skipping research_lead and recall_ordered_titles");
    }
  }, 90_000);

  it("leadbay_research_lead_by_id — returns qualification + signals + firmographics", async () => {
    if (pulledLeadIds.length === 0) {
      console.log("[smoke] skipped: no lead id available");
      return;
    }
    const { result, verdict } = await exerciseAndJudge(
      client,
      "leadbay_research_lead_by_id",
      { leadId: pulledLeadIds[0] },
      ["qualification", "signals", "firmographics"]
    );
    expect(result.firmographics?.id).toBeTruthy();
    expect(verdict?.verdict, `judge: ${verdict?.reason}`).not.toBe("broken");
  }, 120_000);

  it("leadbay_recall_ordered_titles — returns titles array", async () => {
    if (pulledLeadIds.length === 0) {
      console.log("[smoke] skipped: no lead ids available");
      return;
    }
    const { result, verdict } = await exerciseAndJudge(
      client,
      "leadbay_recall_ordered_titles",
      { leadIds: pulledLeadIds },
      ["source"]
    );
    // Either preview_field with available_in_selection, or live_aggregate with titles.
    expect(["preview_field", "live_aggregate"]).toContain(result.source);
    expect(verdict?.verdict, `judge: ${verdict?.reason}`).not.toBe("broken");
  }, 90_000);

  it("leadbay_bulk_enrich_status — schema check or skip", async () => {
    // The handle is the backend's own notification_id (product#4005), as
    // returned by leadbay_enrich_titles.
    const notificationId = process.env.LEADBAY_TEST_NOTIFICATION_ID;
    if (!notificationId) {
      console.log("[smoke] skipped: set LEADBAY_TEST_NOTIFICATION_ID to exercise bulk_enrich_status");
      return;
    }
    const { result, verdict } = await exerciseAndJudge(
      client,
      "leadbay_bulk_enrich_status",
      { notification_id: notificationId },
      ["notification_id", "status"]
    );
    expect(result.notification_id).toBe(notificationId);
    expect(verdict?.verdict, `judge: ${verdict?.reason}`).not.toBe("broken");
  }, 90_000);

  // Keep the original sanity check that proved out before the suite existed.
  it("doctor subcommand exits 0 with account info", async () => {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("node", [BIN, "doctor"], {
        env: {
          ...process.env,
          LEADBAY_TOKEN: TOKEN!,
          LEADBAY_REGION: RESOLVED_REGION,
        },
      });
      let stdout = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.on("exit", (code) => {
        try {
          expect(code).toBe(0);
          expect(stdout).toMatch(/Leadbay connection OK/);
          expect(stdout).toMatch(/Organization:/);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }, 30_000);
});
