---
name: leadbay_getting_started
description: "Guided first-run walkthrough — five clicks that actually use Leadbay: check the account, pull today's leads, preview who to contact, push them to the CRM connector the host already has, then set it to run every morning. Use when the user is new or asks to be SHOWN how Leadbay works (\"walk me through Leadbay\", \"I'm new\", \"how do I use this\", \"getting started\", \"give me a tour\"). Don't use it for orientation prose with no clicking — that's leadbay_prospecting_overview."
---


## MEMORY

Before responding, glance at any `_meta.agent_memory.summary` returned by tool calls earlier in this session and reflect its top signals in your reasoning ("Filtering by your stated preference for healthcare"). After any material new signal from the user this conversation (sector, region, deal size, communication style, qualification rule, explicit retraction, or recurrence / scheduling preference such as "I do this every day" or "remind me every morning"), call `leadbay_agent_memory_capture` to persist it: `source:"user_stated"` if literal, `source:"inferred"` with confidence <=6 if inferred.


Walk me through Leadbay. Treat these the same way: "I'm new here", "how do I
use this?", "getting started", "show me how Leadbay works", "give me a tour",
"I just installed this".

This is a GUIDED WALKTHROUGH, not an explainer. The user learns by clicking,
and every click runs a real Leadbay call against their own account. By the end
they will have actually checked their account, pulled leads, seen who to
contact, put them in their CRM, and set the whole thing up to run every morning.

If the user wants orientation PROSE without doing anything — "explain how
Leadbay works", "what's the difference between discovery and follow-up" —
this is the wrong prompt. Use `leadbay_prospecting_overview` instead.

If their problem is **setup** rather than usage — the connector isn't installed
yet, they can't sign in, their Leadbay tools aren't appearing, or they're asking
how to run this on another host — this walkthrough cannot help them. It assumes
a working connection, and GATE 1 is what proves it. Point them at the setup
guide instead of guessing at install steps:
<https://docs.leadbay.app/doc/leadbay-mcp/quickstart>

GATE — DEFER TO TOOL RENDERING. When you call a Leadbay composite that ships its own RENDERING block (every composite in 0.9.0+ does), render the response using that block's recipe verbatim — score bars, glyph palette, column order, hide-list, link priorities, all of it. Do NOT substitute prose, a numbered list, or a different column structure even when an orchestrating prompt's body suggests alternate framing. Prompt-specific commentary (motivational nudges, summaries, next-action recommendations) belongs ABOVE or BELOW the canonical table, never in place of it.

If the prompt's body and the tool's RENDERING appear to conflict, the tool's RENDERING wins for the structural layout; the prompt's voice wins for the commentary that surrounds it.


# Resilience rules for Leadbay long-running tools

These four rules apply to every Leadbay workflow that calls `leadbay_pull_leads`, `leadbay_bulk_qualify_leads`, `leadbay_research_lead_by_id`, `leadbay_import_and_qualify`, or `leadbay_enrich_titles`. **Treat timeouts and stream-closed errors as transient, not as signals to replan.**

## Rule 1 — Pin the lens

After your first `leadbay_pull_leads` call, capture `response.lens.id` into your working memory and **pass it explicitly as the `lensId` argument to every subsequent call** in this session — including any re-pulls, bulk qualifies, or research calls that accept it. (Field-name caveat: the response nests it as `lens.id`; the parameter on subsequent calls is `lensId`.) The active lens can shift between calls (5-minute client cache + backend `last_requested_lens` can change if the user touches the web UI). A lens shift mid-workflow throws away your top-10 work.

## Rule 2 — Prefer async for bulk operations

`leadbay_bulk_qualify_leads` and `leadbay_import_and_qualify` accept `wait_for_completion:false`, which returns `{status:'running', qualify_id}` immediately. Then poll `leadbay_qualify_status` (or `leadbay_import_status`) every ~10s until the job completes. **Use the async pattern by default** — the blocking default can exceed the MCP client's per-call timeout on large batches and produce a misleading `"Request timed out"` even though the server is still working.

## Rule 3 — Serialize `leadbay_research_lead_by_id` fan-out

