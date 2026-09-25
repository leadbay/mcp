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
| `lb.segmentCount({sectorIds, city, ask})` | `Promise<{total, applied, trusted}>` | how many Monitor leads match one sector/location — `count: 1` + `pagination.total`, so a segment costs one cheap call |
| `lb.portfolioSectors({sample, sectors, ask})` | `Promise<PortfolioSector[]>` | which sectors the user ACTUALLY holds — samples one page of followups, tallies `sector_id`, resolves names against an embedded taxonomy |
| `lb.coverage({buckets, ask, onProgress?})` | `Promise<CoverageRow[]>` | sweep a WHOLE dimension (sector, size, recency, liked, custom field) — sequential, complete criteria per call, `trusted` per bucket |
| `lb.coverageBuckets({field, labels?, criterion?, limit?, ask})` | `Promise<CoverageBucket[]>` | derive a dimension's values from the book by tallying a lead field — never hardcode the list |
| `lb.coverageTotal({ask, personal?})` | `Promise<CoverageRow>` | the unfiltered whole-book denominator |
| `lb.reachCoverage({sample?, personal?, ask})` | `Promise<ReachCoverage>` | callable / contacts-only / empty — the segment that says what to ENRICH. Sampled (not a filter), so rows are an estimate against `bookTotal` |
| `lb.leadReach(lead)` | `"reachable"` \| `"contacts_only"` \| `"empty"` | one lead's reachability — `contacts_count > 0` is NOT a channel |
| `lb.outreach({leadId, ask, status?, note?})` | action | log a call → `report_outreach` (verification + `_triggered_by` baked in). **NOT from a page's button** — it waits 60s on a confirmation prompt a page cannot show; see *Writing from a page* below |
| `lb.note({leadId, note})` | action | add a note → `add_note` |
| `lb.like(leadId)` / `lb.dislike(leadId)` | action | taste signal |
| `lb.qualify({leadId or leadIds, ask, scored?})` | action | the MANDATORY Qualify/Requalify button → `bulk_qualify_leads` (camelCase `leadIds`, queue-not-wait, `failed[]` + quota checked) |
| `lb.qualifyLabel(lead)` | `"Qualify"` \| `"Requalify"` | which word the button takes, from the lead's own score |
| `lb.qualifyStatus(launch, ask?)` | resource (polling) | watches a launch to its verdict → `leadbay_qualify_status` |
| `lb.relanceRow({leadId, ask, currentStatus?})` | row bundle | ONE follow-up table row: lazy `contacts` (with email/phone), `status` + `saveStatus`, `epilogue` + `note` + `logOutreach` |
| `lb.enrichContact({leadId, contactId, email?, phone?, ask?, onDone?})` | action | buy ONE contact's email / phone / both → `enrich_contacts`. Confirms the spend; the channel may land on a DIFFERENT contact, so `onDone` re-reads |
| `lb.sectorLabels()` | `Promise<{id: label}>` | the sector taxonomy, fetched ONCE per page and cached — so no artifact inlines ~1,091 rows or prints a raw id |
| `lb.leadContext(lead, labels)` | `LeadContext` | one lead's company line: `summary` (short_description → description → sector), `sector`, and the COMPANY `phone` / `email` |
| `lb.EPILOGUE_LABELS` | `Record<string,string>` | the four epilogue values in the rep's words, for the select |
| `lb.leadStatus(current?)` | field | a status `<select>` (Wanted/Won/Lost/Unwanted) |
| `lb.setStatus({leadId or leadIds, status, date?, ask})` | action | write the org CRM status → `set_lead_status` |
| `lb.leadHistory(leadId, ask)` | resource (lazy) | notes + activities + engagement → `account_history` |
| `lb.leadProfile(leadId, ask)` | resource (lazy) | full lead profile → `research_lead_by_id` |
| `lb.sortOrder(current?)` | field | a sort `<select>` mirroring the app's TableSort |
| `lb.leadList({lensId?, order?, ask})` | list | a sortable Discover batch → `pull_leads` |
| `lb.callList({source:'followups'\|'campaign', campaignId?, city?, ask})` | list | a cold-call list (Monitor or a campaign) |
| `lb.leadSource({kind, campaignId?, lensId?, order?, ask})` | list + `.leadUrl(lead)` | ONE list over any source — Monitor / Discover lens / campaign — with the per-source deep link and the campaign's no-sort rule built in |
| `lb.leadPos(lead)` | `[lat,lng]` \| `null` | a lead's coordinates, rejecting the `0,0` sentinel and out-of-range values |
| `lb.distanceKm(a, b)` | number | great-circle km — never use flat geometry, it mis-orders east-west legs |
| `lb.orderByProximity(stops, start?)` | stops | nearest-neighbour ordering, so the default route is not the API's arbitrary one |
| `lb.routeUrl(stops)` | `{url, used, truncated}` \| `null` | a Google Maps driving link; `truncated` counts the stops past its 11-stop cap |
| `lb.routeDistanceKm(stops)` | number | total straight-line km in driving order — label it "as the crow flies" |
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

### Writing from a page: a note, and the prospecting actions

Every board that lets a rep record what happened — call sheet, lead desk,
triage card, route planner — writes the way the web app does, through two
calls, and never through `lb.outreach`:

