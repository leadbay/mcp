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
  model: string;
  evidence: {
    session: { prompt_name: string; fixture_id?: string; terminal_reason: string };
    invariants: Array<{ name: string; pass: boolean; reason?: string }>;
    judge_scores?: { mission_match: number; instruction_adherence: number; no_fabrication: number; tool_selection_fit: number };
    judge_reasoning?: string;
    per_criterion?: Array<{ criterion: string; pass: boolean; reasoning: string }>;
    failure_modes_present?: string[];
    tool_calls: Array<{ turn: number; name: string; input: unknown }>;
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

function renderEntryCard(entry: EvalEntry): string {
  const { passed, name, duration_ms, turns_used, model, evidence, tool_call_count, tool_call_breakdown } = entry;
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

  const meta = [
    `<span class="meta-item">⏱ ${fmtDuration(duration_ms)}</span>`,
    `<span class="meta-item">turns: ${turns_used}</span>`,
    `<span class="meta-item">tools: ${tool_call_count}</span>`,
    `<span class="meta-item">model: ${escHtml(model)}</span>`,
    evidence.session.fixture_id ? `<span class="meta-item">fixture: ${escHtml(evidence.session.fixture_id)}</span>` : "",
    `<span class="meta-item">exit: ${escHtml(entry.exit_reason)}</span>`,
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

  const detailsHtml = runs.map((r) => renderRunSection(r, runs.length > 1)).join("\n");

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
}

main();
