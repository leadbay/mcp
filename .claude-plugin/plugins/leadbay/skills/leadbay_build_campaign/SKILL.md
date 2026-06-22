---
name: leadbay_build_campaign
description: "Build a sales campaign from scratch in one guided flow: discover on the active lens, qualify and pick a cohort, enrich the contacts most likely to engage, save it via `leadbay_create_campaign`, then show a one-tap call/email view via `leadbay_campaign_call_sheet`. Trigger on \"build me a campaign\", \"set up a new campaign\", \"create a campaign from scratch\". WORK an existing campaign with `leadbay_work_campaign`; split leads across reps with `leadbay_setup_team_prospecting`."
---


## MEMORY

Before responding, glance at any `_meta.agent_memory.summary` returned by tool calls earlier in this session and reflect its top signals in your reasoning ("Filtering by your stated preference for healthcare"). After any material new signal from the user this conversation (sector, region, deal size, communication style, qualification rule, explicit retraction, or recurrence / scheduling preference such as "I do this every day" or "remind me every morning"), call `leadbay_agent_memory_capture` to persist it: `source:"user_stated"` if literal, `source:"inferred"` with confidence <=6 if inferred.


Build me a Leadbay campaign from scratch<if the user supplied this argument, render the short parenthetical or inline clause derived from it; otherwise empty. Source: Optional: a name for the campaign. Omit and one is derived from the lens/audience + date (or the backend AI-names it).>. <if the user supplied this argument, render the short block derived from it; otherwise empty. Source: Optional: a fresh audience to target (e.g. 'dental clinics in Texas'). Omit to build from your ACTIVE lens — the default.>

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


# PHASE 0 — STATE + AUDIENCE

Call `leadbay_account_status` to see my remaining quota, my **enrichment credits**, and my **active lens**. Note `web_fetch_remaining` (qualification budget) and the enrichment credit balance — Phase 3 spends credits.

Resolve the audience:

- **Default — use my active lens.** If I didn't name a fresh audience, the active lens IS the audience. Do NOT create a new lens.
- **Fresh-audience fork.** Only if I described a NEW audience the active lens doesn't already cover, set it up first: `leadbay_adjust_audience` for sector/size tweaks, or `leadbay_new_lens` to create a brand-new named lens — then continue on that lens. Do NOT silently overwrite my existing lens; confirm once before switching.

# PHASE 1 — DISCOVER

Call `leadbay_pull_leads` on the resolved lens. **Capture `response.lens.id` and pass it as an explicit `lensId` on every later call this session** — a mid-session lens shift would discard the cohort I'm about to pick. Render the batch with the canonical layout:

## RENDERING — markdown table, three columns, score-bar driven

Present the response as a markdown table sorted by `score` descending, with exactly three columns. Do not summarize in prose. Do not show the numeric score anywhere.

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



If the batch is thin (fewer than ~10 workable leads) or I ask for more depth, top it up: call `leadbay_bulk_qualify_leads({lensId:<captured>, count:<deficit, max 25>, wait_for_completion:false})`, poll `leadbay_qualify_status` until done, then re-pull with the same `lensId`. Never re-pull without `lensId`.

# PHASE 2 — PICK AN ICP CANDIDATE POOL

A campaign is only as good as the leads in it — AND only as good as whether each lead has a reachable BUYER (see Phase 3). So pick a **generous candidate pool** now, not the final cohort: aim for ~1.5× the target size of in-ICP leads (highest `ai_agent_lead_score`), so Phase 3 can drop any lead that turns out to have no buyer-persona contact and still hit the target. If the batch is short, top up via `leadbay_bulk_qualify_leads` / `leadbay_extend_lens`.

If I named specific leads, use those (but still apply the Phase 3 buyer-coverage check and tell me which lack a buyer). Otherwise recommend the pool and show it. Capture the candidate `leadIds`. Confirm the count ("12 candidates — I'll lock the final ~8 after checking each has a buyer"). Do NOT create the campaign yet — the final cohort is decided after Phase 3's coverage check.

