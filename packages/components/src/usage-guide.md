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
- `lb.list({ load, pageSize, autoLoad })` — paginated rows. `.items/.page/.total/.loading/.loadPage(n)/.next()/.prev()/.hasMore/.subscribe`.

`.error` is `{ message, unavailable } | null`. `subscribe(cb)` fires immediately
then on every change — render your own DOM from it.

**Domain components** (pre-wired — bake in the tool name, arg shape, and footguns):

| Call | Returns | For |
|---|---|---|
| `lb.campaigns(ask)` | field | a campaign `<select>`, options from `leadbay_list_campaigns` |
| `lb.segmentCount({sectorIds, city, ask})` | `Promise<{total, applied, trusted}>` | how many Monitor leads match one sector/location — `count: 1` + `pagination.total`, so a segment costs one cheap call |
| `lb.portfolioSectors({sample, sectors, ask})` | `Promise<PortfolioSector[]>` | which sectors the user ACTUALLY holds — samples one page of followups, tallies `sector_id`, resolves names against an embedded taxonomy. A 200-lead sample is ~600 kB, so await it on demand, never on the boot path |
| `lb.outreach({leadId, ask, status?, note?})` | action | log a call → `report_outreach` (verification + `_triggered_by` baked in) |
| `lb.note({leadId, note})` | action | add a note → `add_note` |
| `lb.like(leadId)` / `lb.dislike(leadId)` | action | taste signal |
| `lb.leadStatus(current?)` | field | a status `<select>` (Wanted/Won/Lost/Unwanted) |
| `lb.setStatus({leadId or leadIds, status, date?, ask})` | action | write the org CRM status → `set_lead_status` |
| `lb.leadHistory(leadId, ask)` | resource (lazy) | notes + activities + engagement → `account_history` |
| `lb.leadProfile(leadId, ask)` | resource (lazy) | full lead profile → `research_lead_by_id` |
| `lb.sortOrder(current?)` | field | a sort `<select>` mirroring the app's TableSort |
| `lb.leadList({lensId?, order?, autoLoad?, ask})` | list | a sortable Discover batch → `pull_leads`; `autoLoad:false` for a tab the rep has not opened |
| `lb.callList({source:'followups'\|'campaign', campaignId?, city?, autoLoad?, ask})` | list | a cold-call list (Monitor or a campaign); `autoLoad:false` defers the read |
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

**Rendering helpers** — the only three things the library draws, and only
because hand-rolling them goes wrong the same way every time: an SVG whose
points escape the viewBox, a series that draws empty axes when it is empty, a
leaderboard whose digits do not line up. Each returns a DETACHED element you
place; none injects itself.

| Call | Returns | For |
|---|---|---|
| `lb.sparkline(points, {label, emptyTitle, emptyHint})` | `<svg class="lb-chart">` or an `lb-empty` block | a trend from `[{date, count}]`, themed so it reads in light and dark |
| `lb.tiles([{label, value}])` | `<div class="lb-tiles">` | headline figures — only the few that ARE the point |
| `lb.leaderboard({rows, columns, sortKey, sortDir, cell})` | a scroll-wrapped `lb-table` | a sortable table; `aria-sort` + keyboard headers, `num` columns tabular and end-aligned |

