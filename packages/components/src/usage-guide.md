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
| `lb.leadHistory(leadId, ask)` | resource (lazy) | notes + activities + engagement → `account_history` |
| `lb.leadProfile(leadId, ask)` | resource (lazy) | full lead profile → `research_lead_by_id` |
| `lb.callList({source:'followups'\|'campaign', campaignId?, city?, ask})` | list | a cold-call list (Monitor or a campaign) |
| `lb.enrichment({leadIds, titles, ask, pollEvery?})` | resource (polling) | launch + watch contact enrichment |
| `lb.teamActivity({weeks, ask})` | resource | manager leaderboard + activity trend → `leadbay_team_activity` |

`lb.EPILOGUE_STATUSES` = the 4 disposition values
(`STILL_CHASING`, `COULD_NOT_REACH_STILL_TRYING`, `INTEREST_VALIDATED_OR_MEETING_PLANED`, `NOT_INTERESTED_LOST`).

**Binding sugar** (optional; binds a view-model to YOUR native element, no style):
`lb.bindSelect(selectEl, field)` (populates options + value), `lb.bindValue(inputEl, field)`,
`lb.bindAction(buttonEl, action)`. They set `data-lb-state`
(`ready|loading|error|success|unavailable`) + `data-lb-error` on your element as
styling hooks. For lists/resources, use `.subscribe()` and render yourself.

`ask` is the user's request this artifact serves — it becomes `_triggered_by`.

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
one of `lb.EPILOGUE_STATUSES`. Snoozing (pushback) and org WON/LOST status are
advanced-gated — not callable from a default artifact; use the epilogue values.

## Degradation + live updates

If the host bridge is absent, a view-model's `.error` is set with `.error.unavailable
=== true` (bind helpers set `data-lb-state="unavailable"`) — nothing throws. Every
call also has a **30s timeout** (configurable via `lb.configure({ timeoutMs })`): a
host call that never settles becomes `.error` with `code:"timeout"`, so a control is
never stuck loading forever — always render the `.error` branch so the user can retry.
Auto-poll (`pollEvery`) depends on the cowork host serving FRESH reads; `.refresh()`
is the guaranteed manual path — always wire a Refresh control for polling resources.