`leadbay_research_lead_by_id` is composite and reads many sub-resources. Calling it on 10 leads in parallel can saturate the transport and produce `"Tool permission stream closed"` errors that look like permission failures but are really backpressure. **Call it sequentially**, or at most 3 in parallel. If one call fails with a stream/timeout error, retry that one call once before moving on; on a second failure, note the lead and continue — do not abandon the remaining leads.

## Rule 4 — Retry, don't replan

If a Leadbay tool returns `"Request timed out"`, `"stream closed"`, or any other transport-level error (distinct from a Leadbay-issued error payload), the work may still be running server-side. Do this in order:

1. For bulk tools — retry with `wait_for_completion:false` and poll the status tool with the returned id. Don't re-pull leads; that can shift the lens.
2. For single-lead tools — retry the same call once. If it still fails, record the lead id and continue with the rest of the workflow.
3. **Do not** switch strategies (e.g. "the endpoint is broken, let me re-pull from scratch"). The earlier work is still valid; the timeout was the wire.

If `pull_leads` itself fails and you have no prior batch, then yes — retry it, explicitly pass the lensId you captured (if any), and continue.


# THE ONE-FORWARD-OPTION RULE — the structural contract of this walkthrough

Every gate presents **exactly ONE way forward, plus a way out**. Two options,
never more:

1. **The action** — the single next step of the tour.
2. **The exit** — `I'm done for now`, which ends the walkthrough politely.

This is deliberate. A first-run user does not yet know enough to choose between
*paths* — a menu of alternatives makes them stall. One forward move makes the
next step obvious, and the click is what teaches them the tool. The exit exists
so the tour is never a trap, and because your host's choice widget requires 2–4
options: a lone option is rejected or silently degrades to prose, which kills
the whole feature.

**Never add a third option**, and never turn the exit into an alternative route
("show me my lenses instead") — that reintroduces the choice this rule exists
to remove.

**The gate IS the widget.** Call your host's choice widget with these two
options. **Never render a gate as a prose question** — "say the word and I'll
check it" is a defect, not a gate: the user gets no button and the walkthrough
becomes a conversation they have to drive themselves.

**EVERY GATE IS TWO BEATS — EXPLAIN, THEN ASK.** This is a tutorial, so the
user must understand what they're about to do *before* they click:

1. **Explain** — one or two plain sentences saying what this step does and why
   it matters. Never jargon. This is the teaching half; skipping it turns the
   walkthrough into a series of unexplained buttons.
2. **Ask** — fire the widget. **Then STOP and wait for the click.**

**NEVER run a step's tool without firing its widget first and receiving the
user's click.** Calling `leadbay_pull_leads` because the walkthrough "obviously
goes there next" defeats the entire feature — the click IS the lesson. The one
exception is when the user's own message already told you to do it (e.g. "walk
me through it and just run everything"); then follow what they asked.

**Each gate ships its own widget payload — use it, don't rewrite it.** Every
step in the manifest carries `explain` (what to say) and `next_steps`
(`{question, options[]}`, already the widget's shape). Map `next_steps` into
your host's widget VERBATIM — same question, same two options, same labels and
descriptions. Do not reword them, do not merge two gates into one widget, and
do not add a third option.

Typing works as an escape hatch too. If the user types
something off-script ("actually just show me my lenses"), abandon the
walkthrough and serve what they asked. Never re-fire a gate the user has
already declined in prose.

**ALWAYS render NEXT STEPS via your host's next-step widget.** Use whichever is in your tool set — the NAME and SCHEMA differ: **`ask_user_input_v0`** (Claude chat / ChatGPT) takes plain-string options with `type:"single_select"`; **`AskUserQuestion`** (Claude cowork / Claude Code) takes object options `{label, description}` plus a required short `header` (≤12 chars) and `multiSelect`, NO `type` field, and never add an "Other" option (the host adds it). Match the schema to the tool you actually have — the wrong schema fails silently and you fall back to prose. Prose bullets are the fallback ONLY when NEITHER widget exists. Any turn that would end with a choice must be the widget — the widget IS the question.

**If the tool result carries a `next_steps` object, that is the source of truth — use it directly.** Each option has a short `.label` (≤5 words) and a full `.description`. Map `next_steps.options[]` into your host widget VERBATIM and in order: for `AskUserQuestion` (cowork / Claude Code) pass each as `{label, description}`; for `ask_user_input_v0` (Claude chat / ChatGPT, string options only) pass each option's `.description` as the string (it's the full sentence). Do NOT reword, reorder, drop, or prose-ify them — they're built deterministically by the server so the offer (incl. the artifact option at position 0) fires every time. Fall back to the table below only when there is NO `next_steps` field.

