#!/usr/bin/env tsx
/**
 * MCP telemetry dashboard generator (GitHub issue #3688).
 *
 * Queries PostHog for the MCP-only event stream (everything tagged
 * `source = "mcp"` plus the `mcp *` / `agent_memory_*` events) and emits a
 * self-contained interactive HTML dashboard you open in a browser. Mirrors
 * the eval HTML dashboard pattern (test/eval/helpers/gen-dashboard.py): one
 * generator script, one standalone HTML output, no build step.
 *
 * Credentials come from the environment ONLY — never hard-coded, never
 * written into the output:
 *
 *   POSTHOG_PERSONAL_API_KEY   (required)  personal API key (phx_…)
 *   POSTHOG_PROJECT_ID         (optional)  default 23333
 *   POSTHOG_HOST               (optional)  default https://eu.posthog.com
 *
 * The project's frontend + MCP both report to project 23333 (EU). Source the
 * key from .env.posthog (git-ignored) before running:
 *
 *   set -a && source /path/to/.env.posthog && set +a
 *   pnpm --filter @leadbay/mcp mcp:dashboard
 *
 * Flags:
 *   --days <n>     lookback window (default 30)
 *   --out <path>   output HTML path (default ./mcp-dashboard.html)
 *   --json         also write the raw queried data next to the HTML
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Config from env (NEVER inline the key) ──────────────────────────────────
const API_KEY = process.env.POSTHOG_PERSONAL_API_KEY;
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID ?? "23333";
const HOST = (process.env.POSTHOG_HOST ?? "https://eu.posthog.com").replace(/\/$/, "");

if (!API_KEY) {
  console.error(
    "Missing POSTHOG_PERSONAL_API_KEY. Source it from your .env.posthog (git-ignored), e.g.:\n" +
      "  set -a && source .env.posthog && set +a\n" +
      "then re-run. The key is read from the environment only — it is never stored or printed."
  );
  process.exit(1);
}

// ── CLI args ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const argVal = (flag: string, fallback: string): string => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const DAYS = parseInt(argVal("--days", "30"), 10);
const OUT = resolve(process.cwd(), argVal("--out", "mcp-dashboard.html"));
const WRITE_JSON = argv.includes("--json");

// ── HogQL query helper ──────────────────────────────────────────────────────
type Row = unknown[];
async function hogql(query: string): Promise<Row[]> {
  const res = await fetch(`${HOST}/api/projects/${PROJECT_ID}/query/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`PostHog query failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { results?: Row[]; error?: string };
  if (json.error) throw new Error(`HogQL error: ${json.error}`);
  return json.results ?? [];
}

// Common WHERE clause: MCP surface only, within the lookback window.
const WINDOW = `timestamp >= now() - interval ${DAYS} day`;
const MCP_ONLY = `event LIKE 'mcp %' OR event LIKE 'agent_memory_%'`;

// ── Panel definitions ───────────────────────────────────────────────────────
// Each panel runs a query and is rendered by `kind`. Adding a metric = one
// entry here. Keeps the dashboard consistent and easy to extend.
interface Panel {
  id: string;
  title: string;
  subtitle?: string;
  kind: "stackedBar" | "line" | "table" | "friction" | "donut" | "funnel" | "hbar";
  columns?: string[];
  wide?: boolean; // span full grid width (for tables with many columns)
  query: string;
  data?: Row[];
}

const panels: Panel[] = [
  {
    id: "tool-volume",
    title: "Tool calls by tool — success vs failure",
    subtitle: `Last ${DAYS} days · 'mcp tool called'`,
    kind: "stackedBar",
    query: `
      SELECT properties.tool AS tool,
             countIf(properties.ok = true) AS ok,
             countIf(properties.ok = false) AS failed
      FROM events
      WHERE event = 'mcp tool called' AND ${WINDOW}
      GROUP BY tool ORDER BY ok + failed DESC LIMIT 40`,
  },
  {
    id: "calls-per-tool",
    title: "Calls per tool",
    subtitle: `Total volume · last ${DAYS} days`,
    kind: "hbar",
    query: `
      SELECT properties.tool AS tool, count() AS calls
      FROM events
      WHERE event = 'mcp tool called' AND ${WINDOW}
      GROUP BY tool ORDER BY calls DESC LIMIT 30`,
  },
  {
    id: "version-dist",
    title: "MCP version distribution",
    subtitle: "unique users per version",
    kind: "donut",
    query: `
      SELECT version, count() AS users FROM (
        SELECT distinct_id, any(properties.mcp_version) AS version
        FROM events WHERE (${MCP_ONLY}) AND ${WINDOW}
        GROUP BY distinct_id
      ) GROUP BY version ORDER BY users DESC`,
  },
  {
    id: "region-dist",
    title: "Users by region",
    subtitle: "unique users per region",
    kind: "donut",
    query: `
      SELECT region, count() AS users FROM (
        SELECT distinct_id, any(properties.region) AS region
        FROM events WHERE (${MCP_ONLY}) AND ${WINDOW}
        GROUP BY distinct_id
      ) GROUP BY region ORDER BY users DESC`,
  },
  {
    id: "platform-dist",
    title: "Users by OS / platform",
    subtitle: "unique users per platform",
    kind: "donut",
    query: `
      SELECT platform, count() AS users FROM (
        SELECT distinct_id, any(properties.platform) AS platform
        FROM events WHERE (${MCP_ONLY}) AND ${WINDOW}
        GROUP BY distinct_id
      ) GROUP BY platform ORDER BY users DESC`,
  },
  {
    id: "friction-by-category",
    title: "Friction by category",
    subtitle: "report count per category",
    kind: "donut",
    query: `
      SELECT properties.category AS category, count() AS n
      FROM events
      WHERE event = 'mcp friction reported' AND ${WINDOW}
      GROUP BY category ORDER BY n DESC`,
  },
  {
    id: "tool-latency",
    title: "Latency & reliability per tool",
    subtitle: "calls · success rate · avg / min / max ms",
    kind: "table",
    wide: true,
    columns: ["Tool", "Calls", "OK", "Failed", "Success %", "Avg ms", "Min ms", "Max ms"],
    query: `
      SELECT properties.tool AS tool,
             count() AS calls,
             countIf(properties.ok = true) AS ok,
             countIf(properties.ok = false) AS failed,
             round(100 * countIf(properties.ok = true) / count(), 1) AS success_pct,
             round(avg(properties.duration_ms)) AS avg_ms,
             round(min(properties.duration_ms)) AS min_ms,
             round(max(properties.duration_ms)) AS max_ms
      FROM events
      WHERE event = 'mcp tool called' AND ${WINDOW}
      GROUP BY tool ORDER BY calls DESC LIMIT 40`,
  },
  {
    id: "daily-volume",
    title: "Daily call volume & unique users",
    subtitle: "calls per day, distinct users per day",
    kind: "line",
    query: `
      SELECT toDate(timestamp) AS day,
             count() AS calls,
             count(DISTINCT distinct_id) AS users
      FROM events
      WHERE event = 'mcp tool called' AND ${WINDOW}
      GROUP BY day ORDER BY day ASC`,
  },
  {
    id: "errors",
    title: "Error-code breakdown",
    subtitle: "failed tool calls by tool + error code",
    kind: "table",
    columns: ["Tool", "Error code", "Failures"],
    query: `
      SELECT properties.tool AS tool,
             properties.error_code AS error_code,
             count() AS failures
      FROM events
      WHERE event = 'mcp tool called' AND properties.ok = false AND ${WINDOW}
      GROUP BY tool, error_code ORDER BY failures DESC LIMIT 50`,
  },
  {
    id: "friction",
    title: "Friction feed",
    subtitle: "user-reported frustration (verbatim)",
    kind: "friction",
    query: `
      SELECT toDateTime(timestamp) AS ts,
             distinct_id AS user,
             properties.category AS category,
             properties.severity AS severity,
             properties.tool_called AS tool,
             properties.user_quote AS quote,
             properties.details AS details
      FROM events
      WHERE event = 'mcp friction reported' AND ${WINDOW}
      ORDER BY ts DESC LIMIT 50`,
  },
  {
    id: "auth-state",
    title: "Startup auth state",
    subtitle: "'mcp startup' auth_state distribution",
    kind: "donut",
    query: `
      SELECT properties.auth_state AS auth_state, count() AS n
      FROM events
      WHERE event = 'mcp startup' AND ${WINDOW}
      GROUP BY auth_state ORDER BY n DESC`,
  },
  {
    id: "update-funnel",
    title: "Auto-update funnel",
    subtitle: "check → prompted → dismissed → version updated",
    kind: "funnel",
    query: `
      SELECT event, count() AS n
      FROM events
      WHERE event IN ('mcp update check','mcp update prompted','mcp update install_clicked','mcp update dismissed','mcp version updated')
        AND ${WINDOW}
      GROUP BY event`,
  },
  {
    id: "roster",
    title: "User roster",
    subtitle: "region · platform · version · MCP events",
    kind: "table",
    wide: true,
    columns: ["User", "Region", "Platform", "MCP version", "Events"],
    query: `
      SELECT distinct_id AS user,
             any(properties.region) AS region,
             any(properties.platform) AS platform,
             any(properties.mcp_version) AS version,
             count() AS events
      FROM events
      WHERE (${MCP_ONLY}) AND ${WINDOW}
      GROUP BY user ORDER BY events DESC LIMIT 60`,
  },
  {
    id: "memory",
    title: "Agent memory activity",
    subtitle: "capture / recall / prune",
    kind: "table",
    columns: ["Event", "Count", "Users"],
    query: `
      SELECT event, count() AS n, count(DISTINCT distinct_id) AS users
      FROM events
      WHERE event LIKE 'agent_memory_%' AND ${WINDOW}
      GROUP BY event ORDER BY n DESC`,
  },
];

// ── Per-user drill-down ───────────────────────────────────────────────────────
// For each roster user, fetch advanced metrics + their prompts (triggered_by),
// embedded as JSON so a row click opens a detail modal — no extra requests.
interface UserDetail {
  user: string;
  summary: { calls: number; ok: number; failed: number; tools: number; firstSeen: string; lastSeen: string };
  byTool: Row[]; // [tool, calls, ok, failed, avg_ms]
  errors: Row[]; // [tool, error_code, n]
  prompts: Row[]; // [ts, tool, ok, error_code, prompt]
}

// One combined per-user query keeps us well under PostHog's 3-concurrent-query
// cap: each user is a single round-trip instead of four.
async function fetchUserDetail(user: string): Promise<UserDetail> {
  const u = user.replace(/'/g, "''"); // escape for HogQL string literal
  const where = `event='mcp tool called' AND distinct_id='${u}' AND ${WINDOW}`;
  const [summaryRows, byTool, errors, prompts] = [
    await hogql(`SELECT count() AS calls, countIf(properties.ok=true) AS ok, countIf(properties.ok=false) AS failed,
                   count(DISTINCT properties.tool) AS tools,
                   toString(min(toDateTime(timestamp))) AS first_seen,
                   toString(max(toDateTime(timestamp))) AS last_seen
            FROM events WHERE ${where}`),
    await hogql(`SELECT properties.tool AS tool, count() AS calls, countIf(properties.ok=true) AS ok,
                   countIf(properties.ok=false) AS failed, round(avg(properties.duration_ms)) AS avg_ms
            FROM events WHERE ${where}
            GROUP BY tool ORDER BY calls DESC`),
    await hogql(`SELECT properties.tool AS tool, properties.error_code AS error_code, count() AS n
            FROM events WHERE ${where} AND properties.ok=false
            GROUP BY tool, error_code ORDER BY n DESC`),
    await hogql(`SELECT toString(toDateTime(timestamp)) AS ts, properties.tool AS tool, properties.ok AS ok,
                   properties.error_code AS error_code, properties.triggered_by AS prompt
            FROM events WHERE ${where}
                  AND properties.triggered_by IS NOT NULL AND properties.triggered_by != ''
            ORDER BY ts DESC LIMIT 200`),
  ];
  const s = (summaryRows[0] as unknown[]) ?? [];
  return {
    user,
    summary: {
      calls: Number(s[0] ?? 0), ok: Number(s[1] ?? 0), failed: Number(s[2] ?? 0),
      tools: Number(s[3] ?? 0), firstSeen: String(s[4] ?? ""), lastSeen: String(s[5] ?? ""),
    },
    byTool, errors, prompts,
  };
}

// ── Run all queries ──────────────────────────────────────────────────────────
async function main() {
  console.log(`Querying PostHog project ${PROJECT_ID} @ ${HOST} (last ${DAYS}d)…`);
  for (const p of panels) {
    try {
      p.data = await hogql(p.query);
      console.log(`  ✓ ${p.id} (${p.data.length} rows)`);
    } catch (err) {
      p.data = [];
      console.error(`  ✗ ${p.id}: ${(err as Error).message}`);
    }
  }

  // Per-user drill-down for every roster user (skip anonymous sentinels).
  const roster = panels.find((p) => p.id === "roster")?.data ?? [];
  const users = roster.map((r) => String((r as unknown[])[0])).filter((u) => !u.startsWith("mcp:"));
  // Sequential — PostHog caps concurrent queries at 3 per team.
  const details: Record<string, UserDetail> = {};
  for (const u of users) {
    try {
      details[u] = await fetchUserDetail(u);
    } catch (err) {
      console.error(`  ✗ user-detail ${u}: ${(err as Error).message}`);
    }
  }
  console.log(`  ✓ user-detail (${Object.keys(details).length}/${users.length} users)`);

  const generatedAt = new Date().toISOString();
  const html = renderHTML(panels, details, generatedAt);
  writeFileSync(OUT, html, "utf8");
  console.log(`\nDashboard written: ${OUT}`);

  if (WRITE_JSON) {
    const jsonPath = OUT.replace(/\.html$/, "") + ".data.json";
    const dump = { panels: Object.fromEntries(panels.map((p) => [p.id, p.data])), userDetails: details };
    writeFileSync(jsonPath, JSON.stringify(dump, null, 2), "utf8");
    console.log(`Raw data written:  ${jsonPath}`);
  }
}

// ── HTML rendering ───────────────────────────────────────────────────────────
const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function renderPanel(p: Panel): string {
  const rows = p.data ?? [];
  const dataJson = JSON.stringify(rows);
  switch (p.kind) {
    case "stackedBar":
    case "line":
    case "donut":
    case "funnel":
    case "hbar":
      return `<section class="panel"><h2>${esc(p.title)}</h2>${
        p.subtitle ? `<p class="sub">${esc(p.subtitle)}</p>` : ""
      }<canvas id="c-${p.id}"></canvas>
      <script>window.__PANELS=window.__PANELS||{};window.__PANELS[${JSON.stringify(
        p.id
      )}]={kind:${JSON.stringify(p.kind)},rows:${dataJson}};</script></section>`;
    case "table": {
      const head = (p.columns ?? []).map((c) => `<th>${esc(c)}</th>`).join("");
      const clickable = p.id === "roster";
      const body = rows
        .map((r) => {
          const cells = (r as unknown[]).map((v) => `<td>${esc(v)}</td>`).join("");
          if (clickable) {
            const user = esc((r as unknown[])[0]);
            return `<tr class="rowlink" data-user="${user}" title="Click for advanced metrics + prompts">${cells}</tr>`;
          }
          return `<tr>${cells}</tr>`;
        })
        .join("");
      const hint = clickable ? ' <span class="hint">(click a row →)</span>' : "";
      return `<section class="panel${p.wide ? " full" : ""}"><h2>${esc(p.title)}${hint}</h2>${
        p.subtitle ? `<p class="sub">${esc(p.subtitle)}</p>` : ""
      }<div class="tablewrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></section>`;
    }
    case "friction": {
      const cards = rows
        .map((r) => {
          const [ts, user, category, severity, tool, quote, details] = r as string[];
          return `<div class="fcard sev-${esc(severity)}">
            <div class="fmeta"><span class="badge">${esc(severity)}</span>
              <span class="cat">${esc(category)}</span>
              <span class="when">${esc(ts)}</span></div>
            <blockquote>${esc(quote)}</blockquote>
            <div class="fwho">${esc(user)}${tool ? ` · <code>${esc(tool)}</code>` : ""}</div>
            ${details ? `<details><summary>details</summary><p>${esc(details)}</p></details>` : ""}
          </div>`;
        })
        .join("");
      return `<section class="panel"><h2>${esc(p.title)}</h2>${
        p.subtitle ? `<p class="sub">${esc(p.subtitle)}</p>` : ""
      }<div class="friction">${cards || '<p class="sub">No friction reports in window.</p>'}</div></section>`;
    }
  }
}

function renderHTML(
  panels: Panel[],
  userDetails: Record<string, UserDetail> = {},
  generatedAt: string = new Date().toISOString()
): string {
  const body = panels.map(renderPanel).join("\n");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>MCP Telemetry Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
  :root{color-scheme:dark}
  body{margin:0;background:#0d1117;color:#e6edf3;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  header{padding:24px 32px;border-bottom:1px solid #21262d}
  header h1{margin:0;font-size:20px}
  header .meta{color:#8b949e;font-size:13px;margin-top:4px}
  main{display:grid;grid-template-columns:repeat(auto-fit,minmax(440px,1fr));gap:20px;padding:24px 32px}
  .panel{background:#161b22;border:1px solid #21262d;border-radius:10px;padding:18px 20px;overflow:hidden}
  .panel h2{margin:0 0 2px;font-size:15px}
  .panel .sub{margin:0 0 14px;color:#8b949e;font-size:12px}
  canvas{max-height:300px}
  .tablewrap{overflow-x:auto;max-height:520px;overflow-y:auto}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #21262d;white-space:nowrap}
  th{color:#8b949e;font-weight:600}
  tbody tr:hover{background:#1c2230}
  code{background:#21262d;padding:1px 5px;border-radius:4px;font-size:12px}
  .friction{display:flex;flex-direction:column;gap:12px;max-height:520px;overflow:auto}
  .fcard{background:#11161d;border:1px solid #21262d;border-left:3px solid #6e7681;border-radius:8px;padding:12px 14px}
  .fcard.sev-high{border-left-color:#f85149}
  .fcard.sev-medium{border-left-color:#d29922}
  .fcard.sev-low{border-left-color:#3fb950}
  .fmeta{display:flex;gap:10px;align-items:center;font-size:12px;color:#8b949e;margin-bottom:6px}
  .badge{text-transform:uppercase;font-size:10px;letter-spacing:.5px;background:#21262d;padding:2px 6px;border-radius:4px;color:#e6edf3}
  .fcard blockquote{margin:6px 0;font-style:italic;color:#e6edf3}
  .fwho{font-size:12px;color:#8b949e}
  details{margin-top:6px;font-size:12px;color:#8b949e}
  .full{grid-column:1/-1}
  .hint{font-size:11px;color:#58a6ff;font-weight:400}
  tr.rowlink{cursor:pointer}
  tr.rowlink:hover{background:#1f6feb22}
  header .lastref{color:#3fb950}
  /* Modal */
  .modal-bg{position:fixed;inset:0;background:#000a;display:none;z-index:50;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto}
  .modal-bg.open{display:flex}
  .modal{background:#0d1117;border:1px solid #30363d;border-radius:12px;max-width:920px;width:100%;padding:24px 28px;box-shadow:0 16px 48px #000a}
  .modal h2{margin:0 0 2px;font-size:18px}
  .modal .muser{color:#8b949e;font-size:13px;margin-bottom:16px;word-break:break-all}
  .modal .close{float:right;cursor:pointer;color:#8b949e;font-size:22px;line-height:1;border:none;background:none}
  .modal .close:hover{color:#fff}
  .stats{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px}
  .stat{background:#161b22;border:1px solid #21262d;border-radius:8px;padding:10px 14px;min-width:84px}
  .stat .n{font-size:18px;font-weight:600}
  .stat .l{font-size:11px;color:#8b949e}
  .modal h3{font-size:13px;color:#8b949e;margin:18px 0 8px;text-transform:uppercase;letter-spacing:.5px}
  .prompts{display:flex;flex-direction:column;gap:8px;max-height:340px;overflow:auto}
  .prompt{background:#11161d;border:1px solid #21262d;border-radius:8px;padding:9px 12px;font-size:13px}
  .prompt.fail{border-left:3px solid #f85149}
  .prompt .pmeta{font-size:11px;color:#8b949e;margin-bottom:3px;display:flex;gap:8px;flex-wrap:wrap}
  .prompt .err{color:#f85149}
</style></head>
<body>
<header><h1>MCP Telemetry Dashboard</h1>
<div class="meta">PostHog project ${esc(PROJECT_ID)} · last ${DAYS} days · Last refreshed <span class="lastref" id="lastref" data-ts="${esc(
    generatedAt
  )}">just now</span></div></header>
<main>${body}</main>
<div class="modal-bg" id="modal-bg"><div class="modal" id="modal"></div></div>
<script>window.__USERS=${JSON.stringify(userDetails)};</script>
<script>
const C={text:'#8b949e',grid:'#21262d',ok:'#3fb950',fail:'#f85149',blue:'#58a6ff',amber:'#d29922',palette:['#58a6ff','#3fb950','#d29922','#f85149','#bc8cff','#39c5cf','#ff7b72','#79c0ff']};
Chart.defaults.color=C.text;Chart.defaults.borderColor=C.grid;Chart.defaults.font.size=11;
const P=window.__PANELS||{};
function mk(id){const c=document.getElementById('c-'+id);if(!c||!P[id])return;const {kind,rows}=P[id];
 if(kind==='stackedBar'){new Chart(c,{type:'bar',data:{labels:rows.map(r=>r[0]),datasets:[{label:'OK',data:rows.map(r=>r[1]),backgroundColor:C.ok},{label:'Failed',data:rows.map(r=>r[2]),backgroundColor:C.fail}]},options:{responsive:true,scales:{x:{stacked:true,ticks:{autoSkip:false,maxRotation:90,minRotation:45}},y:{stacked:true}},plugins:{legend:{position:'top'}}}});}
 else if(kind==='line'){new Chart(c,{type:'line',data:{labels:rows.map(r=>r[0]),datasets:[{label:'Calls',data:rows.map(r=>r[1]),borderColor:C.blue,backgroundColor:'transparent',tension:.3},{label:'Users',data:rows.map(r=>r[2]),borderColor:C.amber,backgroundColor:'transparent',tension:.3,yAxisID:'y1'}]},options:{responsive:true,scales:{y:{position:'left'},y1:{position:'right',grid:{drawOnChartArea:false}}}}});}
 else if(kind==='donut'){new Chart(c,{type:'doughnut',data:{labels:rows.map(r=>r[0]||'(none)'),datasets:[{data:rows.map(r=>r[1]),backgroundColor:C.palette}]},options:{responsive:true,plugins:{legend:{position:'right'}}}});}
 else if(kind==='funnel'){const order=['mcp update check','mcp update prompted','mcp update install_clicked','mcp update dismissed','mcp version updated'];const m=Object.fromEntries(rows.map(r=>[r[0],r[1]]));new Chart(c,{type:'bar',data:{labels:order.map(o=>o.replace('mcp ','')),datasets:[{label:'count',data:order.map(o=>m[o]||0),backgroundColor:C.palette}]},options:{indexAxis:'y',responsive:true,plugins:{legend:{display:false}}}});}
 else if(kind==='hbar'){new Chart(c,{type:'bar',data:{labels:rows.map(r=>r[0]),datasets:[{label:'calls',data:rows.map(r=>r[1]),backgroundColor:C.blue}]},options:{indexAxis:'y',responsive:true,plugins:{legend:{display:false}}}});}
}
Object.keys(P).forEach(mk);

// ── Live "last refreshed since X" ticker ──
const lastref=document.getElementById('lastref');
const genTs=lastref?new Date(lastref.dataset.ts).getTime():Date.now();
function ago(){const s=Math.max(0,Math.round((Date.now()-genTs)/1000));
 if(s<60)return s+'s ago';const m=Math.floor(s/60);if(m<60)return m+'m '+(s%60)+'s ago';
 const h=Math.floor(m/60);return h+'h '+(m%60)+'m ago';}
function tick(){if(lastref)lastref.textContent=ago();}
tick();setInterval(tick,1000);

// ── Per-user drill-down modal ──
const U=window.__USERS||{};
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const bg=document.getElementById('modal-bg'),modal=document.getElementById('modal');
function closeModal(){bg.classList.remove('open');}
bg.addEventListener('click',e=>{if(e.target===bg)closeModal();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
function openUser(user){
 const d=U[user];
 if(!d){modal.innerHTML='<button class="close">&times;</button><h2>'+esc(user)+'</h2><p class="muser">No detailed metrics captured for this user.</p>';bg.classList.add('open');modal.querySelector('.close').onclick=closeModal;return;}
 const s=d.summary;
 const stat=(n,l)=>'<div class="stat"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>';
 const succ=s.calls?Math.round(100*s.ok/s.calls):0;
 let html='<button class="close">&times;</button>';
 html+='<h2>'+esc(user)+'</h2><div class="muser">first seen '+esc(s.firstSeen)+' · last seen '+esc(s.lastSeen)+'</div>';
 html+='<div class="stats">'+stat(s.calls,'tool calls')+stat(succ+'%','success')+stat(s.failed,'failed')+stat(s.tools,'distinct tools')+'</div>';
 // tool breakdown
 html+='<h3>Tools used</h3><div class="tablewrap"><table><thead><tr><th>Tool</th><th>Calls</th><th>OK</th><th>Failed</th><th>Avg ms</th></tr></thead><tbody>';
 d.byTool.forEach(r=>{html+='<tr><td>'+esc(r[0])+'</td><td>'+r[1]+'</td><td>'+r[2]+'</td><td>'+r[3]+'</td><td>'+esc(r[4])+'</td></tr>';});
 html+='</tbody></table></div>';
 // errors
 if(d.errors&&d.errors.length){html+='<h3>Errors</h3><div class="tablewrap"><table><thead><tr><th>Tool</th><th>Error code</th><th>Count</th></tr></thead><tbody>';
  d.errors.forEach(r=>{html+='<tr><td>'+esc(r[0])+'</td><td class="err">'+esc(r[1])+'</td><td>'+r[2]+'</td></tr>';});
  html+='</tbody></table></div>';}
 // prompts
 html+='<h3>Prompts ('+(d.prompts?d.prompts.length:0)+')</h3>';
 if(d.prompts&&d.prompts.length){html+='<div class="prompts">';
  d.prompts.forEach(r=>{const ok=r[2]===true||r[2]==='true';
   html+='<div class="prompt'+(ok?'':' fail')+'"><div class="pmeta"><span>'+esc(r[0])+'</span><code>'+esc(r[1])+'</code>'+(r[3]?'<span class="err">'+esc(r[3])+'</span>':'')+'</div>'+esc(r[4])+'</div>';});
  html+='</div>';}
 else{html+='<p class="sub">No prompts captured (this user\\'s client didn\\'t pass _triggered_by).</p>';}
 modal.innerHTML=html;
 modal.querySelector('.close').onclick=closeModal;
 bg.classList.add('open');
}
document.querySelectorAll('tr.rowlink').forEach(tr=>{tr.addEventListener('click',()=>openUser(tr.dataset.user));});
</script>
</body></html>`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
