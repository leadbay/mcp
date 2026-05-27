#!/usr/bin/env tsx
/**
 * report.ts — Generate a self-contained HTML report from eval run JSON files.
 *
 * Usage:
 *   tsx report.ts                        # latest run
 *   tsx report.ts --all                  # all runs
 *   tsx report.ts --run <run_id>         # specific run
 *   tsx report.ts --output <path>        # override output path
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Types (from evidence.ts)
// ---------------------------------------------------------------------------

interface EvalRunFile {
  schema_version: 1;
  run_id: string;
  branch: string;
  git_sha: string;
  started_at: string;
  ended_at?: string;
  entries: EvalEntry[];
}

interface EvalEntry {
  name: string;
  suite: string;
  tier: string;
  passed: boolean;
  exit_reason: string;
  duration_ms: number;
  turns_used: number;
  tool_call_count: number;
  tool_call_breakdown: Record<string, number>;
  tokens_session_in?: number;
  tokens_session_cache?: number;
  tokens_session_out?: number;
  tokens_judge_in?: number;
  tokens_judge_out?: number;
  model: string;
  evidence: {
    session: { prompt_name: string; fixture_id?: string; terminal_reason: string };
    invariants: Array<{ name: string; pass: boolean; reason?: string }>;
    judge_scores?: { mission_match: number; instruction_adherence: number; no_fabrication: number; tool_selection_fit: number };
    judge_reasoning?: string;
    per_criterion?: Array<{ criterion: string; pass: boolean; reasoning: string }>;
    failure_modes_present?: string[];
    tool_calls: Array<{ turn: number; name: string; input: unknown }>;
    full_log_path?: string;
    transcript_path?: string;
  };
}

interface RunGroup {
  run_id: string;
  branch: string;
  git_sha: string;
  started_at: string;
  ended_at?: string;
  entries: EvalEntry[];
}

// ---------------------------------------------------------------------------
// Paths & CLI args
// ---------------------------------------------------------------------------

// __dirname = .../eval-framework/packages/mcp/test/eval/scripts
// 5x ".." reaches eval-framework root
const EVALS_ROOT = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  ".context",
  "evals"
);

function parseArgs(): { mode: "latest" | "all" | "run"; runId?: string; outputPath?: string } {
  const args = process.argv.slice(2);
  let mode: "latest" | "all" | "run" = "latest";
  let runId: string | undefined;
  let outputPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--all") {
      mode = "all";
    } else if (args[i] === "--run" && args[i + 1]) {
      mode = "run";
      runId = args[++i];
    } else if (args[i] === "--output" && args[i + 1]) {
      outputPath = args[++i];
    }
  }

  return { mode, runId, outputPath };
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

function loadRunFiles(): RunGroup[] {
  const files = fs
    .readdirSync(EVALS_ROOT)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(EVALS_ROOT, f));

  const byRunId = new Map<string, RunGroup>();

  for (const filePath of files) {
    let raw: EvalRunFile;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as EvalRunFile;
    } catch {
      continue;
    }

    if (!raw.run_id || !Array.isArray(raw.entries)) continue;

    const existing = byRunId.get(raw.run_id);
    if (existing) {
      // Merge entries (deduplicate by name)
      const existingNames = new Set(existing.entries.map((e) => e.name));
      for (const entry of raw.entries) {
        if (!existingNames.has(entry.name)) {
          existing.entries.push(entry);
          existingNames.add(entry.name);
        }
      }
      // Keep the latest ended_at
      if (raw.ended_at && (!existing.ended_at || raw.ended_at > existing.ended_at)) {
        existing.ended_at = raw.ended_at;
      }
    } else {
      byRunId.set(raw.run_id, {
        run_id: raw.run_id,
        branch: raw.branch,
        git_sha: raw.git_sha,
        started_at: raw.started_at,
        ended_at: raw.ended_at,
        entries: [...raw.entries],
      });
    }
  }

  // Sort newest first
  return Array.from(byRunId.values()).sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  );
}

// ---------------------------------------------------------------------------
// HTML generation helpers
// ---------------------------------------------------------------------------

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return iso;
  }
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(0);
  return `${m}m ${s}s`;
}

const SCORE_COLORS: Record<number, string> = {
  5: "#22c55e",
  4: "#84cc16",
  3: "#eab308",
  2: "#f97316",
  1: "#ef4444",
};

function scoreColor(score: number): string {
  return SCORE_COLORS[Math.round(score)] ?? "#6b7280";
}

function renderScoreBar(label: string, score: number | undefined): string {
  if (score === undefined || score === null) {
    return `<div class="score-row"><span class="score-label">${escHtml(label)}</span><span class="score-na">—</span></div>`;
  }
  const color = scoreColor(score);
  const squares = Array.from({ length: 5 }, (_, i) => {
    const filled = i < score;
    return `<span style="color:${filled ? color : "#374151"}">■</span>`;
  }).join("");
  return `<div class="score-row"><span class="score-label">${escHtml(label)}</span><span class="score-bar">${squares}</span><span class="score-num" style="color:${color}">${score}/5</span></div>`;
}

function passRate(entries: EvalEntry[]): { pass: number; fail: number; rate: string } {
  const pass = entries.filter((e) => e.passed).length;
  const fail = entries.length - pass;
  const rate = entries.length > 0 ? ((pass / entries.length) * 100).toFixed(1) + "%" : "—";
  return { pass, fail, rate };
}

function slugify(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}

// ---------------------------------------------------------------------------
// Entry card HTML
// ---------------------------------------------------------------------------

// Load full log JSON from disk at report-generation time (returns null if missing).
function loadFullLog(fullLogPath: string | undefined): unknown | null {
  if (!fullLogPath) return null;
  try {
    return JSON.parse(fs.readFileSync(fullLogPath, "utf8"));
  } catch {
    return null;
  }
}

// Global registry: slot index → full log data, embedded as JSON in the HTML.
const fullLogRegistry: unknown[] = [];

function renderEntryCard(entry: EvalEntry): string {
  const { passed, name, duration_ms, turns_used, model, evidence, tool_call_count, tool_call_breakdown,
    tokens_session_in, tokens_session_cache, tokens_session_out, tokens_judge_in, tokens_judge_out } = entry;
  const { invariants, judge_scores, judge_reasoning, per_criterion, failure_modes_present, tool_calls } = evidence;

  const passColor = passed ? "#22c55e" : "#ef4444";
  const passLabel = passed ? "PASS" : "FAIL";

  const invHtml = invariants && invariants.length > 0
    ? `<div class="section-label">Invariants</div><ul class="inv-list">${invariants
        .map(
          (inv) =>
            `<li class="${inv.pass ? "inv-pass" : "inv-fail"}">${inv.pass ? "✓" : "✗"} <code>${escHtml(inv.name)}</code>${inv.reason ? ` — <span class="inv-reason">${escHtml(inv.reason)}</span>` : ""}</li>`
        )
        .join("")}</ul>`
    : "";

  const criteriaHtml =
    per_criterion && per_criterion.length > 0
      ? `<div class="section-label">Per-criterion</div><ul class="crit-list">${per_criterion
          .map(
            (c) =>
              `<li class="${c.pass ? "crit-pass" : "crit-fail"}">${c.pass ? "✓" : "✗"} <span class="crit-text">${escHtml(c.criterion)}</span>${c.reasoning ? `<div class="crit-reason">${escHtml(c.reasoning)}</div>` : ""}</li>`
          )
          .join("")}</ul>`
      : "";

  const toolCallsHtml =
    tool_calls && tool_calls.length > 0
      ? `<div class="section-label">Tool calls</div><ol class="tool-list">${tool_calls
          .map((tc) => `<li>turn ${tc.turn}: <code>${escHtml(tc.name)}</code></li>`)
          .join("")}</ol>`
      : "";

  const breakdownHtml =
    tool_call_breakdown && Object.keys(tool_call_breakdown).length > 0
      ? `<div class="section-label">Tool call breakdown</div><div class="breakdown">${Object.entries(tool_call_breakdown)
          .map(([k, v]) => `<span class="breakdown-item"><code>${escHtml(k)}</code>: ${v}</span>`)
          .join("")}</div>`
      : "";

  const judgeHtml = judge_reasoning
    ? `<details class="judge-details"><summary>Judge reasoning</summary><p class="judge-text">${escHtml(judge_reasoning)}</p></details>`
    : "";

  const failureModesHtml =
    failure_modes_present && failure_modes_present.length > 0
      ? `<div class="section-label">Failure modes</div><ul class="failure-list">${failure_modes_present
          .map((f) => `<li class="failure-item">${escHtml(f)}</li>`)
          .join("")}</ul>`
      : "";

  const scoresHtml = `
    <div class="scores-block">
      ${renderScoreBar("mission_match", judge_scores?.mission_match)}
      ${renderScoreBar("instruction_adherence", judge_scores?.instruction_adherence)}
      ${renderScoreBar("no_fabrication", judge_scores?.no_fabrication)}
      ${renderScoreBar("tool_selection_fit", judge_scores?.tool_selection_fit)}
    </div>`;

  // Embed full log inline — load from disk now, store in registry, button opens modal.
  const fullLogData = loadFullLog(evidence.full_log_path);
  let fullLogBtn = "";
  if (fullLogData !== null) {
    const idx = fullLogRegistry.length;
    fullLogRegistry.push(fullLogData);
    const pathTitle = escHtml(evidence.full_log_path ?? "");
    const rawPath = escHtml(evidence.full_log_path ?? "");
    fullLogBtn = `<span class="meta-item"><button class="log-btn" onclick="openLog(${idx})">📄 full log</button> <button class="log-btn copy-btn" onclick="copyPath(this,'${rawPath}')" title="${pathTitle}">copy path</button></span>`;
  }

  const meta = [
    `<span class="meta-item">⏱ ${fmtDuration(duration_ms)}</span>`,
    `<span class="meta-item">turns: ${turns_used}</span>`,
    `<span class="meta-item">tools: ${tool_call_count}</span>`,
    ...(tokens_session_out !== undefined ? [
      `<span class="meta-item" title="session: ${(tokens_session_in??0).toLocaleString()} in / ${(tokens_session_cache??0).toLocaleString()} cache / ${(tokens_session_out??0).toLocaleString()} out | judge: ${(tokens_judge_in??0).toLocaleString()} in / ${(tokens_judge_out??0).toLocaleString()} out">🪙 ${((tokens_session_in??0)+(tokens_session_cache??0)+(tokens_session_out??0)+(tokens_judge_in??0)+(tokens_judge_out??0)).toLocaleString()} tok total</span>`,
    ] : []),
    `<span class="meta-item">model: ${escHtml(model)}</span>`,
    evidence.session.fixture_id ? `<span class="meta-item">fixture: ${escHtml(evidence.session.fixture_id)}</span>` : "",
    `<span class="meta-item">exit: ${escHtml(entry.exit_reason)}</span>`,
    fullLogBtn,
  ]
    .filter(Boolean)
    .join("");

  return `
<div class="entry-card ${passed ? "entry-pass" : "entry-fail"}">
  <div class="entry-header">
    <span class="entry-name" style="color:${passColor}">${escHtml(name)}</span>
    <span class="entry-badge" style="background:${passColor}">${passLabel}</span>
  </div>
  <div class="entry-meta">${meta}</div>
  ${scoresHtml}
  ${invHtml}
  ${criteriaHtml}
  ${toolCallsHtml}
  ${breakdownHtml}
  ${failureModesHtml}
  ${judgeHtml}
</div>`;
}

// ---------------------------------------------------------------------------
// Full HTML document
// ---------------------------------------------------------------------------

function renderRunSection(run: RunGroup, includeRunHeader: boolean): string {
  const { pass, fail, rate } = passRate(run.entries);
  const shortSha = run.git_sha.slice(0, 8);
  const runSlug = slugify(run.run_id);

  const runHeaderHtml = includeRunHeader
    ? `<div class="run-header" id="run-${runSlug}">
        <span class="run-id">${escHtml(run.run_id)}</span>
        <span class="run-branch">${escHtml(run.branch)}</span>
        <span class="run-sha"><code>${shortSha}</code></span>
        <span class="run-date">${fmtDate(run.started_at)}</span>
        <span class="run-stats">
          <span class="stat-pass">${pass} passed</span> /
          <span class="stat-fail">${fail} failed</span>
          — <span class="stat-rate">${rate}</span>
        </span>
      </div>`
    : "";

  const cards = run.entries.map(renderEntryCard).join("\n");
  return `${runHeaderHtml}<div class="entries-grid">${cards}</div>`;
}

function buildHtml(runs: RunGroup[], showSummaryTable: boolean, title: string): string {
  const summaryTableHtml = showSummaryTable
    ? `<section class="summary-section">
        <h2>All Runs</h2>
        <table class="summary-table">
          <thead><tr><th>Run ID</th><th>Branch</th><th>Date</th><th>Pass</th><th>Fail</th><th>Rate</th></tr></thead>
          <tbody>
            ${runs
              .map((run) => {
                const { pass, fail, rate } = passRate(run.entries);
                const slug = slugify(run.run_id);
                const rateNum = parseFloat(rate);
                const rateColor = rateNum >= 80 ? "#22c55e" : rateNum >= 50 ? "#eab308" : "#ef4444";
                return `<tr class="summary-row" onclick="document.getElementById('run-${slug}').scrollIntoView({behavior:'smooth'})">
                  <td><code class="small">${escHtml(run.run_id)}</code></td>
                  <td>${escHtml(run.branch)}</td>
                  <td>${fmtDate(run.started_at)}</td>
                  <td class="stat-pass">${pass}</td>
                  <td class="stat-fail">${fail}</td>
                  <td style="color:${rateColor};font-weight:bold">${rate}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </section>`
    : "";

  const primaryRun = runs[0];
  const { pass, fail, rate } = passRate(
    runs.flatMap((r) => r.entries)
  );
  const rateNum = parseFloat(rate);
  const rateColor = rateNum >= 80 ? "#22c55e" : rateNum >= 50 ? "#eab308" : "#ef4444";

  // Reset registry then let renderEntryCard populate it as a side effect.
  fullLogRegistry.length = 0;
  const detailsHtml = runs.map((r) => renderRunSection(r, runs.length > 1)).join("\n");
  const registryJson = JSON.stringify(fullLogRegistry);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: #0d1117;
    color: #c9d1d9;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'Menlo', 'Monaco', 'Consolas', monospace;
    font-size: 13px;
    line-height: 1.6;
    padding: 24px;
  }

  a { color: #58a6ff; }

  h1 { font-size: 22px; color: #f0f6fc; margin-bottom: 6px; }
  h2 { font-size: 16px; color: #8b949e; margin-bottom: 12px; font-weight: normal; border-bottom: 1px solid #21262d; padding-bottom: 6px; }

  code { font-family: inherit; background: #161b22; padding: 1px 4px; border-radius: 3px; font-size: 12px; }
  code.small { font-size: 11px; }

  .page-header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 24px;
    margin-bottom: 32px;
    padding-bottom: 24px;
    border-bottom: 1px solid #21262d;
  }

  .header-main { flex: 1 1 300px; }
  .header-meta { color: #8b949e; font-size: 12px; margin-top: 6px; }
  .header-meta span { margin-right: 16px; }

  .big-rate {
    font-size: 56px;
    font-weight: bold;
    line-height: 1;
  }
  .big-stats { font-size: 13px; margin-top: 4px; color: #8b949e; }

  .stat-pass { color: #22c55e; }
  .stat-fail { color: #ef4444; }
  .stat-rate { font-weight: bold; }

  .summary-section { margin-bottom: 40px; }

  .summary-table {
    width: 100%;
    border-collapse: collapse;
    background: #161b22;
    border-radius: 6px;
    overflow: hidden;
  }
  .summary-table th {
    text-align: left;
    padding: 10px 14px;
    background: #21262d;
    color: #8b949e;
    font-weight: normal;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .summary-table td { padding: 8px 14px; border-top: 1px solid #21262d; }
  .summary-row { cursor: pointer; transition: background 0.15s; }
  .summary-row:hover { background: #1c2128; }

  .run-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin: 32px 0 16px;
    padding: 12px 16px;
    background: #161b22;
    border: 1px solid #21262d;
    border-radius: 6px;
    scroll-margin-top: 24px;
  }
  .run-id { color: #8b949e; font-size: 11px; }
  .run-branch { color: #58a6ff; font-weight: bold; }
  .run-sha { color: #8b949e; }
  .run-date { color: #8b949e; font-size: 11px; }
  .run-stats { margin-left: auto; }

  .entries-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(480px, 1fr));
    gap: 16px;
  }

  .entry-card {
    background: #161b22;
    border: 1px solid #21262d;
    border-radius: 6px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .entry-pass { border-left: 3px solid #22c55e; }
  .entry-fail { border-left: 3px solid #ef4444; }

  .entry-header {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .entry-name {
    font-weight: bold;
    font-size: 13px;
    flex: 1;
    word-break: break-all;
  }
  .entry-badge {
    font-size: 10px;
    font-weight: bold;
    padding: 2px 7px;
    border-radius: 3px;
    color: #000;
    letter-spacing: 0.05em;
    flex-shrink: 0;
  }

  .entry-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    color: #8b949e;
    font-size: 11px;
  }
  .meta-item { white-space: nowrap; }
  .log-btn {
    background: none; border: 1px solid #30363d; border-radius: 3px;
    color: #58a6ff; cursor: pointer; font: inherit; font-size: 11px;
    padding: 1px 6px; transition: background 0.15s;
  }
  .log-btn:hover { background: #1c2128; }

  /* Modal overlay */
  #log-modal {
    display: none; position: fixed; inset: 0;
    background: rgba(0,0,0,0.75); z-index: 1000;
    align-items: center; justify-content: center;
  }
  #log-modal.open { display: flex; }
  #log-modal-box {
    background: #161b22; border: 1px solid #30363d; border-radius: 8px;
    width: 90vw; max-width: 1100px; height: 85vh;
    display: flex; flex-direction: column; overflow: hidden;
  }
  #log-modal-header {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 16px; border-bottom: 1px solid #21262d; flex-shrink: 0;
  }
  #log-modal-title { color: #f0f6fc; font-size: 13px; flex: 1; }
  #log-modal-close {
    background: none; border: none; color: #8b949e; cursor: pointer;
    font-size: 18px; line-height: 1; padding: 0 4px;
  }
  #log-modal-close:hover { color: #f0f6fc; }
  #log-modal-body {
    flex: 1; overflow: auto; padding: 16px;
    font-size: 12px; line-height: 1.6;
  }

  /* JSON tree renderer */
  .jt { font-family: 'SF Mono','Fira Code','Cascadia Code',monospace; }
  .jt-obj, .jt-arr { list-style: none; margin: 0; padding: 0 0 0 18px; border-left: 1px solid #21262d; }
  .jt-row { display: flex; align-items: baseline; gap: 4px; min-height: 20px; }
  .jt-toggle { cursor: pointer; color: #8b949e; font-size: 10px; user-select: none; flex-shrink: 0; width: 14px; }
  .jt-toggle:hover { color: #f0f6fc; }
  .jt-key { color: #79c0ff; flex-shrink: 0; }
  .jt-str { color: #a5d6ff; white-space: pre-wrap; word-break: break-all; }
  .jt-num { color: #f8c555; }
  .jt-bool { color: #ff7b72; }
  .jt-null { color: #8b949e; }
  .jt-summary { color: #8b949e; font-size: 11px; cursor: pointer; }
  .jt-summary:hover { color: #c9d1d9; }
  .jt-collapsed > .jt-children { display: none; }

  /* Event type badges in log viewer */
  .ev-badge {
    display: inline-block; padding: 1px 6px; border-radius: 3px;
    font-size: 10px; font-weight: bold; letter-spacing: 0.04em; flex-shrink: 0;
  }
  .ev-session_start   { background: #1f6feb; color: #fff; }
  .ev-system_prompt   { background: #6e40c9; color: #fff; }
  .ev-assistant_turn  { background: #238636; color: #fff; }
  .ev-tool_result     { background: #b08800; color: #000; }
  .ev-session_result  { background: #21262d; color: #c9d1d9; }
  .ev-rate_limit      { background: #b62324; color: #fff; }

  .scores-block { display: flex; flex-direction: column; gap: 4px; }
  .score-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .score-label { color: #8b949e; width: 160px; flex-shrink: 0; }
  .score-bar { letter-spacing: 2px; font-size: 14px; }
  .score-num { font-size: 11px; }
  .score-na { color: #4b5563; }

  .section-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #6b7280;
    margin-bottom: 4px;
  }

  .inv-list, .crit-list, .tool-list, .failure-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .inv-pass { color: #22c55e; }
  .inv-fail { color: #ef4444; }
  .inv-reason { color: #8b949e; font-size: 11px; }

  .crit-pass { color: #22c55e; }
  .crit-fail { color: #ef4444; }
  .crit-text { color: #c9d1d9; }
  .crit-reason { color: #8b949e; font-size: 11px; margin-left: 16px; margin-top: 2px; }

  .tool-list { counter-reset: tool-counter; }
  .tool-list li { color: #8b949e; font-size: 12px; }

  .breakdown { display: flex; flex-wrap: wrap; gap: 8px; }
  .breakdown-item { color: #8b949e; font-size: 11px; }

  .failure-list { }
  .failure-item { color: #ef4444; font-size: 12px; }

  .judge-details {
    border: 1px solid #21262d;
    border-radius: 4px;
    overflow: hidden;
  }
  .judge-details summary {
    padding: 6px 10px;
    cursor: pointer;
    color: #8b949e;
    font-size: 11px;
    background: #0d1117;
    user-select: none;
  }
  .judge-details summary:hover { background: #161b22; }
  .judge-text {
    padding: 10px;
    color: #8b949e;
    font-size: 12px;
    background: #0d1117;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
  }

  @media (max-width: 600px) {
    .entries-grid { grid-template-columns: 1fr; }
    .big-rate { font-size: 36px; }
  }
</style>
</head>
<body>

<header class="page-header">
  <div class="header-main">
    <h1>${escHtml(title)}</h1>
    <div class="header-meta">
      ${primaryRun ? `<span>branch: <strong>${escHtml(primaryRun.branch)}</strong></span>` : ""}
      ${primaryRun ? `<span>sha: <code>${primaryRun.git_sha.slice(0, 8)}</code></span>` : ""}
      ${primaryRun ? `<span>${fmtDate(primaryRun.started_at)}</span>` : ""}
    </div>
  </div>
  <div>
    <div class="big-rate" style="color:${rateColor}">${rate}</div>
    <div class="big-stats">
      <span class="stat-pass">${pass} passed</span> &nbsp;/&nbsp;
      <span class="stat-fail">${fail} failed</span>
    </div>
  </div>
</header>

${summaryTableHtml}

<section class="details-section">
  ${runs.length > 1 ? "" : ""}
  ${detailsHtml}
</section>

<!-- Modal overlay -->
<div id="log-modal">
  <div id="log-modal-box">
    <div id="log-modal-header">
      <span id="log-modal-title">Full session log</span>
      <button id="log-modal-close" onclick="closeLog()">✕</button>
    </div>
    <div id="log-modal-body"></div>
  </div>
</div>

<script>
const _logs = ${registryJson};

function copyPath(btn, path) {
  navigator.clipboard.writeText(path).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓ copied';
    btn.style.color = '#22c55e';
    setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 1500);
  });
}

function openLog(idx) {
  const data = _logs[idx];
  if (!data) return;
  const modal = document.getElementById('log-modal');
  const body = document.getElementById('log-modal-body');
  const title = document.getElementById('log-modal-title');
  title.textContent = (data.prompt_name || '') + ' — ' + (data.user_message || '') + ' (' + (data.turns || 0) + ' turns)';
  body.innerHTML = '';
  if (Array.isArray(data.events)) {
    data.events.forEach(ev => body.appendChild(renderEvent(ev)));
  } else {
    body.appendChild(renderJsonTree(data, null, true));
  }
  modal.classList.add('open');
}

function closeLog() {
  document.getElementById('log-modal').classList.remove('open');
}

document.getElementById('log-modal').addEventListener('click', function(e) {
  if (e.target === this) closeLog();
});

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeLog();
});

// ── Event renderer ──────────────────────────────────────────────────────────

function renderEvent(ev) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-bottom:12px;padding:10px 12px;background:#0d1117;border-radius:6px;border:1px solid #21262d';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap';

  const badge = document.createElement('span');
  badge.className = 'ev-badge ev-' + (ev.event || 'unknown');
  badge.textContent = (ev.event || '?').replace(/_/g, ' ');
  header.appendChild(badge);

  if (ev.turn !== undefined) {
    const t = document.createElement('span');
    t.style.cssText = 'color:#8b949e;font-size:11px';
    t.textContent = 'turn ' + ev.turn;
    header.appendChild(t);
  }
  if (ev.stop_reason) {
    const s = document.createElement('span');
    s.style.cssText = 'color:#8b949e;font-size:11px';
    s.textContent = 'stop: ' + ev.stop_reason;
    header.appendChild(s);
  }
  if (ev.tokens) {
    const tk = document.createElement('span');
    tk.style.cssText = 'color:#8b949e;font-size:11px;margin-left:auto';
    tk.textContent = ev.tokens.in + ' in / ' + ev.tokens.out + ' out' + (ev.tokens.cache_hit ? ' / ' + ev.tokens.cache_hit + ' cache' : '');
    header.appendChild(tk);
  }
  if (ev.cost_usd !== undefined) {
    const c = document.createElement('span');
    c.style.cssText = 'color:#8b949e;font-size:11px';
    c.textContent = '$' + ev.cost_usd.toFixed(4);
    header.appendChild(c);
  }

  wrap.appendChild(header);

  // Render event-specific content
  if (ev.event === 'system_prompt' && ev.text) {
    const pre = document.createElement('pre');
    pre.style.cssText = 'color:#8b949e;font-size:11px;white-space:pre-wrap;word-break:break-word;max-height:200px;overflow:auto;margin:0';
    pre.textContent = ev.text;
    wrap.appendChild(pre);

  } else if (ev.event === 'assistant_turn') {
    if (ev.text) {
      const prose = document.createElement('div');
      prose.style.cssText = 'color:#c9d1d9;margin-bottom:8px;white-space:pre-wrap;border-left:2px solid #238636;padding-left:10px';
      prose.textContent = ev.text;
      wrap.appendChild(prose);
    }
    if (ev.tool_calls && ev.tool_calls.length) {
      ev.tool_calls.forEach(tc => {
        const tcWrap = document.createElement('div');
        tcWrap.style.cssText = 'margin-top:6px';
        const label = document.createElement('div');
        label.style.cssText = 'color:#f8c555;font-size:12px;margin-bottom:4px';
        label.textContent = '⚡ ' + tc.name;
        tcWrap.appendChild(label);
        if (tc.input && Object.keys(tc.input).length) {
          tcWrap.appendChild(renderJsonTree(tc.input, null, true));
        }
        wrap.appendChild(tcWrap);
      });
    }

  } else if (ev.event === 'tool_result' && ev.tool_result) {
    const label = document.createElement('div');
    label.style.cssText = 'color:#e3b341;font-size:12px;margin-bottom:4px';
    label.textContent = '↩ ' + ev.tool_result.name;
    wrap.appendChild(label);
    wrap.appendChild(renderJsonTree(ev.tool_result.content, null, false));

  } else if (ev.event === 'session_result') {
    if (ev.final_message) {
      const msg = document.createElement('div');
      msg.style.cssText = 'color:#c9d1d9;white-space:pre-wrap;border-left:2px solid #58a6ff;padding-left:10px';
      msg.textContent = ev.final_message;
      wrap.appendChild(msg);
    }

  } else if (ev.event === 'session_start') {
    const info = document.createElement('div');
    info.style.cssText = 'color:#8b949e;font-size:12px';
    info.textContent = ev.user_message || '';
    wrap.appendChild(info);
    if (ev.system_prompt_preview) {
      const sp = document.createElement('pre');
      sp.style.cssText = 'color:#6e40c9;font-size:10px;white-space:pre-wrap;margin-top:6px;max-height:80px;overflow:auto';
      sp.textContent = ev.system_prompt_preview;
      wrap.appendChild(sp);
    }
  }

  return wrap;
}

// ── JSON tree renderer ──────────────────────────────────────────────────────

function renderJsonTree(val, key, expanded) {
  const row = document.createElement('div');
  row.className = 'jt-row';

  const toggle = document.createElement('span');
  toggle.className = 'jt-toggle';

  const keySpan = document.createElement('span');
  keySpan.className = 'jt-key';
  if (key !== null) keySpan.textContent = JSON.stringify(key) + ': ';

  if (val === null) {
    row.appendChild(toggle);
    row.appendChild(keySpan);
    const v = document.createElement('span'); v.className = 'jt-null'; v.textContent = 'null';
    row.appendChild(v);
    return row;
  }

  if (typeof val !== 'object') {
    row.appendChild(toggle);
    row.appendChild(keySpan);
    const v = document.createElement('span');
    if (typeof val === 'string') { v.className = 'jt-str'; v.textContent = JSON.stringify(val); }
    else if (typeof val === 'number') { v.className = 'jt-num'; v.textContent = String(val); }
    else { v.className = 'jt-bool'; v.textContent = String(val); }
    row.appendChild(v);
    return row;
  }

  const isArr = Array.isArray(val);
  const entries = isArr ? val.map((v, i) => [i, v]) : Object.entries(val);
  const count = entries.length;

  const wrap = document.createElement('div');
  wrap.className = expanded ? 'jt' : 'jt jt-collapsed';

  const summary = document.createElement('div');
  summary.className = 'jt-row';

  const tog = document.createElement('span');
  tog.className = 'jt-toggle';
  tog.textContent = expanded ? '▾' : '▸';
  summary.appendChild(tog);

  if (key !== null) {
    const ks = document.createElement('span'); ks.className = 'jt-key';
    ks.textContent = JSON.stringify(key) + ': ';
    summary.appendChild(ks);
  }

  const sumText = document.createElement('span');
  sumText.className = 'jt-summary';
  sumText.textContent = (isArr ? '[' : '{') + (expanded ? '' : '…' + count + (isArr ? ']' : '}'));
  summary.appendChild(sumText);

  const children = document.createElement('ul');
  children.className = isArr ? 'jt-arr' : 'jt-obj';

  const close = document.createElement('div');
  close.className = 'jt-row';
  const closeSpan = document.createElement('span');
  closeSpan.className = 'jt-summary';
  closeSpan.textContent = isArr ? ']' : '}';
  close.appendChild(closeSpan);

  entries.forEach(([k, v]) => {
    const li = document.createElement('li');
    // Auto-expand small objects, collapse big ones
    const childExpanded = typeof v !== 'object' || v === null || Object.keys(v || {}).length <= 5;
    li.appendChild(renderJsonTree(v, isArr ? null : k, childExpanded));
    children.appendChild(li);
  });

  tog.addEventListener('click', () => {
    const collapsed = wrap.classList.toggle('jt-collapsed');
    tog.textContent = collapsed ? '▸' : '▾';
    sumText.textContent = (isArr ? '[' : '{') + (collapsed ? '…' + count + (isArr ? ']' : '}') : '');
  });
  sumText.addEventListener('click', () => tog.click());

  wrap.appendChild(summary);
  wrap.appendChild(children);
  wrap.appendChild(close);
  return wrap;
}
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const { mode, runId, outputPath } = parseArgs();

  const allRuns = loadRunFiles();

  if (allRuns.length === 0) {
    console.error(`No run files found in ${EVALS_ROOT}`);
    process.exit(1);
  }

  let selectedRuns: RunGroup[];
  let title: string;
  let showSummaryTable: boolean;

  if (mode === "run") {
    const found = allRuns.find((r) => r.run_id === runId);
    if (!found) {
      console.error(`Run not found: ${runId}`);
      console.error(`Available run IDs:\n${allRuns.map((r) => `  ${r.run_id}`).join("\n")}`);
      process.exit(1);
    }
    selectedRuns = [found];
    title = `Eval Report — ${found.run_id}`;
    showSummaryTable = false;
  } else if (mode === "all") {
    selectedRuns = allRuns;
    title = "Eval Report — All Runs";
    showSummaryTable = true;
  } else {
    selectedRuns = [allRuns[0]];
    title = `Eval Report — ${allRuns[0].branch} @ ${allRuns[0].git_sha.slice(0, 8)}`;
    showSummaryTable = false;
  }

  const html = buildHtml(selectedRuns, showSummaryTable, title);

  const outPath = outputPath ?? path.join(EVALS_ROOT, "eval-report.html");
  fs.writeFileSync(outPath, html, "utf8");
  console.log(outPath);
  console.log(`\nOpen: xdg-open ${outPath}`);
}

main();