```js
// The note: the web app's note field.
lb.bindAction(els.log, lb.note({ leadId: lead.id, note }));   // note = an lb.field gated on non-empty

// The four prospecting actions: toggles over TODAY's list, as in the web app.
const today = (lead) => new Set((lead.epilogue_today_statuses ?? []).map((e) => e.type.replace(/^EPILOGUE_/, "")));
async function toggle(lead, value) {                          // value = one of lb.EPILOGUE_STATUSES
  const selected = !today(lead).has(value);
  await lb.call("leadbay_set_prospecting_action", { lead_id: lead.id, action: value, selected, _triggered_by: ASK });
}
```

- **Why not `lb.outreach`.** It goes to `report_outreach`, which asks a human
  to type a confirmation for every `user_confirmed` call. A page has nowhere to
  show that prompt: the button waited 60 seconds, the write landed anyway, and
  the page said Leadbay "took too long". Reps retried and logged one visit
  twice. The prompt cannot be skipped for pages — the server cannot tell a
  page from an agent that claims to be one — so a page takes the path that
  never asks. `lb.outreach` stays the AGENT's tool for an outreach the user
  tells it about.
- **The actions are toggles, several on at once.** The web app's Prospection
  cell is a multi-select over `epilogue_today_statuses`; each tap turns one on
  or off. Read "selected" from that list, **never from `epilogue_status`**:
  unticking removes the type from today's list and leaves `epilogue_status`
  where it was, so a board that pre-selects from it brings a removed action
  back. `epilogue_status` is only the last value ever set — show it as a
  "Last: Still chasing · 24 Sep" line when nothing is on today. The field is
  absent on a lead nobody has worked: an empty set, not an error.
- **Buttons, in the web app's colours.** Four `role="checkbox"` buttons with
  `aria-checked` (a select costs a rep two taps): Still chasing blue, Meeting
  planned green, Could not reach yellow, Not interested red — the
  `--color-<hue>-background` / `-foreground` pairs, all four in the skin. The
  foreground goes on a dot and the selected border, never on the label:
  yellow's is too light to read as text, and the web app uses it for icons.
- **One control per axis.** The toggles own the prospecting action; the note
  form owns the note and offers no action of its own. Two controls writing one
  field race each other, and the later write silently wins.

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
| working a call list | `lb.note` (gated on a note) + the prospecting toggles + `lb.leadHistory` — see *Writing from a page* |
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

**The board pins the light theme.** Set it before `lb.styles()`, as the first
thing the artifact does:

```js
document.documentElement.setAttribute("data-lb-theme", "light");
lb.styles();
```

Every dark rule in the skin is guarded by `:not([data-lb-theme=light])`, so the
one attribute disables all of them — no token overrides, no specificity fight,
and `lb.styles()` still declares `color-scheme:light` so native select popups
follow. A rep works a board beside the product's own light UI and reads the
cards as the same surface; a board that flips with the HOST's theme puts a dark
card next to a light app for the same lead. This is the board's default, not
the skin's: `lb.styles()` keeps honouring `prefers-color-scheme` everywhere
else, and an artifact that WANTS the host theme simply omits the attribute.

Two things change with the source, and nothing else does:

- **The deep link's view.** `pull_leads` omits `in_monitor`/`in_discover`, so
  its leads are the Discover batch by definition; `pull_followups` carries
  `in_monitor: true` on every row, so a call board links to `monitor`; a
  campaign sheet needs `?campaign=<id>&lead=<id>`. See the leadUrl helper above.
- **Which write leads the card.** A discovery batch is triaged (taste + status);
  a follow-up list is worked (`lb.note` + the prospecting toggles). Order the
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
      <button class="lb-btn lb-btn-ai" data-k="qualify">Requalify</button>
      <!-- MANDATORY. Text from lb.qualifyLabel(lead): "Qualify" when the lead
           has no AI score yet, "Requalify" when it has one to replace. -->
      <span class="lb-spacer"></span>
      <a class="lb-link-out">Open in Leadbay</a>
    </div>
  </div>

  <div class="lb-msg" role="status" aria-live="polite"></div>
