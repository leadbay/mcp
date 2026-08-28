# Leadbay Artifact Kit — headless domain components

You are building a single-file HTML **artifact** the user runs inside cowork. This
kit gives you **headless view-models** that own a control's whole data lifecycle —
load/populate from a Leadbay call, hold value/state, poll, validate, and
encapsulate the API call + business rules. **You own 100% of markup/layout/style.**
The library renders nothing. Inline the runtime once as a `<script>`; it exposes
one global `window.LeadbayArtifacts` (call it `lb`). Vanilla, no React, no build.

Pass every tool you use as the artifact's `mcp_tools` so the host permits it.

## Two layers

**Primitives** (generic):
- `lb.field({ load, options, value, validate, dependsOn })` — a value + optionally
  API-populated options. `.value/.setValue/.options/.loading/.error/.valid/.subscribe`.
- `lb.action({ tool, args, fields, confirm, onSuccess, onError })` — a write/submit.
  `.run()/.loading/.error/.lastResult/.subscribe`.
- `lb.resource({ load, pollEvery?, until?, autoLoad? })` — one read that may change:
  load-on-click or poll-until-`until`. `.data/.loading/.refreshing/.error/.done/.load()/.refresh()/.stop()/.subscribe`.
- `lb.list({ load, pageSize })` — paginated rows. `.items/.page/.total/.loading/.loadPage(n)/.next()/.prev()/.hasMore/.subscribe`.

`.error` is `{ message, unavailable } | null`. `subscribe(cb)` fires immediately
then on every change — render your own DOM from it.

**Domain components** (pre-wired — bake in the tool name, arg shape, and footguns):

| Call | Returns | For |
|---|---|---|
| `lb.campaigns(ask)` | field | a campaign `<select>`, options from `leadbay_list_campaigns` |
| `lb.outreach({leadId, ask, status?, note?})` | action | log a call → `report_outreach` (verification + `_triggered_by` baked in) |
| `lb.note({leadId, note})` | action | add a note → `add_note` |
| `lb.like(leadId)` / `lb.dislike(leadId)` | action | taste signal |
| `lb.leadStatus(current?)` | field | a status `<select>` (Wanted/Won/Lost/Unwanted) |
| `lb.setStatus({leadId or leadIds, status, date?, ask})` | action | write the org CRM status → `set_lead_status` |
| `lb.leadHistory(leadId, ask)` | resource (lazy) | notes + activities + engagement → `account_history` |
| `lb.leadProfile(leadId, ask)` | resource (lazy) | full lead profile → `research_lead_by_id` |
| `lb.callList({source:'followups'\|'campaign', campaignId?, city?, ask})` | list | a cold-call list (Monitor or a campaign) |
| `lb.enrichment({leadIds, titles, ask, pollEvery?})` | resource (polling) | launch + watch contact enrichment |
| `lb.teamActivity({weeks, ask})` | resource | manager leaderboard + activity trend → `leadbay_team_activity` |

`lb.EPILOGUE_STATUSES` = the 4 disposition values
(`STILL_CHASING`, `COULD_NOT_REACH_STILL_TRYING`, `INTEREST_VALIDATED_OR_MEETING_PLANED`, `NOT_INTERESTED_LOST`).
`lb.LEAD_STATUSES` = the 4 org CRM statuses as `{value,label}` (`WANTED`, `WON`, `LOST`, `UNWANTED`).

**Two different systems.** Epilogue = how one outreach attempt went (drives
follow-up ranking). Lead status = the commercial outcome, org-wide — the same
field the website's status selector writes. A won deal is a LEAD STATUS;
"she didn't pick up" is an EPILOGUE. Setting one never sets the other, so when
the user reports both in one breath, fire both actions.

**Binding sugar** (optional; binds a view-model to YOUR native element, no style):
`lb.bindSelect(selectEl, field)` (populates options + value), `lb.bindValue(inputEl, field)`,
`lb.bindAction(buttonEl, action)`. They set `data-lb-state`
(`ready|loading|error|success|unavailable`) + `data-lb-error` on your element as
styling hooks. For lists/resources, use `.subscribe()` and render yourself.

