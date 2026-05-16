---
name: leadbay_daily_check_in
description: "Run the canonical daily check-in: account state, fresh batch, triage top 10, deep-dive every promising one, offer contact enrichment. The morning DISCOVERY workflow (new leads from the lens wishlist). Trigger on \"leadbay leads\", \"best NEW leads\", \"what's new today\", \"show me the day's batch\", \"let's prospect\". Do NOT trigger on follow-up phrasings (\"what should I follow up on\", \"before my trip\") — those go to `leadbay_followup_check_in`."
---


Run the Leadbay daily check-in for me. Treat this prompt the same way for any equivalent ask focused on NEW leads from the Discover wishlist: "get me leadbay leads", "best NEW leads to prospect today", "what's new today", "show me my batch", "let's prospect". For follow-up phrasings ("what should I follow up on", "leads I've already worked", "before my trip"), this is the wrong prompt — route to `leadbay_followup_check_in` instead. If the user's intent is ambiguous ("what should I work on?"), ASK once before picking an entry point.

# Resilience rules for Leadbay long-running tools

These four rules apply to every Leadbay workflow that calls `leadbay_pull_leads`, `leadbay_bulk_qualify_leads`, `leadbay_research_lead`, `leadbay_import_and_qualify`, or `leadbay_enrich_titles`. **Treat timeouts and stream-closed errors as transient, not as signals to replan.**

## Rule 1 — Pin the lens

After your first `leadbay_pull_leads` call, capture `response.lens.id` into your working memory and **pass it explicitly as the `lensId` argument to every subsequent call** in this session — including any re-pulls, bulk qualifies, or research calls that accept it. (Field-name caveat: the response nests it as `lens.id`; the parameter on subsequent calls is `lensId`.) The active lens can shift between calls (5-minute client cache + backend `last_requested_lens` can change if the user touches the web UI). A lens shift mid-workflow throws away your top-10 work.

## Rule 2 — Prefer async for bulk operations

`leadbay_bulk_qualify_leads` and `leadbay_import_and_qualify` accept `wait_for_completion:false`, which returns `{status:'running', qualify_id}` immediately. Then poll `leadbay_qualify_status` (or `leadbay_import_status`) every ~10s until the job completes. **Use the async pattern by default** — the blocking default can exceed the MCP client's per-call timeout on large batches and produce a misleading `"Request timed out"` even though the server is still working.

## Rule 3 — Serialize `leadbay_research_lead` fan-out

`leadbay_research_lead` is composite and reads many sub-resources. Calling it on 10 leads in parallel can saturate the transport and produce `"Tool permission stream closed"` errors that look like permission failures but are really backpressure. **Call it sequentially**, or at most 3 in parallel. If one call fails with a stream/timeout error, retry that one call once before moving on; on a second failure, note the lead and continue — do not abandon the remaining leads.

## Rule 4 — Retry, don't replan

If a Leadbay tool returns `"Request timed out"`, `"stream closed"`, or any other transport-level error (distinct from a Leadbay-issued error payload), the work may still be running server-side. Do this in order:

1. For bulk tools — retry with `wait_for_completion:false` and poll the status tool with the returned id. Don't re-pull leads; that can shift the lens.
2. For single-lead tools — retry the same call once. If it still fails, record the lead id and continue with the rest of the workflow.
3. **Do not** switch strategies (e.g. "the endpoint is broken, let me re-pull from scratch"). The earlier work is still valid; the timeout was the wire.

If `pull_leads` itself fails and you have no prior batch, then yes — retry it, explicitly pass the lensId you captured (if any), and continue.


# PHASE 0 — RESUME CHECK

If you're resuming an interrupted session (you see a previous Phase already completed in your task list, or the user says "continue" / "continue from where you left off"), do NOT restart from Phase 1. Re-read the active `lensId` and your last completed phase from prior context, then resume from the next phase. If you genuinely have no state, restart from Phase 1.

# PHASE 1 — STATE
Call `leadbay_account_status` to see what quota I have left and which lens is active. Note the remaining `ai_rescore_remaining` and `web_fetch_remaining` budgets — Phase 4 enrichment depends on them.

# PHASE 2 — FRESH BATCH
Call `leadbay_pull_leads` to get today's fresh batch. Capture `response.lens.id` (the response nests it under `lens`). **Use it as an explicit `lensId` argument on every subsequent Leadbay call this session** — including any re-pulls, bulk qualifies, or research calls that accept it. (See Rule 1 above — a mid-session lens shift discards your top-10 work.)

# PHASE 3 — TRIAGE (top 10, table + nudges)

Render the **top 10 leads** using the canonical `leadbay_pull_leads` layout:

GATE — DEFER TO TOOL RENDERING. When you call a Leadbay composite that ships its own RENDERING block (every composite in 0.9.0+ does), render the response using that block's recipe verbatim — score bars, glyph palette, column order, hide-list, link priorities, all of it. Do NOT substitute prose, a numbered list, or a different column structure even when an orchestrating prompt's body suggests alternate framing. Prompt-specific commentary (motivational nudges, summaries, next-action recommendations) belongs ABOVE or BELOW the canonical table, never in place of it.