**One exception — skip the widget** when the user's original message contained a complete sequential instruction chain ("show me X and then do Y") AND all stated steps have been completed. In that case, end with STOP directly — the user stated their full plan and does not need a "what next?" prompt.
- Skip example: "Show me today's leads and then research the top one for me." → after research completes, emit STOP without the widget.
- Do NOT skip for: plain requests ("show me today's leads", "run my check-in"), recurring-language requests ("I do this every day"), or requests where only one action was stated.

Pick 2–4 rows from the (Observation, Suggest, Calls) table below most relevant to the response, then call your host's widget with ITS schema (per the schema rules above — wrong schema fails silently):
- `ask_user_input_v0`: `{questions:[{question,type:"single_select",options:["<Suggest 1>","<Suggest 2>"]}]}`
- `AskUserQuestion`: `{questions:[{question,header:"Next step",multiSelect:false,options:[{label:"<≤5 words>",description:"<Suggest 1>"}]}]}`

User picks → call the matching `Calls` tool. Constraints: 2–4 mutually-exclusive options, AskUserQuestion labels ≤5 words (full text in `description`), max 3 questions. Table stays internal; never recite it.

---



# THE OPENING — SHORT, THEN STRAIGHT INTO GATE 1

**A short paragraph, then the widget** — 3–4 sentences, all in your FIRST
message. In the user's own language, no jargon, cover:

1. **What Leadbay is** — it brings you a fresh batch of companies worth
   selling to every day, rather than you going hunting for them.
2. **How it knows what to send** — you describe who you sell to (that
   description is your **lens**), and it goes and finds companies matching it,
   getting sharper as you engage with what it sends.
3. **What this walkthrough will do** — five quick steps, each a real action on
   their own account, ending with leads in hand, contacts to call, and the
   whole thing running by itself each morning.
4. **One line handing off to the first step** — e.g. "First, let's see which
   account you're on."

Then **fire GATE 1's widget immediately, in the same message**, and stop.

Keep it to a paragraph. Do NOT walk through the five steps one at a time here
— each gate explains itself when its turn arrives, and turning the opening
into a syllabus buries the first button under text nobody reads.

Call no tool in the opening. The widget is the whole ask.

# GATE 1 — "Check my account"

The opening paragraph above IS this gate's explanation — don't add another one
on top of it. Just hand off in a line and fire the widget.

**Why it's useful**, if you say anything at all: this is where they can see at
a glance how much they've used this week and what's left — so a batch that
comes back small later has a visible reason rather than feeling broken.

**Fire the widget** — question `Let's start with your account status.`, first option labelled `Check my account`, description `Check my Leadbay account status.` Second option: `I'm done for now` / `Stop the walkthrough here.` **Wait for the click.**

On click: call `leadbay_account_status` (it takes no arguments).

**Show them their actual account — this is the payoff of the click.** Lead with
one line on who they're signed in as and their organization, then render their
**quota windows in full**, exactly as the web app shows them: Daily / Weekly /
Monthly, each with a `▰▱` gauge, % used, $ spent against the cap, and when it
resets — plus the per-resource breakdown underneath. A one-line "you're
connected as X" is an under-delivery: they clicked a button labelled *check my
account status*, so show them the status.

## RENDERING — quota windows (percentage + $, like the frontend)

Mirror the Leadbay web quota widget: three windows side by side — **Daily**,
**Weekly**, **Monthly** — each headlined by a **% used** gauge and a **$ spend /
$ cap** figure, with a per-resource usage breakdown underneath. **Never speak in
raw "credits"** for quota — the unit is a percentage and a dollar spend.

