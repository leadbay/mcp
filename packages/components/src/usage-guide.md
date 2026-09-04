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
| `lb.sortOrder(current?)` | field | a sort `<select>` mirroring the app's TableSort |
| `lb.leadList({lensId?, order?, ask})` | list | a sortable Discover batch → `pull_leads` |
| `lb.callList({source:'followups'\|'campaign', campaignId?, city?, ask})` | list | a cold-call list (Monitor or a campaign) |
| `lb.enrichment({leadIds, titles, ask, pollEvery?})` | resource (polling) | launch + watch contact enrichment |
| `lb.teamActivity({weeks, ask})` | resource | manager leaderboard + activity trend → `leadbay_team_activity` |

`lb.EPILOGUE_STATUSES` = the 4 disposition values
(`STILL_CHASING`, `COULD_NOT_REACH_STILL_TRYING`, `INTEREST_VALIDATED_OR_MEETING_PLANED`, `NOT_INTERESTED_LOST`).
`lb.LEAD_STATUSES` = the 4 org CRM statuses as `{value,label}` (`WANTED`, `WON`, `LOST`, `UNWANTED`).
`lb.SORT_ORDERS` = the sort options as `{value,label}`; values are the backend `FIELD:ASC|DESC` enum.

**Sorting is a SERVER concern.** `lb.leadList` and `lb.callList` take an `order`
(a `lb.sortOrder()` field or a literal) and send it upstream; the backend sorts
the whole lens / Monitor and returns the requested page of that. Never re-sort
rows in the browser — you would be reordering one page of a larger set, showing
leads that do not belong at that position. The empty value means "no order
param", i.e. the tab's own ranking, which is the right default. Changing the
sort should reset to page 0. Campaign call sheets cannot sort:
`leadbay_campaign_call_sheet` has no `order` param, and `lb.callList` drops it
for that source rather than sending something the tool would reject.

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
| `lb-row` / `lb-stack` / `lb-spacer` | control row / vertical spacing / flex filler that right-aligns what follows |
| `lb-link-out` | quiet external link (icon inherits currentColor) — "Open in Leadbay" |
| `lb-select` / `lb-input` / `lb-btn` | form controls (state-aware, see below) |
| `lb-msg` (`data-tone="error\|ok"`) | inline feedback |
| `lb-chip` (`data-status="WON\|LOST"`) | a status pill |
| `lb-table` | leads table |
| `lb-spinner` | inline busy indicator — decorative, mark it `aria-hidden` |
| `lb-vh` | visually-hidden text — labels heard but not seen |

Controls react to the `data-lb-state` the bind helpers already set — a bound
`lb-btn` dims while loading, goes green on success, red on error, all with no
extra CSS from you.

The palette is the **product design system**, ported from
`frontend/packages/style/color.css` — same `--color-gray-1…9` ramp, same
semantic `--color-{green,red,blue,gold}-{background,foreground}` pairs, same
`1.5rem` / `0.625rem` radii (concentric: outer = inner + padding) and
`corner-shape: squircle`, matching the app's components.
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
tell *why* this lead is on screen. Five lines, in this order.

```html
<div class="lb-card">
  <div class="lb-card-head">
    <span class="lb-title"></span>              <!-- 1. company -->
    <span class="lb-chips">                     <!-- 2. state -->
      <span class="lb-chip" data-taste hidden></span>
      <span class="lb-chip" data-status hidden></span>
    </span>
  </div>
  <div class="lb-facts">                        <!-- one group, tight 4px gap -->
    <div class="lb-sub"></div>                  <!-- 3. firmographics -->
    <div class="lb-sub" data-who></div>         <!-- 4. the person -->
    <div class="lb-sub" data-how></div>         <!-- 5. company channels -->
  </div>
  <div class="lb-sub" data-why></div>           <!-- 6. why it fits -->
  <div class="lb-row"><!-- actions --></div>
  <div class="lb-msg" role="status" aria-live="polite"></div>
</div>
```