</article>
```

Wire them with `lb.like` / `lb.dislike`, `lb.leadStatus()` +
`lb.setStatus({leadId, status, ask})`, `lb.note({leadId, note})` — the note
field gated by a `validate` so an empty note cannot log — and the four
prospecting toggles from *Writing from a page*,
plus `lb.qualify` in `lb-card-foot` — the Qualify/Requalify button every card
MUST carry, labelled by `lb.qualifyLabel(lead)`.

Five rules the structure encodes, each of which a hand-built card gets wrong:

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
- **Every card ships Qualify/Requalify.** Mandatory, and not conditional on
  the lead looking under-qualified: the rep reads "why it fits" and the intent
  tags, decides the qualifier got this one wrong, and re-runs it — a card that
  omits the button makes the verdict look final. It is also the one control
  that ACTS on the line the rep is doubting, which is why it sits in
  `lb-card-foot` next to Open in Leadbay rather than among the taste and
  status writes. Wire it with `lb.qualify` and label it with
  `lb.qualifyLabel(lead)`; both are below.

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

**Use `lb.qualify` — never hand-roll this action.** It is MANDATORY on every
lead card, on every board, in every recipe. A card that renders a lead and no
qualify control is incomplete: the rep can read the qualifier's verdict but
cannot contest it without leaving the artifact.

```js
const q = lb.qualify({ leadId: lead.id, ask: ASK, scored: lb.qualifyLabel(lead) === "Requalify" });
els.qualify.textContent = lb.qualifyLabel(lead);     // "Qualify" or "Requalify"
lb.bindAction(els.qualify, q);
q.subscribe((a) => {
  // QUEUED, not finished. Say so and leave the old tags alone — a card that
  // repaints as though a verdict arrived is lying about work that has not run.
  els.msg.textContent = a.loading ? "Queueing…"
    : a.error ? a.error.message
    : a.lastResult ? "Qualifying — the verdict lands shortly." : "";
  els.msg.dataset.tone = a.error ? "error" : a.lastResult ? "ok" : "";
  if (a.lastResult) watch(a.lastResult);             // optional, see below
});
```

**Which word the button takes is not a style choice.** `lb.qualifyLabel(lead)`
reads the lead's own data: a lead with an `ai_agent_lead_score`, or a
`qualification_summary.answered > 0`, has a verdict to replace and gets
**Requalify**; one without has never been run and gets **Qualify**. Labelling
an unscored lead "Requalify" implies a previous run that never happened, and
the rep reads the empty tag row as a failure of the button they just pressed.

**To show the verdict actually landing**, hand the launch result to
`lb.qualifyStatus` — otherwise the card can only ever say "queued":

```js
function watch(launch) {
  const job = lb.qualifyStatus(launch, ASK);          // polls every 15s
  job.subscribe((j) => {
    if (j.error) { els.msg.textContent = j.error.message; return; }
    if (j.done) profile.load();                       // re-read the new tags
  });
}
```

Declare BOTH tools in the artifact's `mcp_tools`:
`leadbay_bulk_qualify_leads` and `leadbay_qualify_status`.

Give the button `class="lb-btn lb-btn-ai"` — purple is the product's AI
affordance, and the app's own QualifyButton is `variant="ai"`.

## Recipe: the ROUTE PLANNER (leads on a map, worked in person)

When the rep is going somewhere — "I'm in Lyon Thursday", "plan my tournée",
"who can I see on the way" — build THIS rather than the desk. Same writes,
different question: not *who do I call* but *what order do I drive*.

**Half map, half panel.** The map is the left half and the lead list the
right; clicking a marker opens that lead in the panel with its actions. A
map alone cannot be worked and a list alone is not a route.

Use the kit's geo helpers — do NOT hand-roll them. `lb.leadPos`,
`lb.distanceKm`, `lb.orderByProximity`, `lb.routeUrl` and
`lb.routeDistanceKm` each encode one of the five rules below, and a page that
reimplements them locally gets no benefit when a rule is fixed in the kit.
They landed after kit 0.6.0, so a page pinned to an older runtime has to be
moved forward rather than given private copies.

```js
const stops = leads.map((l) => ({ lead: l, pos: lb.leadPos(l) })).filter((s) => s.pos);
const ordered = lb.orderByProximity(stops);          // nearest-neighbour default
const link = lb.routeUrl(ordered);                   // null when nothing is placeable
if (link?.truncated) note(`${link.truncated} stops past Google's limit are not in this link`);
```

Five rules, each one something a hand-built map gets wrong:

- **Ungeocoded leads are NORMAL — list them, never drop them.** An imported
  book is mostly without coordinates. `lb.leadPos` returns null for those,
  and they belong in the panel under a "no location" heading. A map that
  silently shows 12 of 40 leads tells the rep their book is small.
- **`0,0` is not a lead.** It is the API's missing-position sentinel, in the
  Gulf of Guinea. `lb.leadPos` rejects it; a raw `location.pos` read does not.
- **Distance is `lb.distanceKm`, never Pythagoras.** At French latitudes a
  degree of longitude is ~73km against ~111km for latitude, so flat maths
  overstates east-west legs by half and mis-orders the day.
- **Google Maps drops stops past 11.** `lb.routeUrl` reports `truncated`;
  say the number, because the alternative is a rep driving a route whose last
  calls silently vanished.
- **The pin must carry the state.** Colour it by CRM status and ring the ones
  already worked today, so a glance at the map answers "where have I been".
  Status changes from the panel repaint the pin immediately — that feedback
  is the whole reason the two halves sit side by side.

### The panel is FIXED — same sections, same order, every time

A rep who learned the planner once must find the same controls in the same
place on every board any agent builds. "Clicking a marker opens that lead with
its actions" is not a spec — it leaves the sections, their order and their
controls to whoever builds the board, and a rep cannot build a habit on that.
Emit the head and these four sections, in this order, and add nothing between
them:

**The panel has TWO modes.** With no lead selected it shows the overview —
*Today's route* (numbered stops, per-leg km, move up / move down / remove, the
"as the crow flies" total, and the Google Maps link) then the full lead list.
Selecting a marker replaces both with the lead detail below; closing it
returns to the overview.

```html
<aside class="panel">
  <!-- HEAD — everything the rep needs before they get out of the car -->
  <div class="section">
    <div class="panel-head">
      <h2>{company}</h2>
      <button class="icon-btn" aria-label="Close {company}">✕</button>
    </div>
    <div class="chips">                  <!-- status chip + "worked today" chip -->
    <div class="facts">
      <span class="address">{location.full, else city/state, else "No address on file"}</span>
      <span>{size}</span>
      <span>Contact: {name · job_title}  — else "No contact yet — enrich to find one"</span>
      <span>Company line: ☎ {phone} · ✉ {email}  — else "No company phone or email — enrich to look for them"</span>
    </div>
    <div class="actions">                <!-- only when the lead has coordinates -->
      <button>Locate on map</button>
      <button>Add to route</button>      <!-- toggles to "Remove from route" -->
    </div>
    <div class="links">
      <a>Google Maps ↗</a>               <!-- only when placeable -->
      <a>Open in Leadbay ↗</a>
    </div>
  </div>

  <div class="section">                  <!-- 1. STATUS — lb.setStatus, saves on change -->
    <h3 class="section-title">Status</h3>
    <select class="lb-select">…</select>
  </div>

  <div class="section">                  <!-- 2. PROSPECTING ACTION — toggles, leadbay_set_prospecting_action -->
    <h3 class="section-title">Prospecting action</h3>
    <div class="choices">…</div>         <!--    the 4 lb.EPILOGUE_STATUSES, each on/off, several at once -->
    <div class="summary">…</div>         <!--    "Last: Still chasing · 24 Sep" when none is on today -->
  </div>

  <form class="section">                 <!-- 3. LOG OUTREACH — channel + note, NO status, via lb.note -->
    <h3 class="section-title">Log outreach</h3>
  </form>

  <div class="section">                  <!-- 4. NEARBY FOLLOW-UPS — lb.distanceKm, nearest first -->
    <h3 class="section-title">Nearby follow-ups</h3>
  </div>
