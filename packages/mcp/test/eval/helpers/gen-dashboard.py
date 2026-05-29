#!/usr/bin/env python3
import sys, json, glob, os, re
from datetime import datetime, timezone

evals_dir = sys.argv[1]
out_path = sys.argv[2]

# ── Load all entries ──────────────────────────────────────────────────────────
entries = []
for f in sorted(glob.glob(os.path.join(evals_dir, "*.json"))):
    try:
        d = json.load(open(f))
        # Files are either a top-level array of entries, or {"entries": [...]}
        rows = d if isinstance(d, list) else d.get("entries", [])
        for e in rows:
            e["_file"] = f
            entries.append(e)
    except Exception:
        pass

# Sort oldest→newest by file name (ISO prefix)
entries.sort(key=lambda e: e.get("_file", ""))

# Track the most recent run file
latest_file = entries[-1]["_file"] if entries else None

# Group files within 60 minutes of the newest file as "last session"
# This makes --improve iterations all show up under "Last run"
import os as _os
latest_mtime = _os.path.getmtime(latest_file) if latest_file else 0
SESSION_WINDOW_SECS = 3600  # 60 minutes
last_session_files = set(
    e["_file"] for e in entries
    if latest_mtime - _os.path.getmtime(e["_file"]) <= SESSION_WINDOW_SECS
) if latest_file else set()

# ── Aggregate stats ───────────────────────────────────────────────────────────
total = len(entries)
passed = sum(1 for e in entries if e.get("passed"))
failed = total - passed
rate = round(100 * passed / total) if total else 0

def avg_score(e):
    js = e.get("evidence", {}).get("judge_scores", {})
    vals = [js.get(k, 0) for k in ("mission_match","instruction_adherence","no_fabrication","tool_selection_fit")]
    vals = [v for v in vals if v]
    return round(sum(vals)/len(vals), 1) if vals else 0

avg_mm = round(sum(e.get("evidence",{}).get("judge_scores",{}).get("mission_match",0) for e in entries) / total, 1) if total else 0

# Unique workflow labels (everything before /workflow-N or /workflow-Nb)
def workflow_label(name):
    return re.sub(r'/workflow-\d+[a-z]?$', '', name) if name else name

workflow_counts = {}
for e in entries:
    lbl = workflow_label(e.get("name",""))
    workflow_counts[lbl] = workflow_counts.get(lbl, 0) + 1

last_updated = datetime.now(timezone.utc).strftime("%-m/%-d/%Y, %-I:%M:%S %p")

# ── Self-improving run grouping ───────────────────────────────────────────────
# Group entries by run_file — each JSON file is one eval batch.
# We identify "self-improving" runs as files that contain the same workflow (2b)
# across multiple consecutive JSON files (relentless loop iterations).
# We expose each unique _file as a "run" for filtering.
run_files = []
seen = set()
for e in entries:
    f = e.get("_file","")
    if f and f not in seen:
        seen.add(f)
        run_files.append(f)

# Find runs containing workflow-2b (self-improvement target)
self_improve_files = set()
for e in entries:
    if "workflow-2b" in e.get("name","") or "workflow-2b" in e.get("evidence",{}).get("session",{}).get("fixture_id",""):
        self_improve_files.add(e.get("_file",""))

latest_count = sum(1 for e in entries if e.get("_file","") in last_session_files) if latest_file else 0
self_improve_count = sum(1 for e in entries if e.get("_file","") in self_improve_files)

# ── Score color ───────────────────────────────────────────────────────────────
def score_color(v):
    try: v = int(round(float(v)))
    except: return "#6b7280"
    return {5:"#22c55e",4:"#84cc16",3:"#eab308",2:"#f97316",1:"#ef4444"}.get(v,"#6b7280")

def rate_color(r):
    return "#22c55e" if r >= 50 else "#ef4444"

# ── Trend bars (one per entry, oldest→newest) ─────────────────────────────────
trend_bars = ""
for e in entries:
    avg = avg_score(e)
    height = max(4, int(avg / 5 * 60))
    color = "#22c55e" if e.get("passed") else "#ef4444"
    name = e.get("name","")
    trend_bars += f'<div title="{name} avg={avg}" style="width:4px;height:{height}px;background:{color};flex-shrink:0;border-radius:1px 1px 0 0"></div>'