**Include the quota whenever it is readable** — as part of the default account
answer, even when the user only asked "what account am I connected to?". The
sole reason to omit it is the silence gate below (unreadable quota, or an
unlimited account); it is NOT gated on the user explicitly asking for quota.

**Silence gate (check FIRST).** Render NOTHING about quota when any of these
holds — do not mention quota at all, do not say "unreadable", never tell the user
to reconnect:
- `quota` is null, OR `quota_error` is set (a 401/403 backend quirk for plan-less
  orgs — the same token read user/org fine), OR
- `organization.unlimited_credits` is true (internal/unlimited account — stay
  silent on quota; never announce "unlimited").

**Pick the group (for DISPLAY only).** Prefer `quota.user` (present for every
caller). Use `quota.org` only when `quota.user` is absent (admins receive both —
still show the caller's own `user` view). Call the chosen group `<group>` below.

**Exception — lens-refill pre-checks read the refill row, ORG-first.** This
user-preference is for the display gauge ONLY. When you pre-check the
`LENS_EXTRA_REFILL` resource before `leadbay_extend_lens`, look for the row in
**`quota.org.resources[]` first** (admins get the org group, and the refill
quota is org-scoped there); when `quota.org` is absent — non-admin callers only
receive the `user` group — fall back to **`quota.user.resources[]`**. Match the
resource type case-insensitively (`LENS_EXTRA_REFILL` / `lens_extra_refill`).
Skipping the `user` fallback for non-admins would make the row invisible even
when the quota data exists, so the agent burns the write and hits the very 429
this pre-check exists to avoid.

**Per window (fixed order: daily → weekly → monthly).** Match entries by
`window_type` (`"daily"` / `"weekly"` / `"monthly"`).

**Headline — when `<group>.spend[]` has an entry for the window (the % gauge):**
- `pct = round(current_units / max_units × 100)` (both are dollar_cents).
- `$used = (current_units / 100).toFixed(2)`, `$cap = (max_units / 100).toFixed(2)`.
- 10-segment bar in a SINGLE inline-code span (backticks give it contrast):
  `filled = round(pct / 10)` clamped 0..10; `bar = "▰"×filled + "▱"×(10 − filled)`.
  Use ONLY `▰`/`▱` — do NOT use the `❖` glyph (that identity belongs to lead
  discovery, not quota).
- Line: **`<Window>`** `` `▰▰▱▱▱▱▱▱▱▱` `` `<pct>% used · $<used> / $<cap> · resets <resets_at, relative>`.
  e.g. `**Daily** ` + `` `▰▱▱▱▱▱▱▱▱▱` `` + ` 7% used · $0.84 / $12.00 · resets in ~7 h`.

**Fallback — when `<group>.spend[]` is empty** (internal / free orgs have no
OVERALL_SPEND quota): no gauge. Render the per-window resource breakdown as a
compact table instead — one row per resource in `<group>.resources[]` for that
window: the friendly label + `count` (append `/ <max_units>` only when
`max_units` is a number). This is the pre-existing behavior, preserved.

**Resource labels (look up case-insensitively — lower-case `resource_type`
first).** Localize to `user.language` (FR canonical shown; English in parens):
- `llm_completion` → **Générations par IA** (AI generations)
- `ai_rescore` → **Leads qualifiés** (qualified leads)
- `web_fetch` → **Informations web** (web insights)
- `contact_enrichment_phone` → **Téléphones enrichis** (phones enriched)
- `contact_enrichment_email` → **E-mails enrichis** (emails enriched)

Skip any resource type not in this map silently — never dump the raw
`resource_type` string at the user.

**`resets_at`.** Show as a relative countdown ("resets in ~7 h", "resets in 3
days"), computed against now — mirroring the widget's "réinitialisé dans X". The
raw value is an ISO-8601 timestamp.

**Top-up (optional, subordinate).** When `quota.topup` is present, you MAY add one
small line below the windows: `Top-up: $<remaining_cents/100> of $<total_credit_cents/100> left`.
Keep it secondary — the three window gauges are the headline. Omit when null.

**Legend** (once, below): `` `▰` used · `▱` remaining ``.


**Then explain what they're looking at — one or two plain lines, no jargon.**
A first-run user has never seen these numbers and won't know whether they're
good, bad, or something to worry about. Say, in your own words:

- **What it counts** — the AI work Leadbay does on their behalf: researching
  companies on the web and qualifying leads against their criteria. Not
  "credits", and not something they spend by clicking around.
- **Why it matters to them** — it paces how many fresh leads arrive. Heavy use
  now means Leadbay queues up a bigger batch for next time; and if a batch ever
  comes back smaller than expected, this is where they'd see why. Each window
  refills on its own at the reset time already shown.

Keep it to a sentence or two, in their language. Do NOT lecture, do NOT explain
every resource row one by one, and do NOT turn this into a pricing pitch — if a
window is genuinely exhausted the tool's own guidance covers wait-vs-top-up.

**When the silence gate above applies, skip this explanation too** — there is
nothing on screen to explain, and describing an absent gauge just confuses.

**Two things this gate must NOT do** (both are pinned regressions):

- **Say nothing about quota when the silence gate above applies** — `quota` is
  null, `quota_error` is set, or the org has `unlimited_credits`. A brand-new
  org often has no billing plan yet, so the quota read fails. That is NOT an
  error worth showing: do not mention quota, do not mention a 401, and above
  all do NOT tell the user to log in again or reconnect — their token is fine,
  the very same response just read their account. In that case fall back to the
  short user + org line and move on to GATE 2 without comment.
- **Do not volunteer the lens.** The response deliberately withholds the lens
  unless the user asked about it, so there is nothing to report. Don't reach
  for another tool to find it either. The lens shows up naturally at GATE 2.

# GATE 2 — "Pull today's leads"

**Explain first — this is where you teach the LENS.** Leadbay keeps a *lens*:
their description of who they sell to. Every day it goes and finds fresh
companies matching it. This click pulls today's batch.

**Why it's useful:** it replaces the hour spent digging through directories and
LinkedIn looking for someone worth calling — the list is already waiting, and
already scored, when they sit down. And it sharpens itself: the leads they
like, contact or skip teach the lens what a good fit looks like, so tomorrow's
batch lands closer than today's.

**Then fire the widget** — question `Now let's see today's leads. Ready?`, first option labelled `Pull today's leads`, description `Pull today's leads from your lens.` Second option: `I'm done for now` / `Stop the walkthrough here.` **Wait for the click.**

On click: call `leadbay_pull_leads` with **no arguments** (it resolves the
user's default lens itself).

Capture `lens.id` from the response and pass it as an explicit `lensId` on
every later call in this walkthrough, so gate 3 enriches the same lens the
user just looked at.

Render the batch with the canonical layout:

## RENDERING — markdown table, three columns, score-bar driven

Present the response as a markdown table **in the exact order the tool returned the leads** — this is the Discover-tab order (the backend orders by new-today first, then status, then score). Do **not** re-sort the rows (in particular, do NOT re-order by `score`); render them top-to-bottom as received so the list matches what the user sees in the Leadbay UI. Exactly three columns. Do not summarize in prose. Do not show the numeric score anywhere.

## Score-bar (10-segment, inline-code wrapped)

Wrap a 10-glyph bar in a SINGLE inline-code span (backticks). The inline-code styling is what gives the bar contrast in most chat renderers — HTML `<span>` is stripped inside table cells.

Glyphs (use these exact characters; do not substitute):

- `▰` — firmographic-only fill
- `❖` — AI-booster cap (placed at the RIGHT END of the filled run, never the front)
- `▱` — empty

Computation:

```
total_filled  = round(score / 10), clamped to 0..10
ai_segments   = round(qualification_summary.avg_qualification_boost / 3.3),
                clamped to [0, total_filled]
normal_filled = total_filled − ai_segments
bar = "▰" × normal_filled
    + "❖" × ai_segments
    + "▱" × (10 − total_filled)
```

If `qualification_summary.answered == 0` or `avg_qualification_boost` is null, set `ai_segments = 0` (no ❖). Always wrap the bar in backticks. Print the legend `` `▰` firmographic · `❖` AI booster cap · `▱` unfilled `` once below the table.


**Column 1 — Company**

- Line 1: the 10-segment score bar in inline-code backticks (see the score-bar snippet above for the algorithm).
- Insert `<br>` between lines.
- Line 2: linked company name + ` · ` + short location + ` · ` + compact size.
  - Link target: `website` (prefix `https://` if it's a bare hostname). Don't synthesize an app deep-link.
  - Location: shorten "City of New York" → "NYC"; otherwise "City ST"; state alone only when city missing.
  - Size: `"Xk+"` when `size.min >= 1000`, `"min–max"` otherwise.

**Column 2 — Why it fits**

- One sentence, ≤ 20 words.
- Synthesize from (in priority order, whichever is present) the lead's `short_description`, top 2 `tags[].display_name`, and the gist of `qualification_summary.best_response_excerpt`. The trim payload does NOT carry the longer `description` field — for that, agent must call `leadbay_research_lead_by_id` or `leadbay_research_lead_by_name_fuzzy`.
- Do NOT append `(boost N)` — the ❖ cap in column 1 already carries that signal.
- No bullet lists, no line breaks inside the cell.

**Column 3 — Contact**

`[Contact name](LINK) · short job title`. The `[Contact name](LINK)` markdown link wrapping is mandatory — never render the name as plain text. See linking/contact-linkedin for the URL priority (real profile → constructed people-search) and the °-flag fallback.

**Hide from the user (never include in any cell):** `id`, `location.pos`, `location.country` (unless city/state both missing), `sector_id`, `is_hq`, `web_fetch_in_progress`, `enrichment_in_progress`, `highlighted_fields`, `custom_fields`, `contacts_count` when 0, `notes_count` / `epilogue_actions_count` / `prospecting_actions_count` when 0, `stale_at`, `deal_insights`, `social_presence` booleans (except as the °-flag signal), `need_attention` flags, any field whose value is the string `"null"`.

## Linking a contact's name

**MANDATORY: every contact name in your output — table cells, prose, headers, "Reach <Name>" callouts — MUST be wrapped in markdown link syntax `[Name](URL)`. Never render a contact name as bare text. A plain-text name is a broken contact card; the underlined name is the user's primary affordance for "take me to this person's profile". No "no URL available" exception — the search URL below is always constructable from name + company.**

URL priority (first applicable wins):

1. **Real profile** — `contact.linkedin_page` when it's a string starting with `https://` (the MCP coerces the legacy literal `"null"` string to real null before you see it).
2. **Constructed people-search** — `https://www.linkedin.com/search/results/people/?keywords=<First>+<Last>+<Company>`. URL-encode params. Strip Inc / LLC / Corp / Ltd / GmbH / Co / S.A. / S.L. / PLC / AG / SAS / SARL suffixes from the company. Append a trailing ` °` to the rendered name ONLY when this fallback is in use AND `social_presence.linkedin == false`. Never append `°` when a real `linkedin_page` was used.

Never link a person's name to the company's LinkedIn page (and vice versa) — the two surfaces are different and conflating them quietly degrades the workflow.

## Linking the company

Use the lead's `website` as the company-name link target — prefix `https://` if the value is a bare hostname. (The MCP does NOT synthesize a Leadbay-app deep-link URL; the team has not standardized one. Linking to `website` is always real data.)

When the response carries `social_urls` (the post-fix multi-platform URL block on rich-lead responses), render every non-null platform as a pill chip in the company-info row. Iterate over `social_urls`'s keys — never hardcode a fixed list — and emit each as `[<platform-label>](<url>)`. Skip platforms whose URL is null.

`social_presence` carries booleans for the same 6 platforms (crunchbase, facebook, instagram, linkedin, tiktok, twitter) — useful when you only care that the company has a profile somewhere. Use it as the °-flag signal in the contact people-search fallback (see linking/contact-linkedin).



## Branch — the batch came back empty

A brand-new account often reads empty for the first minute while the backend
computes the lens wishlist. Check `computing_wishlist` / `computing_scores`:

- **Either is true** → the lens is still building. Say exactly that, in the
  user's terms: "your lens is still building your first batch — that's normal
  on a new account, it takes about a minute." The tool's `next_steps` payload
  carries a **two-option** warm-up widget ("Re-pull in ~30s" / "Refine
  audience") — render it VERBATIM. This is the ONE place a gate carries two
  options, because the server built the payload and a re-pull genuinely has a
  real alternative. On "Re-pull in ~30s", wait ~30s and return to GATE 2.
  **NEVER say "no leads found."**
- **Both false** → the lens is genuinely empty or too narrow, and `next_steps`
  is `null`. Say so honestly, offer to widen the audience, and end the
  walkthrough here. There is nothing to enrich.

# GATE 3 — "Enrich top leads"

**Explain first — teach what enrichment IS.** A company isn't a person: to
actually reach out they need a human. Leadbay can find *which roles* to
approach at these companies.

**Why it's useful:** they walk into the call knowing to ask for the operations
director by title, instead of pitching whoever answers the switchboard — the
difference between a conversation and a dead end.

Say plainly that the first look is **free**, and that actually revealing
contact details costs credits and needs their say-so.

**Then fire the widget** — question `Want to see who to contact at these companies?`, first option labelled `Enrich top leads`, description `See who to contact at the top leads. Free — no contact details revealed.` Second option: `I'm done for now` / `Stop the walkthrough here.` **Wait for the click.**

This gate runs in **TWO BEATS**. Do not collapse them.

## BEAT 1 — the free look (spends nothing)

On click: call `leadbay_enrich_titles` with `leadIds` = the lead ids from
GATE 2 and `lensId` = the pinned lens id.

**This call must spend NOTHING.** Omit `titles` entirely: that returns
`mode:"discover"`, the free preview of which job titles exist at those
companies. Do NOT pass `titles`, `confirm=true`, `email=true` or `phone=true`
on this call — any one of them launches the paid reveal before the user has
chosen anything.

Present the discovered titles and say plainly: "nothing spent yet."

## BEAT 2 — really enrich the ones they pick (spends credits)

Now ask them to **pick 2–3 leads to actually enrich**, and tell them the cost
BEFORE they choose: revealing contact details spends credits, roughly one per
contact revealed. Name the leads so the choice is concrete.

**Wait for an explicit pick + confirmation.** Silence is not consent, and
neither is "they clicked the gate earlier" — the gate click bought the free
look, not the reveal.

Once they've picked and confirmed, call `leadbay_enrich_titles` AGAIN with:
their chosen `leadIds`, the `titles` worth contacting, `confirm: true` and
`email: true`. That's the real, paid reveal.

It returns a `bulk_id` and runs async — poll `leadbay_bulk_enrich_status`
with that id (`include_contacts=true`) until `all_done`, or until the resolved
count plateaus across a few spaced polls. Then report the **actual contacts
found**: names, titles, and the emails/phones that came back. Some contacts
never resolve; say so honestly rather than implying a full house.

**Then explain what it cost** — one line, in plain terms: one credit per
contact revealed, so N contacts = N credits. This is the moment the quota
numbers from GATE 1 stop being abstract, because they just watched them move.
Don't turn it into a pricing pitch.

If they decline the reveal, that's fine — keep the free preview as the result
and move on to GATE 4 without pushing.

# GATE 4 — "Add these to my CRM"

**Explain first — teach the split.** Leadbay finds the leads; their CRM is
where they'll actually work them. If a CRM connector is available in this chat,
these companies can go straight in.

**Why it's useful:** no copy-pasting company names between two tabs, and the
leads land where their pipeline, their reminders and their team already live —
so a lead found here doesn't quietly die in a chat window.

Don't promise it works until you've checked your own tool set.

**Then fire the widget** — question `Want these leads in your CRM?`, first option labelled `Add these to my CRM`, description `Put these leads into your CRM, if a connector is available here.` Second option: `I'm done for now` / `Stop the walkthrough here.` **Wait for the click.**

**Call no Leadbay tool for this step.** Leadbay has no CRM integration — it
cannot push, export, or sync a lead anywhere. But YOU may be able to: many
users run a CRM connector alongside Leadbay in the same host, and that
connector is yours to call.

So: **check your own tool set for a CRM capability** — HubSpot, Salesforce,
Pipedrive, Attio, Close, or any similar CRM server. This is the same detection
you already do for outreach tooling: read the host's installed-connector /
installed-MCP inventory when it's available, otherwise infer from the
conversation, otherwise ask the user which CRM they use.

**If you have one**, use it to create or update the company and its contact
from the lead data already in hand. Pass what Leadbay gave you and nothing
invented: company name, website, city/region, the contact's name and job
title — plus any emails or phones the enrichment actually returned at GATE 3.
If the user declined the paid reveal, you have NO contact details: never write
one you did not receive. Report back what the
connector actually returned, per CRM record.

**If you have no CRM connector**, say so in one honest line, name which CRM
the user mentioned so the answer is theirs and not generic, and offer to pass
the request to the Leadbay team via `leadbay_report_friction` with
`category: "missing_capability"` — that is the real route for "I want my leads
in <CRM>". Do not describe a connector the user does not have as though they
could use it right now.

**Never claim a CRM record was created** unless the connector confirmed it.
Only the connector can create one — Leadbay cannot, and neither can a
description of the intent.

# GATE 5 — "Run this every morning"

**Explain first — close the loop.** Prospecting works when it's a habit, not a
one-off. The whole sequence they just ran can happen on its own every morning.

**Why it's useful:** prospecting is the first thing that slips on a busy week.
This removes the part that depends on remembering — the leads are simply there
when they open their laptop, the way an inbox is.

**Then fire the widget** — question `Want this to run on its own every morning?`, first option labelled `Run this every morning`, description `Set this up to run automatically every morning.` Second option: `I'm done for now` / `Stop the walkthrough here.` **Wait for the click.**

**Call no Leadbay tool for this step.** Leadbay has no scheduling API, and
there is no `leadbay_*` tool that creates a scheduled task. What this gate does
is hand control to YOUR host's own scheduling flow.

When the user selects this option, follow your host's scheduled-task flow from
the server instructions (it asks frequency, then time, then confirms). Do NOT
re-ask those questions yourself — that would put two competing scheduling flows
in one conversation. Name the task concretely, e.g. "Daily prospecting
check-in".

If your host exposes no scheduler at all, say so honestly in one line. Either
way: **never claim a scheduled task was created.** Only the host can create one.

# CLOSING — HAND THEM THE PHRASES

**The buttons disappear when this walkthrough ends.** If the tour stops without
telling the user what to *type*, they learned to click through a tutorial and
nothing about using Leadbay tomorrow. So close every completed walkthrough with
a short cheat-sheet: what they want → what they say.

Render the manifest's `keep_going` rows as a compact two-column markdown table,
titled something like **"Next time, just ask"**. Keep the phrases VERBATIM —
each one is taken from that tool's own trigger list, so it's a phrase that
genuinely routes. Do not invent extra rows, and do not reword the phrases into
something that sounds nicer but doesn't match.

| What you want | Just say |
|---|---|
| Today's fresh leads | "Show me today's leads" |
| Who to follow up with | "What should I follow up on" |
| The story on one company | "Research <Company>" |
| An email to a contact | "Draft outreach for <Contact>" |
| Change who you target | "Narrow the audience to <sector>" |
| Switch target audience | "Show me my lenses" |

Add one closing line in your own words: they don't need to remember exact
wording — plain language works, and this is just a starting point.

Then hand them the **setup guide** as one plain link, for the things the five
gates didn't cover — installing Leadbay on another machine, adding a teammate,
signing back in later:
<https://docs.leadbay.app/doc/leadbay-mcp/quickstart>

**Once, here, and nowhere else.** Never drop that link between gates: a link
mid-tour is an invitation to leave the thing they're in the middle of doing.

Show this cheat-sheet **once**, at the end. If the user abandons the
walkthrough early (they typed something off-script), skip it — they're already
off doing what they wanted, and a tutorial summary would interrupt.

# STOP

IRON LAW — the walkthrough never takes outbound action. Do not draft or send
outreach. Do not call `leadbay_report_outreach`.

Render this acknowledgment VERBATIM as the last line of your message:

```
STOP — awaiting user decision. I will not take any further action until you tell me what to do next.
```

Do not propose a next action. Do not call any more tools. Hand control back to the user.