</aside>
```

The head is not decoration. A rep standing outside the building needs the
address, who to ask for, and a number to call if the door is locked — and the
two channel lines are separate because `phone_numbers` / `email` on a lead are
the COMPANY switchboard, not the contact's direct line. Say so, as
"Company line:", or the rep dials it expecting the person.

Why this order and not another: **status first** because it is one click and
the rep usually knows it before they park; **prospecting action second**
because on a doorstep "nobody in" is the whole report and typing a note is not
worth it; **log outreach third** because it is the long form, for the visit
that actually went somewhere; **nearby last** because it is the question you
ask once the current stop is done.

The rules the sections carry:

- **Status and prospecting action are DIFFERENT AXES.** Status is the
  commercial outcome the org sees (`lb.setStatus`); the prospecting action is
  how this visit went and drives when the lead resurfaces
  (`leadbay_set_prospecting_action`).
  Setting one never sets the other — a rep who books a meeting sets both.
- **The prospecting action is four buttons, not a dropdown.** One tap on a
  phone, in a car park. A select costs two.
- **They are TOGGLES over today's list, exactly as in the web app.** The web
  app's Prospection cell is a multi-select over `epilogue_today_statuses`:
  several actions can be on for one day, and each tap turns one on or off.
  Mirror it, so a rep sees the same state in both places:

  ```js
  const today = new Set((lead.epilogue_today_statuses ?? []).map((e) => e.type.replace(/^EPILOGUE_/, "")));
  const selected = !today.has(value);                                 // the tap flips it
  await lb.call("leadbay_set_prospecting_action", { lead_id: lead.id, action: value, selected, _triggered_by: ASK });
  ```

  Read "selected" from `epilogue_today_statuses`, **never from
  `epilogue_status`**. Unticking removes the type from today's list and leaves
  `epilogue_status` where it was, so a board that pre-selects from it brings a
  removed action back on the next open. `epilogue_status` is only the last
  value ever set: show it as a "Last: Still chasing · 24 Sep" line when nothing
  is on today, as the web app does. The field is absent on a lead nobody has
  worked — that is an empty set, not an error. Use `role="checkbox"` and
  `aria-checked`, not `aria-pressed`.
- **In the web app's colours.** Still chasing blue, Meeting planned green,
  Could not reach yellow, Not interested red — the `--color-<hue>-background`
  / `-foreground` pairs, all four in the skin. The foreground goes on a dot
  and the selected border, never on the label: yellow's is too light to read
  as text on white, and the web app only uses it for icons.
- **Log outreach writes a NOTE. It must not offer the epilogue too.** The
  first build of this panel put the same four `lb.EPILOGUE_STATUSES` in a
  select inside the form, so a rep who tapped a button and then submitted the
  form issued two writes of one field and the second silently won. Worse, the
  form's "No outcome yet" omitted `epilogue_status` entirely, leaving the
  button's status standing under a note that said otherwise, with nothing on
  screen showing the mismatch. One control per axis: the buttons own the
  epilogue, the form owns the note. Say so under the submit — "Sets no status
  — use Prospecting action above for that."
- **A page never calls `lb.outreach`** (see *Writing from a page*). Write the
  note with `lb.note` and the action with `leadbay_set_prospecting_action` —
  the web app's own two paths.
  `lb.outreach` goes to `report_outreach`, which asks a human to type a
  confirmation for every `user_confirmed` call, and a page has nowhere to
  show that prompt: the button waited 60 seconds, the write landed anyway, and
  the page showed "took too long". Reps retried and logged one visit twice.
  The prompt cannot be skipped for pages, because the server cannot tell a
  page from an agent that claims to be one — so the page takes the path that
  never asks.
- **Every write repaints the pin before the panel says "saved".** The map is
  the record the rep reads; a panel that confirms while the pin still shows
  the old status is lying about what they can see.

`lb.relanceRow` may be added for contacts and enrichment, as a FIFTH section
after Nearby — never inserted among the four.

### Colours come from the skin, not from a second palette

`lb.styles()` already defines the product's greys, so a page that also
declares its own ends up with two near-identical neutrals on one screen — a
blue-tinted `#f4f5f7` page behind a `#f0f0f0` toolbar, borders at `#e2e5ea`
beside the kit's `#e0e0e0`. Close enough that nobody can name the problem,
wrong enough to look unfinished. Alias the skin instead:

```css
:root {
  --bg:    var(--color-gray-2);   /* the page behind map and panel */
  --panel: var(--color-white);    /* the panel and any card on it */
  --line:  var(--color-gray-3);   /* every border */
  --ink:   var(--lb-fg);
  --muted: var(--lb-muted);
}
```

Status pins take the semantic tokens the chips already use —
`--color-blue-foreground` for Wanted, green for Won, red for Lost — so a pin
and its chip are the same colour by construction rather than by two people
picking the same blue.

Keep exactly three colours of your own, because the kit has none for them —
`--land`, `--land-border` and `--water` are drawing a country, not UI chrome.

**Then pin the board to light, or aliasing makes it worse than the palette
did.** A page with its own hardcoded greys is accidentally immune to dark
mode; the moment it aliases the skin it inherits the skin's dark block, which
fires on `prefers-color-scheme: dark`. The board a rep opens on a dark-mode
laptop then paints `--lb-fg` white over a light `--color-gray-2` ground —
white text on a white page, borders jumped from `#e0e0e0` to mid grey. Same
rule as the triage board: these boards are light for everyone.

```css
/* Tripled on purpose. lb.styles() APPENDS the skin to <head> at runtime, i.e.
   after this sheet, so a plain :root here loses to the skin's
   :root[data-theme=dark] on source order. :root:root:root outranks it on
   specificity instead, which source order cannot undo. */
:root:root:root {
  --lb-surface: var(--color-gray-1);  --lb-border: var(--color-gray-3);
  --lb-fg: var(--color-black);        --lb-muted: var(--color-gray-8);
  --lb-field: var(--color-white);     --lb-chip-bg: var(--color-gray-2);
  color-scheme: light;
  /* …and the semantic pairs the pins and chips read, at their light values. */
}
```

A single `data-lb-theme="light"` on `<html>` does the same job and is simpler
— use it when the page owns its `<html>` element. An artifact that is a
fragment the host wraps does not, which is why the pin is a stylesheet rule.

### There is no tile layer. The basemap ships as files

The first instinct on any Leaflet map is the one every tutorial opens with:

```js
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map)  // ← blocked
```

**It does not work in an artifact, and it fails silently.** The artifact
viewer's content security policy admits the page's own files, Google Fonts
and a few script CDNs — nothing else. Every tile provider is off that list:
OpenStreetMap, Carto, Stadia, MapTiler, all of them. The browser refuses the
request before it leaves the machine, no error surfaces in the UI, and the rep
gets an empty grey rectangle with pins floating on it. Probed with a real
Leaflet map against two providers: `0 loaded`, every tile failed.

This is a property of WHERE the page runs, not of the code. The same two lines
work in the Leadbay frontend and in a local `.html` file. They only fail in a
published artifact — which is the only thing this recipe builds.

So the basemap is a **published file**: `france-departements.json`, the 96
département outlines, fetched and drawn as one `L.geoJSON` layer behind the
pins. Take the ~570 KB build — coordinates rounded to five decimals, which is
sub-metre, rather than the sixteen-decimal version of the same outlines that
costs the same bytes for an eighth of the geometry and omits the islands
(Ré, Oléron, Belle-Île, the Corsican islets) entirely.

**Stop there.** Roads and town labels were built, shipped and then removed:
~475 KB of Natural Earth roads and 800 `geo.api.gouv.fr` town labels, tiered
by zoom. They worked, they cost a layer-ordering bug, and a rep looking at
them still could not see a drive time, a local street or whether a river ran
between two stops. They are a partial substitute for a thing an artifact
cannot have, and the plain outline reads better. If someone asks for "more
detail on the map", the honest answer is that the panel's *Open in Google
Maps* link is where navigation lives, and this map is for seeing WHICH leads
sit near each other — which the outline already does.

Do not try to solve it with a bigger file either. A full OSM extract for
France is 4.7 GB and a single region ~500 MB, against a 16 MB ceiling per
artifact file.

### The board opens on France, and stays where the rep put it

```js
const FRANCE_BOUNDS = L.latLngBounds([41.3, -5.2], [51.1, 9.6])
map.fitBounds(FRANCE_BOUNDS)                       // Corsen→Italy, Bonifacio→Dunkerque
```

- **`fitBounds`, never `setView([46.6, 2.4], 6)`.** The map pane is half the
  window — a tall narrow box — so one fixed zoom frames the country differently
  on a laptop and a wide monitor. Bounds adapt to the pane; a zoom number
  guesses at it.