1. **Company** — `name`, linked to `website` (prefix `https://` on a bare host).
   Never render the numeric `score`; use the `▰❖▱` bar if you want the signal.

   Keep `.lb-msg` OUT of `.lb-row`. The result of a write — "Could not reach the
   host" — is the most important thing on the card at that moment; parked between
   two buttons it reads as a control, and as a wide flex item it forces the
   trailing link onto a line of its own. Give it its own row after the actions.

   Also give every card an **Open in Leadbay** link to the lead's panel in the
   product. Put it at the **trailing end of the card's last action row** —
   same row as the buttons, pushed right by an `lb-spacer`, not on a line of
   its own. Style it `lb-link-out`: quiet text plus a plain arrow-up-right,
   never a filled button. It is an escape hatch, not a call to action.

   Group the controls by what they act on. A flat row of five buttons reads as
   five peers; the rep cannot see that "Set status" commits the select beside it
   while Like/Dislike are independent toggles. Wrap each axis in an `lb-group`
   and mark the commit with `lb-btn-submit`.

   Taste is the one pair worth reducing to icons: thumbs up/down are unambiguous,
   they repeat on every card, and dropping the words buys the width a narrow chat
   host needs. Use `lb-btn-icon` — and note the three attributes it REQUIRES,
   because with no text the glyph is the whole affordance:

   - `aria-label` naming the lead ("Like Acme Corp"), since the control repeats
     N times down the list;
   - `title` so a sighted user who does not know the glyph gets a tooltip;
   - `aria-pressed` reflecting the current taste — a toggle must say whether it
     is on, and `[aria-pressed=true]` is what the skin styles.

   Do **not** reduce "Set status" to an icon: no glyph says "commit the value in
   the select beside me". Icons work for a fixed, well-known action; they fail
   for one whose meaning comes from a neighbouring control.

   ```html
   <div class="lb-row">
     <span class="lb-group">                  <!-- taste: two toggles -->
       <button class="lb-btn lb-btn-icon" aria-label="Like Acme Corp"
               title="Like" aria-pressed="false">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
           <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
         </svg>
       </button>
       <button class="lb-btn lb-btn-icon" data-taste="disliked"
               aria-label="Dislike Acme Corp" title="Dislike" aria-pressed="false">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
           <path d="M17 14V2"/>
           <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/>
         </svg>
       </button>
     </span>
     <select class="lb-select" aria-label="Lead status for Acme Corp"></select>
     <span class="lb-spacer"></span>          <!-- pushes the link to the end -->
     <a class="lb-link-out" data-k="open" target="_blank" rel="noopener">
       Open in Leadbay
       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
         <line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>
       </svg>
     </a>
   </div>
   ```

   Keep the arrow a bare diagonal stroke — the text already says where the link
   goes, so the glyph only has to mark "leaves this page". Mark the `<svg>`
   `aria-hidden="true"`: it is decorative, and the link text is the accessible
   name.
   **Pick the view the lead actually lives in** — the URL is
   `/app/<view>?lead=<uuid>`, and the three views are `discover`, `monitor`,
   `campaign`. Landing a Monitor lead on Discover drops the rep into a list
   that does not contain it:

   ```js
   function leadUrl(lead, campaignId) {
     const id = encodeURIComponent(lead.id);
     // A campaign card carries TWO params — the campaign selects the list, the
     // lead opens the panel inside it. Campaign wins even when in_monitor is
     // also true, because that is the list the rep is looking at.
     if (campaignId) {
       return `https://leadbay.app/app/campaign?campaign=${encodeURIComponent(campaignId)}&lead=${id}`;
     }
     const view = lead.in_monitor ? "monitor" : "discover";
     return `https://leadbay.app/app/${view}?lead=${id}`;
   }
   openEl.href = leadUrl(lead, campaignId);
   ```

   `in_monitor` / `in_discover` are booleans on the `pull_followups` payload —
   every follow-up carries `in_monitor: true`, so a call sheet must link to
   `monitor`. `pull_leads` omits both flags entirely; its leads are the Discover
   batch by definition, so `discover` is the default. A campaign card
   (`lb.callList({source:"campaign", campaignId})`) needs `?campaign=<id>&lead=<id>`
   — the param names are `CAMPAIGN_QUERY_PARAM` and `LEAD_QUERY_PARAM`, and the
   app's own `useLeadPanel` preserves whatever params are already set, so the
   two coexist by design. Omitting `campaign=` opens an empty campaign view.

   Inline the glyph as SVG rather than an emoji or `↗` — it inherits
   `currentColor` and scales with the text, so it stays legible in both themes.
   `?lead=<uuid>` is the real deep-link (`LEAD_QUERY_PARAM` in the web app, read
   on load; the panel is an overlay, so the view choice only decides what sits
   behind it). This is the ONE place a card may use `lead.id`: as a link target,
   never as visible text.
2. **State chips** — taste (`data-taste`) and CRM status (`data-status`) are
   INDEPENDENT axes; render both, hide the empty one. Never collapse to one chip.
3. **Firmographics** — sector of activity first, then city, then size, then the
   contact. `sector_id` is a RAW ID (`"5136"`), not a label: resolve it via
   `leadbay_list_sectors` (1346 rows — fetch once, cache, never inline the lot)
   or omit it. Never print the raw id.

   **Always show whether the lead is reachable — and never merge the person
   with the company's switchboard.** These are two separate lines:

   ```js
   // WHO — recommended_contact. Name, and job_title ONLY when present; on list
   // payloads it is usually null, and inventing one is worse than omitting it.
   const rc = lead.recommended_contact;
   const who = rc ? [rc.first_name, rc.last_name].filter(Boolean).join(" ") : null;
   const whoLine = who ? who + (rc.job_title ? " · " + rc.job_title : "") : "No contact yet — enrich to find one";

   // HOW — company-level channels. `phone_numbers` and `email` belong to the
   // COMPANY, not to `recommended_contact`. Rendering "Jean · ☎ 0123…" claims a
   // direct line that does not exist; it is the switchboard.
   // The API returns the literal STRING "null" for a missing value — in
   // phone_numbers as well as email (a real lead ships phone_numbers:["null"]).
   // Guard BOTH or the card prints "☎ null" as if it were a number.
   const real = (v) => (v && v !== "null" ? v : null);
   const phone = real((lead.phone_numbers || [])[0]);
   const email = real(lead.email);
   const howLine = [phone && "☎ " + phone, email && "✉ " + email].filter(Boolean)
     .join(" · ") || "No phone or email — enrich to look for them";
   ```

   ```html
   <div class="lb-sub">Sector · City · Size</div>
   <div class="lb-sub"><span aria-hidden="true">👤</span> Jean-François Froemer · Gérant</div>
   <div class="lb-sub"><span class="lb-vh">Company switchboard: </span><span aria-hidden="true">🏢 ☎</span> 01 23 45 67 89 (company line)</div>
   ```

   Label the channel line as the **company's**, so a rep reading fast cannot
   mistake it for a direct line. A per-contact email or phone exists only after
   enrichment — `research_lead_by_id` exposes it as `contacts.reachable[]`, and
   `_meta.has_reachable_contact` is the authoritative flag. The list payloads
   carry neither, so a card built from `pull_leads` / `pull_followups` can only
   ever show company channels. Say "enrich to reveal" rather than implying the
   contact is callable.

   Two things that look like reachability and are not: a `linkedin_page` alone
   (the rep cannot message a URL without leaving the artifact — same rule
   `research_lead_by_id` applies), and `contacts_count > 0` (it counts known
   people, not people you can contact; a lead can show 2518 contacts and zero
   channels). `pull_followups` carries `has_phone` as a ready-made boolean;
   `pull_leads` omits it, so derive from `phone_numbers` there.
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
   7. the literal *"No description yet — qualify to add one"* ("qualify" is the
      product's own verb; "run qualification to generate one" is a nominalisation)

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

   **Accessibility is the markup's job, not the skin's.** `data-lb-state` is a
   STYLING hook; it sets no ARIA. A card renders N times in a list, so every
   repeated control needs a name that says *which* lead it acts on:

   ```html
   <select class="lb-select" aria-label="Lead status for Acme Corp"></select>
   <button class="lb-btn" aria-label="Like Acme Corp">Like</button>
   <a class="lb-link-out" aria-label="Open Acme Corp in Leadbay" …>
   <span class="lb-msg" role="status" aria-live="polite"></span>
   ```

   Without the `role="status"` node the rep hears nothing when a write fails —
   `bindAction` puts the message in a `data-lb-error` attribute that nothing
   renders. Mark the `▰❖▱` bar `aria-hidden="true"` and follow it with
   `<span class="lb-vh">Fit: strong</span>`; the glyphs otherwise read aloud as
   "black parallelogram black parallelogram…" before the company name. Use
   `lb-vh` for any label that should be heard but not seen.

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

**Save on change is the default for status.** The rep picks a value and it
writes — one interaction, no second button, matching the web app's own status
selector. Drop `bindAction` and run the action from the change event:

```js
const sel = document.getElementById("st");
sel.addEventListener("change", () => save.run());
save.subscribe((a) => {                       // the select IS the feedback surface
  sel.setAttribute("data-lb-state",
    a.loading ? "loading" : a.error ? "error" : a.lastResult ? "success" : "ready");
  msg.textContent = a.loading ? "Saving…" : a.error ? a.error.message
    : a.lastResult ? "Saved" : "";
  msg.dataset.tone = a.error ? "error" : a.lastResult ? "ok" : "";
});
```

Without a submit button the select becomes the only affordance, so it MUST show
the write: mirror `data-lb-state` onto it (the skin already styles loading /
success / error on `.lb-select`) and put the outcome in the `role="status"`
line. A silent select leaves the rep unsure whether anything happened.

Keep a submit button ONLY where a mis-click is expensive and the value is not
self-evident — a bulk apply across checked rows, for instance, which already
takes a `confirm`. For one lead, the extra step buys nothing: the value is
visible in the select, and the rep can simply pick again.

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