# ── Workflow chip filters ─────────────────────────────────────────────────────
chip_html = '<button onclick="filterWorkflow(\'\')" id="chip-all" class="chip chip-active">All ({total})</button>'.replace("{total}", str(total))
if latest_file:
    chip_html += f'<button onclick="filterLastRun()" id="chip-lastrun" class="chip">Last session ({latest_count})</button>'
if self_improve_files:
    chip_html += f'<button onclick="filterSelfImprove()" id="chip-selfimprove" class="chip">🔄 Self-improve ({self_improve_count})</button>'
for lbl, cnt in sorted(workflow_counts.items()):
    safe = re.sub(r'[^a-zA-Z0-9_-]', '-', lbl)
    chip_html += f'<button onclick="filterWorkflow(\'{safe}\')" id="chip-{safe}" class="chip">{lbl} ({cnt})</button>'

# ── Entry rows (newest first for display) ────────────────────────────────────
def fmt_ts(name):
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})', name)
    if m:
        try:
            dt = datetime(int(m.group(1)),int(m.group(2)),int(m.group(3)),
                          int(m.group(4)),int(m.group(5)),int(m.group(6)), tzinfo=timezone.utc)
            return dt.strftime("%-m/%-d/%Y, %-I:%M:%S %p")
        except: pass
    return ""

def score_pill(label, val):
    c = score_color(val)
    return f'<span style="color:{c};font-size:12px;font-weight:bold;margin-left:10px">{label}:{val}</span>'

def render_row(e, idx):
    is_passed = e.get("passed", False)
    badge_bg = "#22c55e" if is_passed else "#ef4444"
    badge_fg = "#000" if is_passed else "#fff"
    badge_txt = "PASS" if is_passed else "FAIL"
    name = e.get("name","")
    ts = fmt_ts(os.path.basename(e.get("_file","")))
    dur = f'{e.get("duration_ms",0)/1000:.1f}s'
    turns = e.get("turns_used", 0)
    ev = e.get("evidence", {})
    js = ev.get("judge_scores", {})
    mm = js.get("mission_match",0)
    ia = js.get("instruction_adherence",0)
    nf = js.get("no_fabrication",0)
    tsf = js.get("tool_selection_fit",0)

    pills = score_pill("MM",mm) + score_pill("IA",ia) + score_pill("NF",nf) + score_pill("TSF",tsf)

    # Expanded detail
    invariants_html = ""
    for inv in ev.get("invariants", []):
        ok = inv.get("pass", False) or inv.get("result", "") == "PASS"
        icon, c = ("✓","#22c55e") if ok else ("✗","#ef4444")
        invariants_html += f'<div style="color:{c};font-size:12px;margin:2px 0">{icon} {inv.get("name","")} — <span style="color:#8b949e">{inv.get("reason","")}</span></div>'

    criteria_html = ""
    for cr in ev.get("per_criterion", []):
        ok = cr.get("pass", False)
        icon, c = ("✓","#22c55e") if ok else ("✗","#ef4444")
        criteria_html += f'<div style="color:{c};font-size:12px;margin:2px 0">{icon} {cr.get("criterion","")}<br><span style="color:#8b949e;padding-left:16px">→ {cr.get("reasoning","")}</span></div>'

    tool_names = ", ".join(t.get("name","") for t in ev.get("tool_calls",[]))
    judge_reasoning = ev.get("judge_reasoning","").replace("<","&lt;").replace(">","&gt;")
    tin = e.get("tokens_session_in",0)
    tcache = e.get("tokens_session_cache",0)
    tout = e.get("tokens_session_out",0)
    scenario = ev.get("session",{}).get("prompt_name","")

    wf_label = re.sub(r'[^a-zA-Z0-9_-]', '-', workflow_label(name))
    file_val = e.get("_file", "").replace('"', '&quot;')
    is_self_improve = "1" if e.get("_file","") in self_improve_files else "0"

    return f"""
<div class="entry-row" data-workflow="{wf_label}" data-name="{name}" data-passed="{'1' if is_passed else '0'}" data-file="{file_val}" data-selfimprove="{is_self_improve}">
  <div class="entry-header" onclick="toggleEntry({idx})" style="display:flex;align-items:center;padding:10px 14px;cursor:pointer;border-bottom:1px solid #21262d;gap:10px">
    <span style="background:{badge_bg};color:{badge_fg};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:bold;min-width:38px;text-align:center">{badge_txt}</span>
    <div style="flex:1;min-width:0">
      <div style="font-family:monospace;font-size:13px;color:#58a6ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{name}</div>
      <div style="color:#8b949e;font-size:11px;margin-top:2px">{ts} · {dur} · {turns} turns</div>
    </div>
    <div style="display:flex;align-items:center;white-space:nowrap">{pills}</div>
    <span class="chevron-{idx}" style="color:#8b949e;margin-left:12px;font-size:12px">▶</span>
  </div>
  <div id="detail-{idx}" style="display:none;padding:14px 16px;background:#0d1117;font-size:12px">
    {"<div style='color:#8b949e;margin-bottom:8px'>Prompt: <span style=color:#c9d1d9>" + scenario + "</span></div>" if scenario else ""}
    {"<div style='margin-bottom:8px'><div style='color:#8b949e;margin-bottom:4px'>Invariants</div>" + invariants_html + "</div>" if invariants_html else ""}
    {"<div style='margin-bottom:8px'><div style='color:#8b949e;margin-bottom:4px'>Criteria</div>" + criteria_html + "</div>" if criteria_html else ""}
    {"<div style='margin-bottom:8px;color:#8b949e'>Tools: <span style=color:#c9d1d9>" + tool_names + "</span></div>" if tool_names else ""}
    {"<div style='margin-bottom:8px'><div style='color:#8b949e;margin-bottom:4px'>Judge reasoning</div><div style='color:#c9d1d9;padding:8px;background:#161b22;border-radius:4px'>" + judge_reasoning + "</div></div>" if judge_reasoning else ""}
    <div style="color:#8b949e">Tokens: {tin} in / {tcache} cache / {tout} out</div>
  </div>
</div>"""

