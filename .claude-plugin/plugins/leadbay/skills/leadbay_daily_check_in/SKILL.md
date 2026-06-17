---
name: leadbay_daily_check_in
description: "Morning DISCOVERY workflow — new leads from the lens wishlist. Trigger on \"show me leads\", \"what's new today\", \"let's prospect\", \"run my check-in\", \"my morning check-in\", \"I do this every day\", \"every morning\". Recurrence language always means this prompt. Do NOT trigger on follow-up phrasings (\"follow up\", \"before my trip\") — those go to `leadbay_followup_check_in`."
---


## MEMORY

Before responding, glance at any `_meta.agent_memory.summary` returned by tool calls earlier in this session and reflect its top signals in your reasoning ("Filtering by your stated preference for healthcare"). After any material new signal from the user this conversation (sector, region, deal size, communication style, qualification rule, explicit retraction, or recurrence / scheduling preference such as "I do this every day" or "remind me every morning"), call `leadbay_agent_memory_capture` to persist it: `source:"user_stated"` if literal, `source:"inferred"` with confidence <=6 if inferred.


Run the Leadbay daily check-in for me. Treat this prompt the same way for any equivalent ask focused on NEW leads from the Discover wishlist: "get me leadbay leads", "best NEW leads to prospect today", "what's new today", "show me my batch", "let's prospect", "run my morning check-in", "my daily routine", "I do this every day", "every morning". For follow-up phrasings ("what should I follow up on", "leads I've already worked", "before my trip"), this is the wrong prompt — route to `leadbay_followup_check_in` instead. **Recurrence language ("I do this every day", "every morning", "my routine") always means this prompt — it is a daily batch check-in, not a follow-up.** If the user's intent is ambiguous ("what should I work on?"), ASK once before picking an entry point.

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



ABOVE the table, add a 2–4 sentence "Today's nudges" paragraph for the 3 most-promising rows. The nudges speak to urgency / opportunity / freshness — what makes acting on these RIGHT NOW the right call. Do NOT repeat the "why it fits" column from the table; the nudges should add fresh framing the table doesn't carry (e.g., recent news from the `qualification_summary` excerpt, a window closing, a competitor activity the user mentioned earlier in the session). One sentence per nudge, salesperson voice, not coachspeak.

If the batch returns fewer than 10 qualified leads, top it up: call `leadbay_bulk_qualify_leads` with `lensId:<captured>`, `count:<1.5x deficit, capped at 25>`, and **`wait_for_completion:false`**. Capture `qualify_id` from the response and poll `leadbay_qualify_status` every ~10s until `status:'done'`. Then re-pull with the same `lensId` to pick up the newly qualified leads. **Never re-pull without `lensId` — you will lose your batch to a lens shift.** (The `leadbay_qualify_top_n` slash-prompt wraps this same tool with a friendlier surface for users; agents should call the underlying tool directly here.)

# PHASE 4 — DEEP DIVE (every promising lead)

**Skip Phase 4 if the user's request is primarily to view the batch** (e.g., "show me today's leads", "run my morning check-in", "what's in my inbox") — proceed directly to NEXT STEPS. Run Phase 4 when the user explicitly asks to research leads, names a specific company, or says "and then research" / "deep dive" / "tell me more about".

Call `leadbay_research_lead_by_id` on **every** lead from your top 10 that the user might realistically prospect today (filter out clearly weak fits if any). Don't pick just one. **Call it sequentially** — one at a time, or batches of at most 3 in parallel. Do not fire 10 in parallel — it triggers transport backpressure that surfaces as `"Tool permission stream closed"` errors (see Rule 3 above). If a call fails, retry that single lead once; if the retry also fails, note the lead id and continue. Report Phase 4 results even if 1–2 leads were unresearchable.

For each researched lead surface:
- what makes it promising (1–2 sentences citing signals from the research)
- the **recommended contacts** the research returns — name, title, why they're the right starting point

Contact enrichment is offered in the NEXT STEPS widget below — do NOT emit a separate prose question here. The widget handles the enrichment offer as one of the selectable options. If the user selects enrichment, call `leadbay_enrich_contacts({leadId, contactId})` ONCE PER CONTACT — the tool takes a single leadId + contactId, never a list. (For bulk title/seniority enrichment across many leads at once, use `leadbay_enrich_titles({leadIds: [...]})` instead.) This consumes enrichment quota.

# NEXT STEPS