- **Do NOT fit to the leads on load.** The obvious move is to frame the pins as
  soon as they arrive. It means the board opens on whichever region the rep's
  book happens to cluster in, with no sense of the country around it — and if
  it re-fires on every city change it yanks the view while they are reading.
  Give them a **Fit to leads** button in the toolbar instead, beside *All
  areas*, and let the opening view be France every time. With no geocoded
  leads the button falls back to France rather than doing nothing.


### The lead list: static dividers, one moving thing

Both lists in the panel — *Follow-ups on the map* and *Nearby follow-ups* —
use the same row. Copy it; it is three rules, and each one is a thing the
obvious version gets wrong.

```css
.rows { display: flex; flex-direction: column; gap: 2px; }
.row-btn {
  position: relative; padding: 9px 10px; margin-inline: -6px;
  border: 0; border-radius: 10px; background: transparent;
  transition: background-color .12s ease;
}
.row-btn + .row-btn::before {          /* between rows only — never first or last */
  content: ""; position: absolute; inset-inline: 10px; top: -1px; height: 1px;
  background: var(--line);
}
.row-btn:hover, .row-btn:focus-visible { background: color-mix(in srgb, var(--ink) 4%, transparent); }
.row-btn:active { background: color-mix(in srgb, var(--ink) 8%, transparent); }
@media (prefers-reduced-motion: reduce) { .row-btn { transition: none; } }
```

- **The divider never reacts to hover, and never animates.** The tempting
  version fades the line above and below the hovered row so the highlight has
  clean edges. Do not: two rules then fight over one line — the hovered row
  hides the divider below it while the next row hides the one above it — so
  the line flickers as the pointer crosses between rows, and scanning the list
  makes lines ripple in and out around the cursor. The animation ends up
  louder than the row it is highlighting. **Only the background moves.**
- **Space the rows instead of hiding the line.** `gap: 2px` with the hairline
  centred in the gap means the rounded hover block floats in its own space and
  never shares an edge with a divider. There is nothing to hide, so nothing
  has to animate. This is the whole trick.
- **The divider is inset to the text (`inset-inline: 10px`), not the row.** A
  line that runs wider than the content it separates stops reading as a
  divider and starts reading as a rule across the panel. Pair it with
  `margin-inline: -6px` on the row so the hover block bleeds slightly past
  the text — inside the panel's own 16px padding, which leaves room for the
  focus ring.

Use `.row-btn + .row-btn::before`, not `::after` with a `:last-child`
exception: a selector that only ever matches BETWEEN rows cannot put a line
under the last one, so there is no special case to forget.

Straight-line totals from `lb.routeDistanceKm` are "as the crow flies" — label
them that way rather than implying a drive time.

## Recipe: the LEAD DESK (the default board for working leads)

When the rep accepts the board after `leadbay_pull_followups` or
`leadbay_campaign_call_sheet`, build THIS. It is the relance table below plus
a source picker, and it is the canonical answer to "give me somewhere to work
these leads".

```js
const source   = lb.field({ value: "followups" });   // or "discover" | "campaign"
const campaign = lb.campaigns(ASK);                  // only for the campaign source
const sort     = lb.sortOrder();

const list = lb.leadSource({
  kind: source, campaignId: campaign, order: sort, ask: ASK, pageSize: 15,
});
list.subscribe((l) => renderRows(l.items));
```

`lb.leadSource` owns the two things that differ by source, and only those:

- **The deep link's view.** `list.leadUrl(lead)` answers per row — a Monitor
  lead opened on Discover drops the rep into a list that does not contain it,
  and a campaign row needs `?campaign=<id>&lead=<id>` or it opens an empty
  campaign view.
- **Sorting.** `leadbay_campaign_call_sheet` has NO `order` param, so the
  order is DROPPED for that source rather than sent and rejected. Hide the
  sort control there too: offering it promises something the tool cannot do.

Changing the source or the sort resets to page 0 — page 2 of the old list is
not page 2 of the new one. Every row is a `lb.relanceRow`, which now carries
taste and qualify alongside contacts, status and outreach, so the row is
complete whichever source it came from.

## Recipe: relance table (the follow-up board)

"Give me a table where I can see who to call, reach them, and record what
happened." One row per lead, everything in one place. `lb.relanceRow` bundles
the row so you wire it once instead of five times:

```js
const list = lb.callList({ source: "followups", ask: ASK });
list.subscribe((l) => renderRows(l.items));

function wireRow(lead, els) {
  const row = lb.relanceRow({
    leadId: lead.id,
    ask: ASK,
    currentStatus: lead.state?.status,       // the select opens on it
  });

  // CHANNELS — lazy. The row renders from the list; this fires on the gesture.
  row.contacts.subscribe((c) => renderContacts(els.contacts, c));
  els.reveal.onclick = () => row.contacts.load();

  // STATUS — saves on change, no button.
  lb.bindSelect(els.status, row.status);
  els.status.onchange = () => row.saveStatus.run();

  // OUTREACH — epilogue + note, note required.
  lb.bindSelect(els.epilogue, row.epilogue);
  lb.bindValue(els.note, row.note);
  lb.bindAction(els.log, row.logOutreach);
}
```