rows_html = "".join(render_row(e, i) for i, e in enumerate(reversed(entries)))

# ── Full HTML ─────────────────────────────────────────────────────────────────
html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Leadbay Eval Dashboard</title>
<style>
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{ background: #0d1117; color: #c9d1d9; font-family: monospace; font-size: 14px; }}
.wrap {{ max-width: 1200px; margin: 0 auto; padding: 24px; }}
.stat-tile {{ background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 14px 20px; min-width: 90px; }}
.stat-label {{ font-size: 11px; color: #8b949e; letter-spacing: 0.05em; margin-bottom: 6px; }}
.stat-val {{ font-size: 28px; font-weight: bold; line-height: 1; }}
.chip {{ background: #161b22; border: 1px solid #30363d; border-radius: 20px; padding: 4px 12px;
         font-size: 12px; font-family: monospace; color: #8b949e; cursor: pointer; white-space: nowrap; }}
.chip:hover {{ border-color: #58a6ff; color: #c9d1d9; }}
.chip-active {{ border-color: #58a6ff; color: #58a6ff; }}
.entry-row {{ background: #161b22; border: 1px solid #21262d; border-radius: 6px; margin-bottom: 6px; overflow: hidden; }}
.entry-row:hover .entry-header {{ background: #1c2128; }}
#search {{ background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 6px 12px;
           color: #c9d1d9; font-family: monospace; font-size: 12px; width: 220px; outline: none; }}
#search:focus {{ border-color: #58a6ff; }}
</style>
</head>
<body>
<div class="wrap">

  <!-- Header -->
  <div style="margin-bottom:20px">
    <h1 style="font-size:22px;color:#f0f6fc;margin-bottom:6px">⚡ Leadbay Eval Dashboard</h1>
    <div style="color:#8b949e;font-size:13px">{total} runs · {len(workflow_counts)} workflows · last updated {last_updated}</div>
  </div>

  <!-- Stat tiles -->
  <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">
    <div class="stat-tile"><div class="stat-label">TOTAL</div><div class="stat-val" style="color:#f0f6fc">{total}</div></div>
    <div class="stat-tile"><div class="stat-label">PASS</div><div class="stat-val" style="color:#22c55e">{passed}</div></div>
    <div class="stat-tile"><div class="stat-label">FAIL</div><div class="stat-val" style="color:#ef4444">{failed}</div></div>
    <div class="stat-tile"><div class="stat-label">PASS RATE</div><div class="stat-val" style="color:{rate_color(rate)}">{rate}%</div></div>
    <div class="stat-tile"><div class="stat-label">AVG MM</div><div class="stat-val" style="color:{score_color(avg_mm)}">{avg_mm}</div></div>
  </div>

  <!-- Trend chart -->
  <div style="background:#161b22;border:1px solid #30363d;border-radius:6px;padding:16px;margin-bottom:20px">
    <div style="color:#8b949e;font-size:12px;margin-bottom:10px">Pass/Fail trend (all runs, oldest → newest)</div>
    <div style="display:flex;align-items:flex-end;gap:2px;height:64px;overflow-x:auto">
      {trend_bars}
    </div>
  </div>

  <!-- Filter bar -->
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">
    <button onclick="setPassFilter('all')" id="btn-all" class="chip chip-active">All</button>
    <button onclick="setPassFilter('pass')" id="btn-pass" class="chip">Pass only</button>
    <button onclick="setPassFilter('fail')" id="btn-fail" class="chip">Fail only</button>
    <div style="flex:1"></div>
    <input id="search" placeholder="Search name or run ID..." oninput="applyFilters()">
  </div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
    {chip_html}
  </div>

  <!-- Entry list -->
  <div id="list">{rows_html}</div>

</div>
<script>
const ENTRIES = {json.dumps(list(reversed(entries)))};
const LATEST_FILE = {json.dumps(latest_file or "")};
const LAST_SESSION_FILES = {json.dumps(list(last_session_files))};
const SELF_IMPROVE_FILES = {json.dumps(list(self_improve_files))};
let passFilter = 'all';
let workflowFilter = '';
let lastRunFilter = false;
let selfImproveFilter = false;

function toggleEntry(idx) {{
  const d = document.getElementById('detail-' + idx);
  const c = document.querySelector('.chevron-' + idx);
  if (d.style.display === 'none') {{ d.style.display = 'block'; c.textContent = '▼'; }}
  else {{ d.style.display = 'none'; c.textContent = '▶'; }}
}}

function setPassFilter(f) {{
  passFilter = f;
  ['all','pass','fail'].forEach(x => document.getElementById('btn-'+x).classList.toggle('chip-active', x===f));
  applyFilters();
}}

function filterWorkflow(w) {{
  workflowFilter = w;
  lastRunFilter = false;
  selfImproveFilter = false;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('chip-active'));
  const active = w ? document.getElementById('chip-' + w) : document.getElementById('chip-all');
  if (active) active.classList.add('chip-active');
  applyFilters();
}}

function filterLastRun() {{
  lastRunFilter = true;
  selfImproveFilter = false;
  workflowFilter = '';
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('chip-active'));
  const btn = document.getElementById('chip-lastrun');
  if (btn) btn.classList.add('chip-active');
  applyFilters();
}}

function filterSelfImprove() {{
  selfImproveFilter = true;
  lastRunFilter = false;
  workflowFilter = '';
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('chip-active'));
  const btn = document.getElementById('chip-selfimprove');
  if (btn) btn.classList.add('chip-active');
  applyFilters();
}}

function applyFilters() {{
  const q = document.getElementById('search').value.toLowerCase();
  document.querySelectorAll('.entry-row').forEach(row => {{
    const wf = row.dataset.workflow;
    const name = row.dataset.name.toLowerCase();
    const p = row.dataset.passed === '1';
    const file = row.dataset.file || '';
    const si = row.dataset.selfimprove === '1';
    let show = true;
    if (passFilter === 'pass' && !p) show = false;
    if (passFilter === 'fail' && p) show = false;
    if (lastRunFilter && !LAST_SESSION_FILES.includes(file)) show = false;
    if (selfImproveFilter && !si) show = false;
    if (!lastRunFilter && !selfImproveFilter && workflowFilter && wf !== workflowFilter) show = false;
    if (q && !name.includes(q)) show = false;
    row.style.display = show ? '' : 'none';
  }});
}}
</script>
</body>
</html>"""

with open(out_path, "w") as f:
    f.write(html)
print("file://" + os.path.abspath(out_path))