**Sequential request gate:** If the user's original message contained the literal phrase "and then" (e.g., "show me X and then do Y"), and all stated actions have been completed this turn, skip the NEXT STEPS widget entirely and emit STOP directly. The user stated their full plan; they do not need a "what next?" prompt.
- Skip example: "Show me today's leads and then research the top one for me." → after research completes, go directly to STOP without any widget.
- Do NOT skip for: plain single-action requests ("show me today's leads"), recurring requests ("I do this every day"), or multi-step workflows the user didn't pre-specify.

**REQUIRED OPTIONS — triggers and position rules:**
- **Recurring language** ("every day", "every morning", "I do this every", "remind me", "automate this", "recurring"): add "Schedule 'Daily prospecting check-in' as a recurring task" and place it **first**.
- **≥5 leads returned**: add "Build an interactive lead triage board for this batch" and place it **first** (or second if the scheduling offer above also applies). This holds **even when the batch is a poor fit** (e.g. every lead AI-scored as off-ICP / a vertical mismatch): the triage board is still the first artifact option because the user asked to see and act on *this batch*. When the batch is a mismatch, ALSO offer "Refine the audience / lens so future batches fit better" — but as a *later* option, never displacing the triage board from first. Leading with audience-refinement instead of the artifact is a contract violation: surface the mismatch in your prose nudge, not by demoting the triage board.

## NEXT STEPS — after rendering the pull_leads table

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



Pick 2–3 items below based on what was actually observed in the response. The table is the source of truth for which moves are valid.

| Observation                                                | Suggest                                                      | Calls                                                  |
|------------------------------------------------------------|--------------------------------------------------------------|--------------------------------------------------------|
| ≥ 5 leads returned (any batch)                             | "Build an interactive lead triage board for this batch"      | emit antArtifact from data in hand (do NOT re-call leadbay_pull_leads) |
| `has_more == true`                                         | "Pull the next page (page N+1 of M)"                         | leadbay_pull_leads(page = current + 1, lensId = pinned)|
| ≥ 3 rows have `qualification_summary.answered == 0`        | "Deepen AI qualification on the rows without ❖ caps"         | leadbay_bulk_qualify_leads(leadIds=[…])                |
| User points at a single row                                | "Research [Company] in depth"                                | leadbay_research_lead_by_id(leadId)                    |
| User only has a name (no leadId in context)                | "Look up [Company] by name"                                  | leadbay_research_lead_by_name_fuzzy(companyName)       |
| Top row has phone AND email                                | "Prepare an outreach for [Contact] — call + email"           | leadbay_prepare_outreach(leadId)                       |
| Top row has email but no phone                             | "Draft an outreach email for [Contact]"                      | leadbay_prepare_outreach(leadId)                       |
| Top row has phone but no email                             | "Show [Contact]'s call details + a 60-second opener"         | leadbay_prepare_outreach(leadId)                       |
| Top row has contacts but no phone/email                    | "Order contact enrichment to surface email/phone first"      | leadbay_enrich_titles(...) or leadbay_prepare_outreach(leadId, enrich:true) |
| `computing_scores == true` or `computing_wishlist == true` | "Scores are still being computed — re-pull in ~30s"          | leadbay_pull_leads (retry with same lensId)            |
| User wants a narrower / wider audience                     | "Adjust the lens filters (sector / size)"                    | leadbay_adjust_audience(...)                           |
| Phase 4 research was run (`research_lead_by_id` called) AND top contacts lack direct email/phone | "Enrich contacts on [Lead1], [Lead2] to get direct emails and phone numbers" | leadbay_enrich_contacts(leadId, contactId) — ONE call per contact (the tool takes a single leadId + contactId, never a list) |
If nothing in the menu applies cleanly, suggest only "pull next page" and "research a specific lead in depth" — never invent a tool that doesn't exist.


**Final ordering check (do this before rendering):** Recurring offer → option 1; triage board → option 1 (or 2 if scheduling is also required). A poor-fit / mismatched batch does NOT change this — triage board stays first, refine-audience goes later in the list. Swap if needed.

# GATE — STOP

IRON LAW — DO NOT TAKE OUTBOUND ACTION. Do not call `leadbay_report_outreach`. Do not draft an outreach message into a tool argument. Outreach is the user's call after they've reviewed your research.

Render this acknowledgment VERBATIM as the last line of your message:

```
STOP — awaiting user decision. I will not take any further action until you tell me what to do next.
```

Do not propose a next action. Do not call any more tools. Hand control back to the user.