# PHASE 3 — ENRICH THE RIGHT CONTACTS (load-bearing)

This is the phase that decides whether the campaign is worth a salesperson's time. Contacts aren't attached by default and enrichment is paid — so spend it ONLY on the people who would actually **buy what I sell**, not on whoever is most senior.

**Step A — work out MY buyer persona (do this before touching titles).**
Figure out what *I* sell and therefore who, inside the target company, owns the decision to buy it:

- Infer my product / value-prop from my context: my org and account (`leadbay_account_status`), and especially my lens's qualification criteria — the `qualification_summary` on the leads tells you *why* these companies are good targets for me, which implies what I'm offering them.
- Map value-prop → the **buying department/persona**, NOT seniority:
  - A sales / prospecting / lead-gen / outbound / marketing / GTM / revenue tool → the **revenue org**: VP / Head / Director of Sales, Business Development, Account/Carrier Sales, CRO, CMO / VP Marketing, Head of Growth / Demand Gen, RevOps. (This is Leadbay's own persona.)
  - An operations / logistics tool → operations leaders. A finance tool → finance. A dev tool → engineering. Etc.
  - **Company size caveat:** Founder / CEO / Owner is a real buyer at small companies (≤~50), but at larger ones they are not — there the functional leader (e.g. VP Sales) is the buyer.
- **State the persona in one line and confirm it with me** before spending (see Step C). I can correct it.

**ANTI-PATTERN — do NOT do this:** picking the most senior or most "decision-maker-sounding" title regardless of department. A Director of Operations, COO, Mgr of Logistics, CFO, or CTO will **never** buy a sales tool — enriching them wastes credits and hands me a useless list. Seniority is not the same as being my buyer.

**Step B — find the persona-matching, enrichable contacts.**
Call `leadbay_recall_ordered_titles({leadIds, lensId})` and `leadbay_enrich_titles({leadIds, lensId})` in **discovery mode** (no `titles`). These return previously-enriched titles, `title_suggestions`, `auto_included_titles`, `available_in_selection`, `enrichable_contacts`, and `credits_remaining`. Treat them as a **menu to filter against my persona — not the answer.** If past-enriched titles or suggestions are off-persona (e.g. operations roles for a sales tool), do NOT repeat them. Select the titles that match my buyer persona AND are actually enrichable.

**Step B.5 — coverage guarantee (lock the final cohort here).** A campaign where half the leads have no buyer is a failed campaign. So before enriching, determine for each candidate lead whether it actually has an **enrichable buyer-persona contact** — use the discovery data plus, where it's ambiguous, a quick `leadbay_research_lead_by_id` to see that lead's available contact titles. Then:

- **KEEP** candidates that have ≥1 enrichable buyer-persona contact.
- **SWAP OUT** candidates whose only contacts are off-persona (e.g. ops/dispatch/finance only) or who have no enrichable contact at all. Replace each with the **highest-`ai_agent_lead_score` in-ICP candidate** from the pool that DOES have a buyer, until the cohort hits the target size (default 20; here capped by the enrichment budget).
- **Do NOT trade ICP fit for coverage.** A lead with a buyer but weak ICP fit (low `ai_agent_lead_score`, a vertical that doesn't match what I sell) is still the wrong lead — coverage is a filter applied AFTER ICP, never a reason to admit an off-ICP company. The final cohort must be both high-ICP AND buyer-covered.
- If the lens genuinely can't supply enough buyer-ready, in-ICP leads, say so honestly and offer to widen/extend rather than padding the campaign with no-buyer leads OR with off-ICP ones.

Tell me what you swapped in one line ("dropped Corbett + RBS — ops-only; swapped in Acme + Globex which have Sales VPs"). The goal is a final cohort where EVERY lead has a real buyer to call.

**Step C — show the spend + persona and confirm.** State the persona, the chosen titles, and "You have {credits_remaining} credits; this enriches {enrichable_contacts} contacts." Confirm via `ask_user_input_v0` ("Enrich these {enrichable_contacts} <persona> contacts now?" → ["Yes, enrich", "No, skip", "Change the persona/titles"]). Never launch a paid run without this. Enrich up to the campaign size (default 20) best persona-matching contacts.

**Step D — launch + poll.** On yes: `leadbay_enrich_titles({leadIds, lensId, titles:[...chosen], email:true, phone:true})` to launch, then poll `leadbay_bulk_enrich_status` until done (enrichment can take several minutes — keep polling, don't render an empty sheet prematurely). Append one small line at the very end of your reply: `_(N credits remaining)_`.

If I skip enrichment, continue — the campaign can be enriched later from the call sheet.

# PHASE 4 — CREATE THE CAMPAIGN

Derive a name (`<lens or audience> – <today's date>`) or use the one I gave. Call `leadbay_create_campaign({name, lead_ids:<final buyer-ready cohort from Phase 3>})` — this creates AND seeds in one call. Seed the cohort you actually enriched buyers on, not the original raw pool. Confirm the returned campaign name + id in one line. (If I later ask to add more leads to it, that's `leadbay_add_leads_to_campaign`.)

# PHASE 5 — THE VIEW (call / email ready)

If you launched enrichment in Phase 3, **poll `leadbay_bulk_enrich_status` until it's actually done before rendering** — do not render a "still enriching" sheet with empty contact cells; the whole point is the landed phones/emails. Enrichment can take several minutes; keep polling.

Then call `leadbay_campaign_call_sheet({campaign_id})` and render it per its RENDERING block — one card per lead, contacts with `[phone](tel:)` + `[email](mailto:)` one-tap links, the readiness chip at the top, map optional. This is the view I work from: scan → tap to call → tap to email.

**Flag suspect contacts** so I don't email the wrong person blind: mark with ⚠ any enriched contact whose email domain doesn't match the company's website, or who shows up on more than one lead in this campaign (a sign of a mis-attributed enrichment). Keep the phone (it's usually still right) but tell me the email looks off.

# PHASE 6 — HANDOFF + STOP

The campaign exists and is call/email ready. End by offering, via `ask_user_input_v0`:

- "Start working it now" → run `leadbay_work_campaign` on this campaign (the calling/email session + outcome-logging loop).
- "See the pulse" → `leadbay_campaign_progression` for per-lead status.

Then STOP. Building a campaign is NOT outreaching — do not send anything and do not call `leadbay_report_outreach`. When I come back later to log calls, see previous statuses, and do follow-ups, that is `leadbay_work_campaign`, not this prompt.

# Iron laws

- Enrichment targets MY buyer persona — the people who would actually buy what *I* sell, derived from my product/ICP — NOT generic seniority. For a sales/prospecting tool that means the revenue org (sales / BD / growth / marketing leaders); a Director of Operations, COO, or logistics manager is useless no matter how senior. Get the persona right or the campaign is worthless.
- Selection is DATA-DRIVEN (`leadbay_recall_ordered_titles` + `leadbay_enrich_titles` discovery) but FILTERED to the persona — never blindly repeat past-enriched or suggested titles that don't match who buys my product.
- The FINAL cohort must be all buyer-ready: drop/swap any lead with no enrichable buyer-persona contact (Phase 3 Step B.5) rather than shipping it empty. A campaign where half the leads have no buyer to call is a failed campaign. Pick a generous pool in Phase 2 so swaps are possible.
- NEVER launch paid enrichment without showing `credits_remaining` + `enrichable_contacts`, naming the persona, and getting a yes.
- Qualify / pick BEFORE `leadbay_create_campaign` — never seed a campaign with unvetted leads.
- Carry the captured `lensId` on every call. A lens shift loses the cohort.
- End at the rendered call sheet, then hand off to `leadbay_work_campaign`. Do NOT re-implement the calling / follow-up loop here, and do NOT call `leadbay_report_outreach`.
