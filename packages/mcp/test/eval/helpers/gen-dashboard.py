#!/usr/bin/env python3
"""
Leadbay Eval Dashboard generator.

Reads all JSON files from .context/evals/, renders a self-contained HTML
dashboard with:
  - Latest iteration filter: most-recent entry PER workflow (one row per WF)
  - Latest run filter:       all entries from the most-recent JSON file
  - All:                     every entry ever, newest first
  - Workflow chips:          filter to one workflow across all history
"""
import json, os, sys, glob, re
from datetime import datetime
from html import escape as _html_escape


def esc(value):
    """Escape model/judge-generated text before embedding it in the
    self-contained HTML report. Eval names, workflow labels, criteria, judge
    reasoning, goals, and tool names all originate from model/judge output and
    may contain quotes or markup; interpolating them raw would break the DOM or
    let injected HTML/JS run when the report is opened locally. quote=True
    escapes both ' and " so values are safe in single- and double-quoted
    attributes as well as in text nodes."""
    return _html_escape("" if value is None else str(value), quote=True)

# Static workflow name table. Keyed by fixture_id ("workflow-N").
WORKFLOW_NAMES = {
    "workflow-1":  "Daily lead discovery",
    "workflow-2":  "Follow-up check-in",
    "workflow-3":  "Single-domain research",
    "workflow-4":  "CSV import + qualify",
    "workflow-5":  "AI qualify top-N",
    "workflow-6":  "Audience refinement",
    "workflow-7":  "Prospecting overview",
    "workflow-8":  "Outreach drafting",
    "workflow-9":  "Outreach logging",
    "workflow-10": "Field sales tour",
    "workflow-11": "Team prospecting",
    "workflow-12": "Lens extension",
    "workflow-13": "Lens management",
    "workflow-14": "Lens creation",
    "workflow-15": "Reprioritize a neglected account",
    "workflow-16": "Artifact proposal gate",
    "workflow-17": "Recurrence routing gate",
    "workflow-18": "Widget overdelivery guard",
}

def friendly_name(entry):
    """Return human-readable workflow name for an entry."""
    fixture = entry.get("evidence", {}).get("session", {}).get("fixture_id", "")
    if fixture in WORKFLOW_NAMES:
        return WORKFLOW_NAMES[fixture]
    name = entry.get("name", "")
    m = re.search(r'workflow[-_]?(\d+[a-z]?)', name, re.I)
    if m:
        key = f"workflow-{m.group(1)}"
        if key in WORKFLOW_NAMES:
            return WORKFLOW_NAMES[key]
    if "/" in name:
        return name.split("/", 1)[1].replace("-", " ").replace("_", " ").title()
    return name

def score_color(s):
    return {5:"#22c55e", 4:"#84cc16", 3:"#eab308", 2:"#f97316", 1:"#ef4444"}.get(s, "#8b949e")

def sort_key(filename):
    """Sort key: real /eval runs by timestamp, relentless iters by iter number within a group."""
    base = os.path.basename(filename).replace(".json", "")
    m = re.match(r'relentless-iter-(\d+)', base)
    if m:
        # Group relentless files together at the "2026-05-30T05" range, ordered by iter
        return f"2026-05-30T05-{int(m.group(1)):04d}-00"
    return base  # timestamp filenames sort lexicographically

def load_entries(evals_dir):
    """Load all entries from all JSON files, newest file first."""
    files = sorted(glob.glob(os.path.join(evals_dir, "*.json")), key=sort_key, reverse=True)
    entries = []
    for f in files:
        try:
            with open(f) as fh:
                data = json.load(fh)
            run_entries = data.get("entries", [])
            for e in run_entries:
                e["_run_file"] = os.path.basename(f)
                # Propagate relentless iter metadata from entry fields
                if "_relentless_iter" in e:
                    e["_is_relentless"] = True
            entries.extend(run_entries)
        except Exception:
            pass
    return entries

def latest_run_file(entries):
    """Latest run file — prefer non-relentless files (actual /eval runs)."""
    for e in entries:
        if not e.get("_is_relentless"):
            return e.get("_run_file", "")
    return entries[0].get("_run_file", "") if entries else ""

def latest_per_workflow(entries):
    """Return set of (name, _run_file) for the most-recent entry per workflow.
    Prefers non-relentless entries (actual eval runs) over relentless backfill."""
    seen = {}
    # First pass: non-relentless entries (newest first)
    for e in entries:
        if not e.get("_is_relentless"):
            wf = friendly_name(e)
            if wf not in seen:
                seen[wf] = (e.get("name",""), e.get("_run_file",""))
    # Second pass: fill in any workflows not covered by real runs
    for e in entries:
        wf = friendly_name(e)
        if wf not in seen:
            seen[wf] = (e.get("name",""), e.get("_run_file",""))
    return set(v for v in seen.values())