If the prompt's body and the tool's RENDERING appear to conflict, the tool's RENDERING wins for the structural layout; the prompt's voice wins for the commentary that surrounds it.


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
- Synthesize from (in priority order, whichever is present) the lead's `short_description`, top 2 `tags[].display_name`, and the gist of `qualification_summary.best_response_excerpt`. The trim payload does NOT carry the longer `description` field — for that, agent must call `leadbay_research_lead` or `leadbay_research_company`.
- Do NOT append `(boost N)` — the ❖ cap in column 1 already carries that signal.
- No bullet lists, no line breaks inside the cell.

**Column 3 — Contact**

`[Contact name](LINK) · short job title`. See linking/contact-linkedin for LINK priority and the °-flag fallback.

**Hide from the user (never include in any cell):** `id`, `location.pos`, `location.country` (unless city/state both missing), `sector_id`, `is_hq`, `web_fetch_in_progress`, `enrichment_in_progress`, `highlighted_fields`, `custom_fields`, `contacts_count` when 0, `notes_count` / `epilogue_actions_count` / `prospecting_actions_count` when 0, `stale_at`, `deal_insights`, `social_presence` booleans (except as the °-flag signal), `need_attention` flags, any field whose value is the string `"null"`.

## Linking a contact's name

Two LinkedIn URLs exist and must never be conflated: the **company's** LinkedIn page and an **individual person's** profile.

When the response carries a real contact LinkedIn URL — `contact.linkedin_page` is a string that starts with `https://` (the MCP coerces the legacy literal `"null"` string to real null before you see it) — link the contact's name to that URL.

Otherwise fall back to a LinkedIn people-search URL:

```
https://www.linkedin.com/search/results/people/?keywords=<First>+<Last>+<Company>
```

URL-encode the params. Strip Inc / LLC / Corp / Ltd / GmbH suffixes from the company name. Append a trailing ` °` to the rendered name ONLY when the fallback is in use AND `social_presence.linkedin == false` (no company LinkedIn → search may not resolve). Never append `°` when a real `linkedin_page` was used.

Never link a person's name to the company's LinkedIn page (and vice versa). The two surfaces are different — conflating them quietly degrades the workflow.

## Linking the company

Use the lead's `website` as the company-name link target — prefix `https://` if the value is a bare hostname. (The MCP does NOT synthesize a Leadbay-app deep-link URL; the team has not standardized one. Linking to `website` is always real data.)

When the response carries `social_urls` (the post-fix multi-platform URL block on rich-lead responses), render every non-null platform as a pill chip in the company-info row. Iterate over `social_urls`'s keys — never hardcode a fixed list — and emit each as `[<platform-label>](<url>)`. Skip platforms whose URL is null.

`social_presence` carries booleans for the same 6 platforms (crunchbase, facebook, instagram, linkedin, tiktok, twitter) — useful when you only care that the company has a profile somewhere. Use it as the °-flag signal in the contact people-search fallback (see linking/contact-linkedin).



ABOVE the table, add a 2–4 sentence "Today's nudges" paragraph for the 3 most-promising rows. The nudges speak to urgency / opportunity / freshness — what makes acting on these RIGHT NOW the right call. Do NOT repeat the "why it fits" column from the table; the nudges should add fresh framing the table doesn't carry (e.g., recent news from the `qualification_summary` excerpt, a window closing, a competitor activity the user mentioned earlier in the session). One sentence per nudge, salesperson voice, not coachspeak.

If the batch returns fewer than 10 qualified leads, top it up: call `leadbay_bulk_qualify_leads` with `lensId:<captured>`, `count:<1.5x deficit, capped at 25>`, and **`wait_for_completion:false`**. Capture `qualify_id` from the response and poll `leadbay_qualify_status` every ~10s until `status:'done'`. Then re-pull with the same `lensId` to pick up the newly qualified leads. **Never re-pull without `lensId` — you will lose your batch to a lens shift.** (The `leadbay_qualify_top_n` slash-prompt wraps this same tool with a friendlier surface for users; agents should call the underlying tool directly here.)

# PHASE 4 — DEEP DIVE (every promising lead)

Call `leadbay_research_lead` on **every** lead from your top 10 that the user might realistically prospect today (filter out clearly weak fits if any). Don't pick just one. **Call it sequentially** — one at a time, or batches of at most 3 in parallel. Do not fire 10 in parallel — it triggers transport backpressure that surfaces as `"Tool permission stream closed"` errors (see Rule 3 above). If a call fails, retry that single lead once; if the retry also fails, note the lead id and continue. Report Phase 4 results even if 1–2 leads were unresearchable.

For each researched lead surface:
- what makes it promising (1–2 sentences citing signals from the research)
- the **recommended contacts** the research returns — name, title, why they're the right starting point

Then ASK the user (don't auto-run): "Want me to enrich the contacts on these leads to acquire their emails / phone numbers?" If the user says yes, call `leadbay_enrich_contacts` for the relevant lead IDs (this consumes enrichment quota — that's why we ask first).

# GATE — STOP

IRON LAW — DO NOT TAKE OUTBOUND ACTION. Do not call `leadbay_report_outreach`. Do not draft an outreach message into a tool argument. Outreach is the user's call after they've reviewed your research.

Render this acknowledgment VERBATIM as the last line of your message:

```
STOP — awaiting user decision. I will not take any further action until you tell me what to do next.
```

Do not propose a next action. Do not call any more tools. Hand control back to the user.