**Every row's lead cell carries its context — this is not optional.** The row
resolves it for you when you pass the lead:

```js
const row = lb.relanceRow({ leadId: lead.id, ask: ASK, lead });
row.context.subscribe((c) => {
  if (!c.data) return;
  els.summary.textContent = c.data.summary ?? "";        // what they do
  if (c.data.phone) els.coPhone.href = "tel:" + c.data.phone;
  if (c.data.email) els.coEmail.href = "mailto:" + c.data.email;
});
```

Three rules the component enforces so a row cannot get them wrong:

- **Never print `sector_id`.** It is a raw id (`"5134"`); `lb.sectorLabels()`
  resolves it, fetching the ~1,091-row taxonomy once per page and caching it.
  Unresolvable means the line is OMITTED, never shown raw.
- **Show the company's phone and email when they exist.** A rep who can dial
  the switchboard today should not have to open Leadbay to find out.
- **Label them as the COMPANY's.** `phone_numbers` and `email` on a lead are
  the switchboard, not `recommended_contact`'s direct line. Rendering
  "Jean · ☎ 01 23…" claims a line that does not exist.

**A contact's LinkedIn is a route, show it.** `lb.relanceRow` flattens
`linkedin_page` onto each contact, so a contact with no email or phone may
still be reachable — render it beside the other channels. It is deliberately
NOT counted as reachability by `lb.leadReach`: the two rules answer different
questions ("can I contact this person now" vs "how much of the book is
callable"), and a URL cannot be dialled.

**Email and phone are NOT on the list payload.** `pull_followups` and
`campaign_call_sheet` carry `recommended_contact` as a NAME and nothing else;
the channels live on `research_lead_by_id` as `contacts.reachable[]`. So a
table that renders `☎` straight from the list renders nothing, and one that
prefetches fires a request per row to fill cells the rep may never read.
`row.contacts` is a lazy Resource for exactly that reason: render the row
instantly, load the channels when the rep opens it. Show a **Reveal contact**
control rather than an empty cell, so the rep knows the data exists.

**Two write systems, both on the row.** `row.saveStatus` writes the org-wide
CRM outcome (Wanted/Won/Lost/Unwanted); `row.logOutreach` records how THIS
attempt went (still chasing / could not reach / interested / lost) and drives
follow-up ranking. Setting one never sets the other, so when the rep says
"she's interested, meeting booked" both fire. Use `lb.EPILOGUE_LABELS` for the
select — the raw enum values are shouted constants and a rep should not have
to translate `INTEREST_VALIDATED_OR_MEETING_PLANED` before answering.

**The note is required and the component enforces it.** `report_outreach`
without a note records that something happened and not what; the next rep
reads an empty follow-up and calls blind.

**A contact with no channel gets an enrich offer, not a dead end.** That is
the whole point of showing candidates: they are one purchase away from being
callable.

```js
// wherever a channel is MISSING — never gate on `enriched`, see below
if (!c.phone || !c.email) {
  lb.bindAction(els.enrich, lb.enrichContact({
    leadId: lead.id,
    contactId: c.contactId,
    email: () => emailBox.checked,     // both default true, as the tool does
    phone: () => phoneBox.checked,
    ask: ASK,
    onDone: () => row.contacts.load(), // ← see below
  }));
}
```

`lb.enrichContact` SPENDS QUOTA, so it confirms by default and names the
spend.

**`window.confirm` does not work in a published artifact.** The iframe is
sandboxed and the call returns false without showing a dialog, so an action
carrying a `confirm` returns early with no error and no message — a control
that silently does nothing. `Action` now reports that case as an error rather
than swallowing it, but the fix for a real page is to supply your OWN
confirmation: pass `confirm: ""` and arm the button in-page (first click
arms and relabels, second click spends, with a timeout that disarms). Apply
the same to the triage board's bulk apply, which has the same footgun. Offer
email and phone as separate choices rather than always buying both — the tool
defaults both to true and rejects a call with both false, which the component
catches before the confirm so nobody approves a spend that cannot happen.

**Never gate the offer on `enriched`.** `enrichment_done` flips true once ANY
channel resolves, so a contact enriched for email earlier reads done while
still having no phone — and an org contact can read done carrying nothing at
all. Hiding the button there hides it on exactly the contacts that need it.
Gate on the CHANNEL being missing, and default each checkbox to the missing
one so a rep cannot re-buy what is already on file.

**The call launches an async job; it does not return a channel.** The real
response is `{triggered: true, email_requested, phone_requested, hint}` — no
`ok`, no contact. The reveal lands minutes later, so a UI that expects the
email in this result shows the rep nothing.

**Re-read the contacts afterwards; do not patch the row.** For a
`source:"paid"` candidate the channel lands on a NEW `source:"org"` contact
with a DIFFERENT id — the candidate row itself only flips `enrichment_done`.
That is what `onDone` is for.

**Layout.** It is a table, so `lb-table` with `data-num` on any count, and the
per-row controls stacked in their cell (`lb-stack`) so a select and an input
share one width. Keep `lb-msg` out of the control row — a failed write is the
most important thing on that row at that moment.

## Recipe: cold-call sheet (one row per lead)

```js
const lb = window.LeadbayArtifacts; lb.configure();
const ASK = "<the user's request>";

const list = lb.callList({ source: "campaign", campaignId: CID, ask: ASK });
list.subscribe((l) => renderRows(l.items, l.loading));   // your render

// per lead row (call when you build a row):
function wireRow(lead, els) {
  // Note + prospecting toggles, never lb.outreach — see *Writing from a page*.
  const note = lb.field({ validate: (v) => (v && v.trim() ? null : "Add a note") });
  lb.bindValue(els.note, note);
  lb.bindAction(els.log, lb.note({ leadId: lead.id, note }));
  for (const btn of els.actions) btn.onclick = () => toggle(lead, btn.dataset.value);
  lb.bindAction(els.like, lb.like(lead.id));

  // MANDATORY here too — a rep on the phone is exactly who discovers the
  // qualifier was wrong. The label comes from the lead, never hardcoded.
  els.qualify.textContent = lb.qualifyLabel(lead);
  lb.bindAction(els.qualify, lb.qualify({ leadId: lead.id, ask: ASK }));

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

## Recipe: segment coverage (any dimension)

"How many leads do we have in sector X" is one cheap call: the Monitor filter
plus `count: 1`, read off `pagination.total`. `lb.segmentCount` wraps a single
sector/city count; **`lb.coverage` sweeps a whole dimension**.

### One skeleton, many dimensions

Sector is not special. Every `FilterCriterion` type the Monitor accepts is a
coverage dimension, and one board renders any of them — the bars, the
denominator and the trusted check are all dimension-agnostic:

| Dimension | Criterion | Answers |
|---|---|---|
| sector | `{type:"sector_ids", sectors:[id]}` | where the book concentrates |
| size | `{type:"size", min, max}` | am I an SMB or an enterprise shop |
| recency | `{type:"last_action_date", …}` | how much has gone cold |
| liked | `{type:"liked"}` | what the team actually wants |
| custom field | `{type:"custom_field", key, value}` | the org's own taxonomy |

```js
const buckets = await lb.coverageBuckets({          // derive, never hardcode
  field: "sector_id",
  labels: SECTORS,                                   // id → name, embedded
  criterion: (id) => ({ type: "sector_ids", sectors: [id], is_excluded: false }),
  limit: 12,
  ask: ASK,
});

const book = await lb.coverageTotal({ ask: ASK });   // unfiltered denominator
const rows = await lb.coverage({
  buckets,
  ask: ASK,
  onProgress: (done, total) => (tally.textContent = `measuring ${done}/${total}…`),
});

for (const r of rows) {
  if (!r.trusted) renderUnmeasured(r);               // never chart it
  else renderBar(r.label, r.total, r.total / book.total);
}
```

Three things `lb.coverage` owns, each of which a hand-rolled sweep gets wrong:

- **Sequential, not a parallel burst.** A filtered count is 1–2s, but a
  `last_action_date` criterion was observed at **54s** on a 3.6k segment.
  Twelve of those at once is a hung page; `onProgress` is there so the sweep
  is visible instead.
- **The complete criteria set per call.** The stored filter is ONE
  server-side slot and cumulative, so a delta leaves the previous bucket's
  criterion in force and every bar becomes a subset of the one before it.
- **Per-bucket verification.** One rejected criterion must not poison a
  neighbour's number, and a bucket that throws becomes an unmeasured row
  rather than aborting the other eleven.

### Reachability — the segment that says what to BUY

Every dimension above slices a book the rep may not be able to call. This one
says whether they can call it at all, and it is usually the first board worth
building on an imported book:

```js
const r = await lb.reachCoverage({ ask: ASK });     // one call
renderBars(r.rows);
note.textContent = `sampled ${r.sampled} of ${r.bookTotal}`;
```

Three buckets, and the middle one is the answer:

| Bucket | Means | Next move |
|---|---|---|
| Callable now | a company phone or email exists | work it |
| **Contacts, no channel** | people known, nothing dialable | **enrich — this is the spend** |
| No contacts | neither | discovery first |

**`contacts_count > 0` is NOT reachability**, and `lb.leadReach` exists so no
board gets this wrong. It counts known PEOPLE, not people you can dial — a
lead can show 2,518 contacts and zero channels. Charting `contacts_count`
tells a rep they have a pipeline when they have a phone book with no numbers.
A `linkedin_page` is not reachability either. And the API returns the literal
string `"null"` in `phone_numbers` and `email`, which counts as a channel
unless guarded — the one error that would make this board actively harmful,
by overstating the callable book.

**This one is SAMPLED, unlike every other dimension.** Reachability is not a
`FilterCriterion`, so there is no cheap `pagination.total` for it: the counts
come from classifying real leads on one page. `bookTotal` is the real
denominator (it rides along on the same call, so this costs ONE request), and
`sampled` says over how many. Label it as an estimate — "≈62% of 7,078,
sampled over 200" — never as an exact count.

### What you cannot count this way

A dimension is countable only if the Monitor can FILTER by it. Anything
needing per-lead values — a score histogram, a density map — has no
aggregation endpoint and means paging the whole book (732 pages for 3,656
leads). Sample the tails instead (`order: "SCORE:ASC"` / `"SCORE:DESC"`, a few
hundred each) and **label the chart as a sample with its n**, or do not draw
it.

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
call `leadbay_report_artifact_error` yourself.

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