def format_ts(run_file):
    ts_raw = run_file.replace(".json", "")
    m = re.match(r'(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})', ts_raw)
    if m:
        return f"{m.group(1)} {m.group(2)}:{m.group(3)}:{m.group(4)}"
    return ts_raw[:19]

def gen(evals_dir, out_path):
    entries = load_entries(evals_dir)
    total = len(entries)
    passed = sum(1 for e in entries if e.get("passed"))
    failed = total - passed
    pass_rate = round(passed / total * 100) if total else 0

    def to_num(v, default=0.0):
        """Coerce a model-supplied score to a number; default on non-numeric so
        a malformed judge payload can't crash the stat tiles."""
        try:
            return float(v)
        except (TypeError, ValueError):
            return default

    mm_scores = [to_num(e.get("evidence",{}).get("judge_scores",{}).get("mission_match",0)) for e in entries]
    avg_mm = round(sum(mm_scores)/len(mm_scores), 1) if mm_scores else 0

    last_updated = datetime.now().strftime("%Y-%m-%d %H:%M")
    latest_run = latest_run_file(entries)
    latest_wf_set = latest_per_workflow(entries)  # set of (name, run_file) tuples

    # Unique workflow labels for chips
    wf_labels_seen = []
    wf_labels_set = set()
    for e in entries:
        label = friendly_name(e)
        if label not in wf_labels_set:
            wf_labels_set.add(label)
            wf_labels_seen.append(label)

    # Trend bars (oldest→newest)
    def numeric_scores(scores):
        """Judge scores come from model output — coerce to numbers and drop
        any non-numeric values so a malformed payload can't crash generation."""
        out = []
        for v in scores.values():
            try:
                out.append(float(v))
            except (TypeError, ValueError):
                continue
        return out
    # (to_num, defined above, handles single-value coercion for the stat tiles.)

    trend_bars = ""
    for e in reversed(entries):
        scores = e.get("evidence", {}).get("judge_scores", {})
        nums = numeric_scores(scores)
        avg_s = sum(nums) / len(nums) if nums else 0
        h = max(4, int(avg_s / 5 * 60))
        color = "#22c55e" if e.get("passed") else "#ef4444"
        trend_bars += f'<div style="width:4px;height:{h}px;background:{color};border-radius:2px;flex-shrink:0"></div>'

    # Workflow chips
    workflow_chips = ""
    for label in wf_labels_seen:
        count = sum(1 for e in entries if friendly_name(e) == label)
        workflow_chips += f'<button class="chip" data-wflabel="{esc(label)}" onclick="filterWf(this)">{esc(label)} ({count})</button>'

    # Entry HTML
    entry_html = ""
    for i, e in enumerate(entries):
        name = e.get("name", "")
        run_file = e.get("_run_file", "")
        display_name = friendly_name(e)
        is_relentless = e.get("_is_relentless", False)
        is_latest_run = "true" if (run_file == latest_run and not is_relentless) else "false"
        is_latest_iter = "true" if (name, run_file) in latest_wf_set else "false"
        relentless_iter = e.get("_relentless_iter")
        relentless_goal = e.get("_relentless_goal", "")
        passed_flag = e.get("passed", False)
        badge_color = "#22c55e" if passed_flag else "#ef4444"
        badge_text = "PASS" if passed_flag else "FAIL"
        badge_fg = "#000" if passed_flag else "#fff"
        dur = round(e.get("duration_ms", 0) / 1000, 1)
        turns = e.get("turns_used", 0)
        ts = format_ts(run_file)
        scores = e.get("evidence", {}).get("judge_scores", {})

        def score_pill(k, v):
            # k and v come from the judge payload (model output) — escape both
            # before embedding in HTML. Coerce v to int so score_color() (which
            # feeds a style attribute) and the displayed value never carry
            # arbitrary markup; non-numeric scores fall back to a neutral color
            # and the raw (escaped) value is shown as-is.
            try:
                v_num = int(v)
            except (TypeError, ValueError):
                v_num = None
            color = score_color(v_num) if v_num is not None else "#8b949e"
            label = esc(str(k).split("_")[0].upper()[:2])
            val = str(v_num) if v_num is not None else esc(str(v))
            return (f'<span style="background:{color};color:#000;padding:1px 5px;'
                    f'border-radius:3px;font-size:11px;font-weight:600">{label}:{val}</span>')

        score_pills = "".join(score_pill(k, v) for k, v in scores.items())
        invs = e.get("evidence", {}).get("invariants", [])
        inv_pass = sum(1 for x in invs if x.get("pass"))
        criteria = e.get("evidence", {}).get("per_criterion", [])

        def crit_row(c):
            col = "#22c55e" if c.get("pass") else "#ef4444"
            sym = "✓" if c.get("pass") else "✗"
            return (f'<div style="margin:2px 0">'
                    f'<span style="color:{col}">{sym}</span> {esc(c.get("criterion",""))}'
                    f' <span style="color:#8b949e;font-size:11px">→ {esc(c.get("reasoning",""))}</span>'
                    f'</div>')

        criteria_html = "".join(crit_row(c) for c in criteria)
        tools = ", ".join(esc(t.get("name", "")) for t in e.get("evidence", {}).get("tool_calls", []))
        judge_reasoning = e.get("evidence", {}).get("judge_reasoning", "")
        tin = e.get("tokens_session_in", 0)
        tcache = e.get("tokens_session_cache", 0)
        tout = e.get("tokens_session_out", 0)
        jin = e.get("tokens_judge_in", 0)
        jout = e.get("tokens_judge_out", 0)

        badges = ""
        if is_latest_iter == "true":
            badges += ' <span style="background:#0d4a1a;color:#22c55e;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:600;border:1px solid #22c55e">LATEST</span>'
        elif is_latest_run == "true":
            badges += ' <span style="background:#1d2d50;color:#60a5fa;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:600;border:1px solid #3b82f6">THIS RUN</span>'
        if relentless_iter:
            badges += f' <span style="background:#2d1a4a;color:#c084fc;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:600;border:1px solid #7c3aed">iter {esc(relentless_iter)}</span>'

        entry_html += f'''
<div class="entry" data-wflabel="{esc(display_name)}" data-passed="{str(passed_flag).lower()}" data-name="{esc(name)}" data-latest-iter="{is_latest_iter}" data-latest-run="{is_latest_run}" data-relentless="{'true' if is_relentless else 'false'}">
  <div class="entry-header" onclick="toggle({i})">
    <span style="background:{badge_color};color:{badge_fg};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;flex-shrink:0">{badge_text}</span>
    <span style="flex:1;margin:0 10px"><b>{esc(display_name)}</b>{badges}<br><span style="color:#8b949e;font-size:10px;font-family:monospace">{esc(name)}</span></span>
    <div style="display:flex;gap:4px;align-items:center">{score_pills}</div>
    <span style="color:#8b949e;font-size:11px;margin-left:10px">▶</span>
  </div>
  <div style="color:#8b949e;font-size:11px;padding:2px 0 6px 0">{ts} · {dur}s · {turns} turns · invariants {inv_pass}/{len(invs)}</div>
  <div class="entry-body" id="body-{i}" style="display:none">
    <div style="margin-bottom:8px"><b>Run file:</b> <code style="font-size:11px">{esc(run_file)}</code>{f' &nbsp;·&nbsp; <b>Goal:</b> <span style="color:#c084fc">{esc(relentless_goal)}</span>' if relentless_goal else ''}</div>
    <div style="margin-bottom:8px"><b>Tools:</b> <code style="font-size:11px">{tools}</code></div>
    <div style="margin-bottom:8px"><b>Criteria:</b>{criteria_html}</div>
    <div style="margin-bottom:8px"><b>Judge reasoning:</b> <span style="color:#8b949e">{esc(judge_reasoning)}</span></div>
    <div style="color:#8b949e;font-size:11px">Session: {tin} in / {tcache} cache / {tout} out &nbsp;|&nbsp; Judge: {jin} in / {jout} out</div>
  </div>
</div>'''

    html = f'''<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Leadbay Eval Dashboard</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:#0d1117;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",monospace;padding:24px}}
h1{{font-family:monospace;font-weight:700;font-size:20px;margin-bottom:4px}}
.subtitle{{color:#8b949e;font-size:13px;margin-bottom:20px}}
.tiles{{display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap}}
.tile{{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px 20px;min-width:100px}}
.tile-label{{font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px}}
.tile-val{{font-size:28px;font-weight:700;margin-top:4px}}
.trend{{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px 16px;margin-bottom:20px}}
.trend-label{{font-size:11px;color:#8b949e;margin-bottom:8px}}
.trend-bars{{display:flex;align-items:flex-end;gap:2px;height:64px}}
.filters{{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;align-items:center}}
.filter-btn{{background:#161b22;border:1px solid #30363d;border-radius:6px;color:#c9d1d9;padding:4px 12px;cursor:pointer;font-size:12px}}
.filter-btn.active{{border-color:#3b82f6;color:#3b82f6}}
.chip{{background:#161b22;border:1px solid #30363d;border-radius:12px;color:#8b949e;padding:3px 10px;cursor:pointer;font-size:11px}}
.chip.active{{border-color:#8b5cf6;color:#8b5cf6}}
.sep{{color:#30363d;margin:0 4px;user-select:none}}
input[type=text]{{background:#161b22;border:1px solid #30363d;border-radius:6px;color:#c9d1d9;padding:4px 10px;font-size:12px;width:200px;outline:none}}
.entry{{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px 16px;margin-bottom:8px}}
.entry-header{{display:flex;align-items:center;cursor:pointer;gap:8px}}
.entry-body{{border-top:1px solid #30363d;margin-top:8px;padding-top:8px}}
</style>
</head>
<body>
<h1>⚡ Leadbay Eval Dashboard</h1>
<div class="subtitle">{total} entries · {len(wf_labels_seen)} workflows · last updated {last_updated}</div>
<div class="tiles">
  <div class="tile"><div class="tile-label">Total</div><div class="tile-val" style="color:#c9d1d9">{total}</div></div>
  <div class="tile"><div class="tile-label">Pass</div><div class="tile-val" style="color:#22c55e">{passed}</div></div>
  <div class="tile"><div class="tile-label">Fail</div><div class="tile-val" style="color:#ef4444">{failed}</div></div>
  <div class="tile"><div class="tile-label">Pass Rate</div><div class="tile-val" style="color:{"#22c55e" if pass_rate>=50 else "#ef4444"}">{pass_rate}%</div></div>
  <div class="tile"><div class="tile-label">Avg MM</div><div class="tile-val" style="color:{score_color(round(avg_mm))}">{avg_mm}</div></div>
</div>
<div class="trend">
  <div class="trend-label">Pass/Fail trend (all runs, oldest → newest)</div>
  <div class="trend-bars">{trend_bars}</div>
</div>
<div class="filters">
  <button class="filter-btn active" onclick="setFilter(this,'all')">All</button>
  <button class="filter-btn" onclick="setFilter(this,'latest-iter')" title="Most recent result per workflow — one row per workflow">Latest iteration</button>
  <button class="filter-btn" onclick="setFilter(this,'latest-run')" title="All entries from the most recent /eval invocation">Latest run</button>
  <button class="filter-btn" onclick="setFilter(this,'relentless')" title="All relentless improvement iterations" style="color:#c084fc;border-color:#7c3aed">Relentless iters</button>
  <button class="filter-btn" onclick="setFilter(this,'pass')">Pass only</button>
  <button class="filter-btn" onclick="setFilter(this,'fail')">Fail only</button>
  <span class="sep">|</span>
  {workflow_chips}
  <input type="text" id="search" placeholder="Search..." oninput="applyFilters()">
</div>
<div id="entries">{entry_html}</div>
<script>
var activeFilter='all', activeWf=null;
function toggle(i){{
  var b=document.getElementById('body-'+i);
  b.style.display=b.style.display==='none'?'block':'none';
}}
function setFilter(btn,val){{
  activeFilter=val;
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  applyFilters();
}}
function filterWf(btn){{
  var wf=btn.dataset.wflabel;
  if(activeWf===wf){{activeWf=null;btn.classList.remove('active');}}
  else{{activeWf=wf;document.querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));btn.classList.add('active');}}
  applyFilters();
}}
function applyFilters(){{
  var q=document.getElementById('search').value.toLowerCase();
  document.querySelectorAll('.entry').forEach(function(el){{
    var show=true;
    if(activeFilter==='latest-iter'&&el.dataset.latestIter!=='true')show=false;
    else if(activeFilter==='latest-run'&&el.dataset.latestRun!=='true')show=false;
    else if(activeFilter==='relentless'&&el.dataset.relentless!=='true')show=false;
    else if(activeFilter==='pass'&&el.dataset.passed!=='true')show=false;
    else if(activeFilter==='fail'&&el.dataset.passed!=='false')show=false;
    if(activeWf&&el.dataset.wflabel!==activeWf)show=false;
    if(q&&!(el.dataset.name.toLowerCase().includes(q)||el.dataset.wflabel.toLowerCase().includes(q)))show=false;
    el.style.display=show?'':'none';
  }});
}}
</script>
</body></html>'''

    with open(out_path, "w") as fh:
        fh.write(html)
    print(f"Dashboard written: {out_path}")

if __name__ == "__main__":
    evals_dir = sys.argv[1] if len(sys.argv) > 1 else ".context/evals"
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(evals_dir, "eval-report.html")
    gen(evals_dir, out)