`ask` is the user's request this artifact serves — it becomes `_triggered_by`.

## The skin (optional) — `lb.styles()`

Call it once and you get a small `lb-*` stylesheet, so every artifact you build
shares one visual language instead of re-inventing padding and colours. It is
**opt-in**: skip it and you get exactly the unstyled HTML you wrote. It injects
no markup and never touches your `class` attributes.

```js
lb.styles();   // idempotent — safe to call per row
```

| Class | For |
|---|---|
| `lb-card` / `lb-card-head` / `lb-title` / `lb-sub` | a lead card + its header |
| `lb-row` / `lb-stack` | horizontal control row / vertical spacing |
| `lb-select` / `lb-input` / `lb-btn` | form controls (state-aware, see below) |
| `lb-msg` (`data-tone="error\|ok"`) | inline feedback |
| `lb-chip` (`data-status="WON\|LOST"`) | a status pill |
| `lb-table` | leads table |
| `lb-spinner` | inline busy indicator |

Controls react to the `data-lb-state` the bind helpers already set — a bound
`lb-btn` dims while loading, goes green on success, red on error, all with no
extra CSS from you.

The palette is the **product design system**, ported from
`frontend/packages/style/color.css` — same `--color-gray-1…9` ramp, same
semantic `--color-{green,red,blue,gold}-{background,foreground}` pairs, same
`1rem` / `0.625rem` radii and `corner-shape: squircle` as the app's components.
An artifact therefore looks like Leadbay, not like a generic page.

Use the tokens rather than hardcoded colours — the same rule the style package
enforces. Re-theme by overriding them; don't fight specificity:

```css
:root { --lb-surface: var(--color-gray-2); --lb-radius: 0.5rem; }
```

Dark mode works two ways: `data-theme="dark"` on `<html>` (the frontend's own
hook) **and** `prefers-color-scheme`, because an artifact renders inside a host
whose theme attribute it cannot set. Never hardcode a light background over the
skin.

The product face is `Nikkei Maru`; the stack names it first and falls back to
the system UI font. Do **not** add an `@font-face` — artifacts are inline-only
and a remote font URL will silently fail.

## What every lead card MUST carry

A card is the artifact form of the `pull_leads` table, and it inherits that
table's rules. A card with a name and a button is not enough: the rep cannot
tell *why* this lead is on screen. Four lines, in this order.

```html
<div class="lb-card">
  <div class="lb-card-head">
    <span class="lb-title"></span>              <!-- 1. company -->
    <span class="lb-chips">                     <!-- 2. state -->
      <span class="lb-chip" data-taste hidden></span>
      <span class="lb-chip" data-status hidden></span>
    </span>
  </div>
  <div class="lb-sub"></div>                    <!-- 3. firmographics -->
  <div class="lb-sub" data-why></div>           <!-- 4. why it fits -->
  <div class="lb-row"><!-- actions --></div>
</div>
```

1. **Company** — `name`, linked to `website` (prefix `https://` on a bare host).
   Never render the numeric `score`; use the `▰❖▱` bar if you want the signal.
2. **State chips** — taste (`data-taste`) and CRM status (`data-status`) are
   INDEPENDENT axes; render both, hide the empty one. Never collapse to one chip.
3. **Firmographics** — sector of activity first, then city, then size, then the
   contact. `sector_id` is a RAW ID (`"5136"`), not a label: resolve it via
   `leadbay_list_sectors` (1346 rows — fetch once, cache, never inline the lot)
   or omit it. Never print the raw id.