`sparkline` returns the empty block INSTEAD of a chart when the series is
empty — an empty window is a real answer, and empty axes read as broken.
`leaderboard` does the same for no rows. Sorting there is client-side by
design: a roll-up arrives whole, unlike a lead list the backend pages.

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
| `lb-sections` / `lb-section` / `lb-sec-title` | the card's section stack (16px between, 8px within) and a section's uppercase title |
| `lb-card-top` / `lb-lead-title` / `lb-card-foot` | header row (leading control · title · trailing controls), the bold underlined company name, and the footer's leading-action/spacer/trailing-link row |
| `lb-tags-plain` / `lb-tags-intent` / `lb-tags-empty` | firmographic tags (grey: what the company IS) and intent tags (teal: what the qualifier FOUND), plus the honest empty state for either |
| `lb-toolbar` / `lb-field` / `lb-field-label` / `lb-field-inline` | the bar above a deck: three groups (tally · narrow · act), and a labelled control whose caption stacks above it — `lb-field-inline` keeps a checkbox beside its words |
| `lb-tally` / `lb-status` / `lb-status-dot` | the row count (tabular, so it does not jitter as filters change) and a connection indicator whose live/dead states differ in SHAPE, not only colour |
| `lb-pager` / `lb-pager-range` | the pager below a deck — prev/next plus an honest "21–40 of 60" range; pair it with `data-lb-state="loading"` on the deck so a page flip dims the old rows instead of blanking them |
| `lb-tiles` / `lb-tile` / `lb-tile-label` / `lb-tile-value` | a row of figures for a dashboard's headline numbers — only for the few that ARE the point |
| `lb-chart` (+ `lb-chart-line` / `-area` / `-dot` / `-grid`) | an inline-SVG trend that takes its colours from the theme, so it reads in both; no CDN |
| `lb-empty` / `lb-empty-title` / `lb-empty-hint` | the honest empty state — what it means and the way out, in place of a blank chart or table |
| `lb-table th[aria-sort]` / `td[data-num]` | a sortable header (arrow + `aria-sort`) and a tabular numeric cell, so counts line up down a column |
| `lb-row` / `lb-stack` / `lb-spacer` | control row / vertical spacing / flex filler that right-aligns what follows |
| `lb-link-out` | quiet external link (icon inherits currentColor) — "Open in Leadbay" |
| `lb-select` / `lb-input` / `lb-btn` | form controls (state-aware, see below) |
| `lb-btn-submit` / `lb-btn-ai` / `lb-btn-lg` | the app's `primary` / `ai` variants, and its `large` size |
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

   Group the controls by what they act on, so the row does not read as a set of
   peers: wrap each axis in an `lb-group`. Status is NOT one of those axes — it
   saves on change and carries no button at all (see "Save on change is the
   default for status" below). Reserve `lb-btn-submit` for a write that really
   does need a second step, such as the bulk apply across checked rows.

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
   for one whose meaning comes from a neighbouring control. The status select
   sidesteps the question entirely by carrying no button at all — it saves on
   change — but the rule stands for any write whose meaning comes from the
   control beside it.

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

## Recipe: the pull-leads triage board (THE default board)

When the rep accepts an interactive board after ANY tool that returns a batch
of leads — `leadbay_pull_leads`, `leadbay_find_new_leads`,
`leadbay_pull_followups`, `leadbay_campaign_call_sheet` — build THIS. It is a
fixed recipe, not a starting point: the same board every time means a rep who
learned it once knows it everywhere. Deviate only when the rep asks for
something specific.

Build it from the data ALREADY IN HAND — never re-call the tool that produced
the batch just to populate the board.

Two things change with the source, and nothing else does:

- **The deep link's view.** `pull_leads` omits `in_monitor`/`in_discover`, so
  its leads are the Discover batch by definition; `pull_followups` carries
  `in_monitor: true` on every row, so a call board links to `monitor`; a
  campaign sheet needs `?campaign=<id>&lead=<id>`. See the leadUrl helper above.
- **Which write leads the card.** A discovery batch is triaged (taste + status);
  a follow-up list is worked (`lb.outreach`, gated on a note). Order the
  Outreach and Status sections to match, but ship both either way.

**Per card** — a header, then a stack of titled SECTIONS, then the write
feedback. The skin ships the whole geometry (`lb-sections` = 16px between
sections, `lb-section` = 8px within), so build the structure and add no
spacing CSS of your own:

```html
<article class="lb-card">
  <div class="lb-card-top">                   <!-- checkbox · title · taste -->
    <input type="checkbox" aria-label="Select Acme Corp for bulk apply">
    <div class="lb-lead-title"><a href="https://acme.com">Acme Corp</a></div>
    <span class="lb-group"><!-- like / dislike, lb-btn-icon --></span>
  </div>
  <div class="lb-chips" hidden><!-- data-taste + data-status, see contract --></div>

  <div class="lb-sections">
    <div class="lb-section">                    <!-- untitled: what it is -->
      <div class="lb-tags-plain"><span>Honfleur, Normandie</span><span>50–99</span></div>
      <div class="lb-sub">Why it fits, one sentence.</div>
    </div>
    <div class="lb-section"><div class="lb-sec-title">Fit</div>…</div>
    <div class="lb-section">
      <div class="lb-sec-title">Intent tags</div>
      <div class="lb-tags-intent"><span>Vente terrain</span>…</div>
      <!-- no tags? <div class="lb-tags-empty">None — the qualifier found no
           buying signal</div>, never an empty row -->
    </div>
    <div class="lb-section"><div class="lb-sec-title">Data</div>…</div>
    <div class="lb-section">
      <div class="lb-sec-title">Status</div>
      <select class="lb-select" aria-label="Lead status for Acme Corp"></select>
    </div>
    <div class="lb-section">
      <div class="lb-sec-title">Outreach</div>
      <div class="lb-stack">                  <!-- one control per line -->
        <select class="lb-select" aria-label="Outreach result for Acme Corp"></select>
        <input class="lb-input" aria-label="Outreach note for Acme Corp">
        <button class="lb-btn lb-btn-submit">Log outreach</button>
      </div>
    </div>
    <details class="lb-section"><!-- lazy full profile, see below --></details>
    <div class="lb-card-foot">
      <button class="lb-btn lb-btn-ai">Requalify</button>
      <span class="lb-spacer"></span>
      <a class="lb-link-out">Open in Leadbay</a>
    </div>
  </div>

  <div class="lb-msg" role="status" aria-live="polite"></div>
</article>
```

Wire them with `lb.like` / `lb.dislike`, `lb.leadStatus()` +
`lb.setStatus({leadId, status, ask})`, and `lb.outreach({leadId, ask, status,
note})` — the note field gated by a `validate` so an empty note cannot log.

Four rules the structure encodes, each of which a hand-built card gets wrong:

- **One section per titled block.** Two titles in one `lb-section` share its
  8px gap instead of the 16px between sections, so the second title reads as
  part of the first block. Fit and Intent tags are the pair this catches.
- **A section title sits at section level**, as a direct child. Nested inside a
  row (beside a verdict, say) it stops being a peer of the other titles and the
  card loses its scan order.
- **No date input.** Status saves on change and the backend stamps the date as
  "now"; a picker is only for backdating, which this board does not do.
- **Controls stack and span their section.** A select sizes to its longest
  option and a text input to a UA default, so side by side they come out
  different widths despite identical padding and height.

Only the bulk apply keeps a submit button, because it fans out across checked
rows and takes a `confirm`.

**Toolbar** — a tally, four filters (CRM status · taste · qualifier verdict ·
sector), select-all + one `lb.setStatus({leadIds})` bulk write, and
`lb.sortOrder()` bound to the list's `order`. Filters are CLIENT-side over the
loaded page; sort is SERVER-side, so changing it must `loadPage(0)` (see the
sorting rule above). The skin ships its geometry too:

```html
<div class="lb-toolbar">
  <span class="lb-tally">5 leads</span>

  <span class="lb-group">                       <!-- narrow: sort + filters -->
    <label class="lb-field">
      <span class="lb-field-label">Sort</span>
      <select class="lb-select" aria-label="Sort order"></select>
    </label>
    <label class="lb-field">
      <span class="lb-field-label">Status</span>
      <select class="lb-select" aria-label="Filter by CRM status"></select>
    </label>
    <!-- taste, verdict … -->
  </span>

  <span class="lb-spacer"></span>

  <span class="lb-group">                       <!-- act on the selection -->
    <label class="lb-field lb-field-inline">
      <input type="checkbox"><span class="lb-field-label">Select all</span>
    </label>
    <select class="lb-select" aria-label="Status for selected leads"></select>
    <button class="lb-btn lb-btn-submit">Apply to selected</button>
  </span>

  <span class="lb-status" data-live="yes">      <!-- shape, not just colour -->
    <span class="lb-status-dot"></span>live
  </span>

  <div class="lb-msg" role="status" aria-live="polite" style="flex:1 0 100%"></div>
</div>
```

Three groups, because the bar does three things — report, narrow, act. Flat, the
bulk commit reads as one more filter. Sort belongs in the narrow group but costs
a round trip the others do not, so mark that boundary (a divider, or its own
`lb-group`) rather than letting four selects look interchangeable.

**Pagination** — `lb.leadList` is already a paginated model: `.page`,
`.pageSize`, `.total`, `.hasMore`, `.next()`, `.prev()`, `.loadPage(n)`. A
board that renders only page 0 silently hides the rest of the lens, so render
the pager whenever `total` exceeds one page:

```html
<div class="lb-pager">
  <button class="lb-btn" data-k="prev">Previous</button>
  <button class="lb-btn" data-k="next">Next</button>
  <span class="lb-spacer"></span>
  <span class="lb-pager-range">21–40 of 60</span>
</div>
```

```js
const list = lb.leadList({ order: sort, ask: ASK, pageSize: 20 });
list.subscribe((l) => {
  deck.setAttribute("data-lb-state", l.loading ? "loading" : "ready");
  if (l.error) { renderError(l.error); return; }   // .code says what to do
  if (!l.loading) renderCards(l.items);            // keep old rows while loading
  const from = l.page * l.pageSize + 1;
  range.textContent = `${from}–${Math.min(from + l.items.length - 1, l.total)} of ${l.total}`;
  prev.disabled = l.page === 0 || l.loading;
  next.disabled = !l.hasMore || l.loading;
});
prev.onclick = () => list.prev();
next.onclick = () => list.next();
```

Four things this gets right that a hand-rolled pager usually does not:

- **A range, not a page number.** "21–40 of 60" says how much is left; "page 2"
  does not, and a rep cannot tell a short lens from a long one.
- **Disable at the ends, and while loading.** `hasMore` is
  `(page + 1) * pageSize < total`, so it is false on the last page even when
  that page is full — a Next that fetches nothing reads as a broken button.
- **Keep the old rows while the next page loads.** Blanking the deck loses the
  scroll position; `lb-deck[data-lb-state=loading]` dims and locks it instead.
  `loadPage` already drops a stale response if the rep flips pages quickly.
- **Selection and page are independent.** A checked lead on page 1 stays in the
  bulk set after a flip, so either carry the selection across pages or clear it
  on the flip — silently dropping it means a bulk apply writes fewer leads than
  the rep ticked. Say which you chose in the UI.

Changing the sort resets to page 0 (`loadPage(0)`), since the backend sorts the
whole lens and page 2 of the old order is not page 2 of the new one.

**Rich profile data is LAZY.** The card renders from the list payload alone. A
`lb.leadProfile(leadId, ask)` resource — sector label, `location.full`, real
`linkedin_page`, the qualification Q&A — loads only when the rep EXPANDS that
card, one call for one lead they chose to open:

```js
const profile = lb.leadProfile(lead.id, ASK);     // autoLoad:false
profile.subscribe((p) => renderDetail(els.detail, p));
els.expand.onclick = () => profile.load();        // one call, on demand
```

Never prefetch it for the batch: a 20-lead board would fire 20 requests to fill
lines the rep may never read. The list payload already carries everything the
collapsed card shows.

**One list loads on open — the one the rep is looking at.** The same rule, one
level up. A board with a tab per lens constructs one `lb.leadList` per lens, and
every list reads page 0 the moment it is constructed, so the board reads the
rep's whole book before they have clicked anything. Pass `autoLoad: false` to
every list but the visible one and load it on selection:

```js
const lists = lenses.map((l) =>
  lb.leadList({ lensId: l.id, ask: ASK, autoLoad: l.id === activeLensId }),
);
function openTab(i) {
  if (!lists[i].items.length) lists[i].loadPage(0);   // one read, the first time
  showTab(i);                                         // your own render
}
```

`lb.callList` takes `autoLoad` too. This is not a micro-optimisation: one real
board opened 21 lenses eagerly and spent 42 `pull_leads`, 2 MB and 32 seconds on
every open, for the one lens the rep then read. An artifact is re-rendered
whenever the agent republishes it, so that cost is paid again each time — nothing
is cached between renders. Load what is on screen.

**Requalify** is `leadbay_bulk_qualify_leads` with `leadIds` (camelCase — NOT
`lead_ids`) and `wait_for_completion: false`, so the button returns as soon as
the job is queued instead of holding through the poll. Give it
`class="lb-btn lb-btn-ai"` — purple is the product's AI affordance, and the
app's own QualifyButton is `variant="ai"`.

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

The org-wide CRM status, as a `<select>` that writes on change — no Apply
button. You write the markup; `lb.leadStatus` fills the options and holds the
value, `lb.setStatus` does the write.

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
    <select id="st" class="lb-select" aria-label="Lead status for Acme Corp"></select>
  </div>
  <span id="msg" class="lb-msg" role="status" aria-live="polite"></span>
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

const sel = document.getElementById("st");
lb.bindSelect(sel, status);                           // populates the 4 options
sel.addEventListener("change", () => save.run());     // change → write, no button

save.subscribe((a) => {                               // render your own feedback
  sel.setAttribute("data-lb-state",                   // the select IS the surface
    a.loading ? "loading" : a.error ? "error" : a.lastResult ? "success" : "ready");
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

## Recipe: segment coverage (sector / location)

"How many leads do we have in sector X" is one cheap call: the Monitor filter
plus `count: 1`, read off `pagination.total`. `lb.segmentCount` wraps it.

### Never hardcode the sector list

A board that offers sectors must offer the ones the user HOLDS. Typing a few
ids into the markup gets this wrong in both directions — one real portfolio's
hand-written list offered a sector holding 3 leads while omitting the
third-largest at 555.

There is no group-by on the Monitor, but every lead carries `sector_id`, so one
page of followups names the sectors that matter:

```js
// SECTORS is { id: label }, embedded at BUILD time from leadbay_list_sectors.
// The visible taxonomy is ~1,346 entries and does not change between runs, so
// fetching it per page load buys nothing.
const held = await lb.portfolioSectors({ sectors: SECTORS, ask: ASK });
for (const s of held) {
  const opt = document.createElement('option');
  opt.value = s.id;
  opt.textContent = s.label;   // falls back to `Sector <id>` when unresolved
  sel.appendChild(opt);
}
```

`sampled` is a SAMPLE count, for ordering the list. It is not the user's total
— call `lb.segmentCount` for the exact figure once a sector is picked.

**The taxonomy's `number_of_leads` is the WHOLE MARKET, not this user's book.**
Supermarchés reads 11,460 nationally against 3,656 in one real portfolio, and
Supérettes 5,710 against 143. Wiring a dropdown to that field ranks sectors the
user barely holds above ones they live in. Use it as a denominator if you are
explicitly showing market coverage, and label it as such — never present it as
the user's number.

```js
const supermarkets = await lb.segmentCount({ sectorIds: ["5134"], ask: ASK });
// → { total: 3656, applied: [...], trusted: true }
```

**Two traps, both observed against the live API — a hand-rolled version hits
both:**

1. **The filter is server-side and STATEFUL.** `set_filter` overwrites ONE
   stored FilterItem per user, so consecutive calls are not independent: the
   next one inherits what the last one stored. Always send the complete
   criteria set, never a delta, and never assume a fresh call starts clean.
2. **A rejected criterion fails SILENTLY.** Send a malformed criterion and the
   call returns **200 with the PREVIOUS filter still applied** — a plausible
   number answering a different question. `segmentCount` compares the echoed
   `active_filters` against what it sent and returns `trusted: false` on a
   mismatch. Never chart an untrusted count; say the segment could not be
   measured instead.

   The echo must match the request in BOTH directions. Every criterion asked
   for has to come back — a `city` / `cityId` as a `location_ids` criterion,
   since the composite resolves the free text through `/geo/search` into a type
   you never sent — and **nothing may come back that was not asked for**. The
   stored filter is cumulative, so narrowing a segment (sector+city → sector
   alone) leaves the dropped criterion in force: the count stays fenced to a
   city nobody asked about while every requested type is dutifully present. An
   unrequested criterion narrows a count exactly as a dropped one widens it.
   That rule also covers the unfiltered call on its own terms — with nothing
   wanted, "nothing extra" is "the echo is empty", which is what makes a
   whole-book denominator trustworthy.

   Sector VALUES are compared too, since a stale sector filter is still a sector
   filter. Locations are checked for presence only: the server picks the
   `admin_area_id` from free text, so the caller has nothing to compare against.

**What you cannot build this way.** A score histogram needs every lead's
`ai_agent_lead_score`, and there is no aggregation endpoint — bucketing 3,656
leads means 732 pages. Sample the tails instead (`order: "SCORE:ASC"` and
`"SCORE:DESC"`, a few hundred each) and **label the chart as a sample with its
n**, or do not draw it. The same applies to a density map: coordinates are on
every lead, but aggregating thousands of points client-side is a batch job, not
a dashboard. Both want a backend stats endpoint.

**Budget the calls.** A filtered count is normally 1–2 s, but adding a
`last_action_date` criterion was observed at **54 s** on a 3.6k segment. Fire
segments in sequence with a visible progress cue, not a parallel burst, and
never block the first paint on them.

## Recipe: manager dashboard

`lb.teamActivity` returns `{range, reps, trend}`. A manager reads before they
act, so the page is three bands in that order: the figures, the trend behind
them, then the per-rep table.

```html
<div class="lb-tiles">                          <!-- only figures that ARE the point -->
  <div class="lb-tile"><span class="lb-tile-label">Activities</span>
       <span class="lb-tile-value">0</span></div>
  <!-- meetings / notes / contacts added … -->
</div>

<svg class="lb-chart" viewBox="0 0 640 160" role="img"
     aria-label="Weekly activity, 24 Jun to 16 Sep">…</svg>

<table class="lb-table">
  <thead><tr>
    <th aria-sort="none">Rep</th>
    <th data-num aria-sort="descending">Activities</th>
    <th data-num aria-sort="none">Meetings</th>
  </tr></thead>
  <tbody><tr aria-selected="false">…</tr></tbody>
</table>
```

```js
const team = lb.teamActivity({ weeks: 4, ask: ASK });
team.subscribe((t) => {
  if (t.error) { renderError(t.error); return; }     // .code says what to do
  if (!t.data) return;                               // first load
  const { reps, trend, range } = t.data;
  const sum = (k) => reps.reduce((a, r) => a + (r[k] || 0), 0);

  stage.replaceChildren(
    lb.tiles([
      { label: "Activities", value: sum("total_activities") },
      { label: "Meetings",   value: sum("meetings_or_interest") },
      { label: "Notes",      value: sum("notes") },
    ]),
    lb.sparkline(trend, {                            // [] → the empty block
      label: `Activity from ${range.from} to ${range.to}`,
      emptyTitle: "No activity in this window",
      emptyHint: `Nothing logged between ${range.from} and ${range.to}. Widen the window.`,
    }),
    lb.leaderboard({
      rows: reps,
      sortKey: "total_activities",
      columns: [
        // reps[] carries email and nothing else — a mailto is the honest
        // affordance, since no MCP tool messages a rep.
        { key: "name", label: "Rep", cell: (r) => {
            const a = document.createElement("a");
            a.href = `mailto:${r.email}`; a.textContent = r.name || r.email;
            return a;
          } },
        { key: "total_activities",     label: "Activities", num: true },
        { key: "meetings_or_interest", label: "Meetings",   num: true },
        { key: "lost",                 label: "Lost",       num: true },
      ],
      emptyTitle: "No reps in this window",
      emptyHint: "The backend scopes non-admins to themselves.",
    }),
  );
});
refreshBtn.onclick = () => team.refresh();
```

Five things this gets right that a hand-built dashboard usually does not:

- **An empty window is a real answer.** A quiet team returns `total_activities:
  0` for every rep and `trend: []` — the common case on a new account. Draw
  `lb-empty` with what it means ("no activity logged in this window") and a way
  out (widen the range), never empty axes, which read as a broken chart.
- **Chart from the tokens, not a CDN.** `lb-chart` styles an inline SVG from
  the theme, so it reads in light and dark. A hardcoded stroke disappears in
  one of the two, and a CDN chart that fails to load shows nothing at all — a
  sparse weekly series does not earn the dependency.
- **Sorting is CLIENT-side here**, unlike a lead list: `reps` is the whole team
  in one response, so re-sorting reorders data you already hold. Reflect it in
  `aria-sort` on the header, not only with an arrow.
- **Tabular numerals on every count** (`data-num`), or the columns will not
  line up and the leaderboard cannot be scanned down.
- **Name the window.** `range.from`/`range.to` are resolved server-side and may
  not match what was asked for; printing them is what makes the figures
  auditable.

**Writing to a rep is not in this payload.** `reps[]` carries `user_id`, `name`
and `email` — enough to open a mail client with `mailto:`, and nothing more.
There is no MCP tool that messages a rep, so do not render a "message" button
that silently does nothing; a `mailto:` link is the honest affordance until
one exists.

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


## Runtime diagnostics (automatic — you do not wire this)

The runtime reports its own failures to the Leadbay team so a broken artifact
does not stay invisible: a picker that loads zero options, a button blocked by
validation, a call that timed out, failed, came back as an error envelope, or
answered with unparseable text. It sends these itself, over the same bridge,
deduped and capped — **you do not need to add anything**, and you should not
call `leadbay_artifact_event` yourself.

Only bounded values travel: the failure kind, which view-model surfaced it, the
tool name, an error code, and the kit version. Never a message, never user text,
never anything the user typed. A user who has turned telemetry off with
`leadbay_set_telemetry` sends nothing at all.

Two knobs, both optional. `lb.setTelemetry(false)` opts a page out entirely.
`lb.report({kind, surface, tool?, code?})` reports a failure the library cannot
see — a render that threw, or a control you wired by hand rather than through a
view-model. Everything else is automatic.

This is NOT the way to report a problem the USER raised. If the rep tells you
the artifact is wrong and asks you to pass it on, that is
`leadbay_report_friction`, which carries their own words and needs their
consent.