4. **Why it fits** — one sentence, ≤20 words. Walk this chain and stop at the
   first hit:

   1. `short_description`
   2. `description` (longer; only on `research_lead_by_id` /
      `research_lead_by_name_fuzzy` — the trim payloads omit it)
   3. top 2 `tags[].display_name`
   4. `qualification_summary.best_response_excerpt`, trimmed to one sentence
   5. `keywords`, first 3, joined with ` · `
   6. the resolved sector label — better than nothing, and if step 3 already
      printed the sector on the firmographics line, skip to step 7
   7. the literal *"No description yet — run qualification to generate one"*

   Never leave this line blank: a silent gap reads as a rendering bug, whereas
   the fallback tells the rep the data is missing and what fixes it.

   **The two list payloads are complementary, so the chain must span both.**
   `pull_leads` returns `short_description` on every lead but no `sector_id`;
   `pull_followups` returns `sector_id` but no `short_description` at all. A
   card fed by one will fall through to a different step than the same card fed
   by the other — that is expected, not a bug. Never call
   `research_lead_by_id` per row just to fill this line: it is one request per
   lead. Fetch it lazily when the rep expands a card.

**Never show** on a card: `id`, `sector_id`, `location.pos`, `location.country`
(unless city and state are both missing), `is_hq`, `*_in_progress`,
`highlighted_fields`, `custom_fields`, `stale_at`, `deal_insights`,
`need_attention*`, any count that is 0, any value that is the string `"null"`.

**Minimum actions.** A card that only displays is a table row that costs more —
if you are not wiring an action, render the markdown table instead. Wire at
least one write, and prefer the set the rep actually needs:

| Card is for | Wire |
|---|---|
| triage a discovery batch | `lb.like` / `lb.dislike` + `lb.setStatus` |
| working a call list | `lb.outreach` (gated on a note) + `lb.leadHistory` |
| pipeline review | `lb.setStatus` + `lb.note` |

Always render the `.error` branch of every view-model — a control that cannot
reach the host must say so, not sit silent.

## Recipe: cold-call sheet (one row per lead)

```js
const lb = window.LeadbayArtifacts; lb.configure();
const ASK = "<the user's request>";

const list = lb.callList({ source: "campaign", campaignId: CID, ask: ASK });
list.subscribe((l) => renderRows(l.items, l.loading));   // your render

// per lead row (call when you build a row):
function wireRow(lead, els) {
  const status = lb.field({ value: "STILL_CHASING" });   // static-enum <select>
  const note   = lb.field({ validate: (v) => (v && v.trim() ? null : "Add a note") });
  lb.bindValue(els.status, status);
  lb.bindValue(els.note, note);
  lb.bindAction(els.log,  lb.outreach({ leadId: lead.id, ask: ASK, status, note }));
  lb.bindAction(els.like, lb.like(lead.id));

  const history = lb.leadHistory(lead.id, ASK);          // lazy
  history.subscribe((h) => renderHistory(els.history, h));
  els.expand.onclick = () => history.load();             // load on click
}
```

## Recipe: lead-status dropdown (Wanted / Won / Lost)

The org-wide CRM status, as a `<select>` + Apply button. You write the markup;
`lb.leadStatus` fills the options and holds the value, `lb.setStatus` does the write.

```html
<div class="lb-card">
  <div class="lb-card-head">
    <span class="lb-title">Acme Corp</span>
    <span class="lb-chips">
      <span id="taste" class="lb-chip" data-taste="liked">Liked</span>
      <span id="crm"   class="lb-chip" data-status="WANTED">Wanted</span>
    </span>
  </div>
  <div class="lb-row">
    <select id="st" class="lb-select"></select>
    <button id="go" class="lb-btn">Apply</button>
    <span id="msg" class="lb-msg"></span>
  </div>
</div>
```

**Two badges, never one.** Taste (`liked`/`disliked`, from `lb.like`/`lb.dislike`)
and CRM status (`WANTED`/`WON`/`LOST`/`UNWANTED`, from `lb.setStatus`) are
independent axes — a lead can be liked *and* lost. Collapsing them into a single
chip destroys information: the rep can no longer see that a lead they liked went
nowhere. Render `data-taste` and `data-status` as separate chips inside
`lb-chips`, and hide the one that has no value rather than reusing it.

```js
lb.styles();                                          // once per artifact — see below

const status = lb.leadStatus(lead.org_lead_status);   // seed with the CURRENT value
const save   = lb.setStatus({ leadId: lead.id, status, ask: ASK });

lb.bindSelect(document.getElementById("st"), status); // populates the 4 options
lb.bindAction(document.getElementById("go"), save);   // click → write

save.subscribe((a) => {                               // render your own feedback
  msg.textContent = a.loading ? "Saving…"
    : a.error ? a.error.message                       // includes partial failures
    : a.lastResult ? `Set to ${a.lastResult.status}` : "";
  msg.dataset.tone = a.error ? "error" : a.lastResult ? "ok" : "";
});
```

Loading / success / error styling comes free: `bindAction` and `bindSelect` set
`data-lb-state` (`ready|loading|error|success|unavailable`) and the skin already
targets those attributes. No extra wiring.

Save-on-change instead of an Apply button — drop `bindAction` and run it yourself:

```js
document.getElementById("st").addEventListener("change", () => save.run());
```

**Bulk apply** across checked rows — pass `leadIds` and a `confirm`, since one
click rewrites a field every rep in the org sees:

```js
const bulk = lb.setStatus({
  leadIds: () => checkedIds,        // ← read at run() time, not at build time
  status, ask: ASK,
  confirm: "Set this status on every selected lead?",
});
```

`leadIds` is read when the action runs, so a live selection works — but pass the
array itself if your selection is fixed. A partial write (some leads rejected)
surfaces as `.error`, never as a green button: `setStatus` checks the `failed[]`
the tool returns.

The backend stamps the status date as "now" on every write, which is what a rep
clicking a dropdown means. Don't add a date picker unless the user asks to
backdate — then pass an optional `date` field holding `YYYY-MM-DD`:
`lb.setStatus({ leadId, status, date, ask })`.

## Recipe: manager dashboard

```js
const team = lb.teamActivity({ weeks: 4, ask: ASK });
team.subscribe((t) => {
  if (t.loading) showSpinner();
  if (t.data) {
    renderLeaderboard(t.data.reps);   // sorted by total_activities; cols: name, notes, meetings_or_interest, lost…
    renderTrendChart(t.data.trend);   // [{date,count}] → Chart.js (allowed from CDN)
  }
});
refreshBtn.onclick = () => team.refresh();
```

## Recipe: live enrichment

```js
const job = lb.enrichment({ leadIds: [LEAD], titles: ["CEO", "VP Sales"], ask: ASK });
job.subscribe((j) => {
  const p = j.data && j.data.overall_progress;            // {done,total,done_ratio}
  renderBar(p);
  if (j.done) renderContacts(j.data.leads);               // enriched contacts
});
refreshBtn.onclick = () => job.refresh();
```

## Write-call rules

The domain factories handle these for you. If you hand-roll an action:
`leadbay_report_outreach` args MUST include `verification:{source:"user_confirmed", ref}`
AND `_triggered_by`; `leadbay_add_leads_to_campaign` needs `_triggered_by`;
`add_note`/`like_lead`/`dislike_lead` take only their own args. `epilogue_status` is
one of `lb.EPILOGUE_STATUSES`. Snoozing (pushback) is advanced-gated — not
callable from a default artifact. Org lead status IS on the default surface:
use `lb.setStatus`, which owns the arg shape AND the partial-write check —
`leadbay_set_lead_status` writes each lead separately, so it can resolve 200
with a non-empty `failed[]`. Hand-rolling that action will report a green
button over a write that never landed.

## Degradation + live updates

If the host bridge is absent, a view-model's `.error` is set with `.error.unavailable
=== true` (bind helpers set `data-lb-state="unavailable"`) — nothing throws. Every
call also has a **30s timeout** (configurable via `lb.configure({ timeoutMs })`): a
host call that never settles becomes `.error` with `code:"timeout"`, so a control is
never stuck loading forever — always render the `.error` branch so the user can retry.
Auto-poll (`pollEvery`) depends on the cowork host serving FRESH reads; `.refresh()`
is the guaranteed manual path — always wire a Refresh control for polling resources.

