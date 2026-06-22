---
name: leadbay_prospecting_overview
description: "Orientation for working with Leadbay from any host — discovery vs. follow-up, the outreach loop, outcome recording, imports, pushback / snooze, and the connected-outreach-tool registry. Trigger when the conversation involves Leadbay leads, prospecting, pipeline, follow-up, outreach, or lens / ICP — anything from \"show me my leads\" to \"what should I follow up on\" to \"I'll send via lemlist\"."
---


## MEMORY

Before responding, glance at any `_meta.agent_memory.summary` returned by tool calls earlier in this session and reflect its top signals in your reasoning ("Filtering by your stated preference for healthcare"). After any material new signal from the user this conversation (sector, region, deal size, communication style, qualification rule, explicit retraction, or recurrence / scheduling preference such as "I do this every day" or "remind me every morning"), call `leadbay_agent_memory_capture` to persist it: `source:"user_stated"` if literal, `source:"inferred"` with confidence <=6 if inferred.


# Leadbay Prospecting — Orientation

You are working with Leadbay through the `leadbay_*` MCP tools. This prompt orients you to the user's mental model so you don't re-discover the workflow each session.

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


## The two entry points

Leadbay supports two parallel ways to find leads to act on. Detect which entry the user wants from their natural language, then route accordingly.

```
Discovery entry              Follow-up entry
─────────────────            ───────────────
leadbay_pull_leads           leadbay_pull_followups
(new from the Discover        (re-engagement on the
 wishlist, lens-driven)        Monitor view of known leads)
        │                            │
   wrapped by:                   wrapped by:
leadbay_daily_check_in      leadbay_followup_check_in
        │                            │
        │  optional:                 │  filters by user phrasing:
        │  research_lead_by_name_fuzzy /  │  geo, sector, recency,
        │  research_lead_by_id        │  liked / pushback / outcome
        │  (deepen profile)          │
        └───────────┬────────────────┘
                    ▼
            leadbay_prepare_outreach
            (single-contact brief)
                    │
                    ▼
            user does outreach
            (agent drafts email / call / DM)
                    │
                    ▼
            leadbay_report_outreach
            (close the loop — verification + outcome)
```

**Discovery signals**: "show me my leads", "what's new today", "any new prospects", "let's prospect", no mention of prior context. Route to `leadbay_pull_leads`.

**Follow-up signals**: "what should I follow up on", "leads I haven't contacted", "leads in [city]", "before my trip", "this week", "this month", "what's overdue", explicit mention of recent or pending actions. Route to `leadbay_pull_followups` — the Monitor view of known leads. Apply `set_filter` for geo / sector / recency / action-type refinement; the filter is server-persisted across sessions.

When in doubt, ask. The two paths return overlapping but differently-ranked data; presenting the wrong one wastes the user's time.

**Routing the user's first message to an entry point (orchestrator prompts):**

- "give me leads", "what's new", "let's prospect", "today's batch", "best NEW leads" → `leadbay_daily_check_in` (Discovery orchestrator — wraps `leadbay_pull_leads`)
- "follow up", "already known", "leads I should contact", "before my trip", "this week", "what's overdue", "re-engage" → `leadbay_followup_check_in` (Follow-up orchestrator — wraps `leadbay_pull_followups`)
- Ambiguous ("what should I work on?") → ASK once: "Looking for NEW leads from your wishlist, or follow-ups on leads you've already worked?"

Never call `leadbay_pull_leads` directly for a follow-up query. Never call `leadbay_pull_followups` for a discovery query. The two tools read from different backend tables; iterating pages of one to fake the other is a known failure mode (see the anti-confusion guardrail in `pull_followups`'s description).

## The outreach loop

After `leadbay_prepare_outreach` returns a brief, the agent drafts. Adapt to the user's connected outreach tools — these change the draft idiom:

| Tool                | Channel strength                          | Draft idiom                                             |
|---------------------|-------------------------------------------|---------------------------------------------------------|
| **Lemlist**         | Email + LinkedIn + WhatsApp + cold call   | Sequence step (subject + body + step-N timing)          |
| **Outreach.io**     | Email + call cadence                      | Sequence step; surface intent signals for forecasting   |
| **Salesloft**       | Email + call + LinkedIn cadence           | Cadence step; pair with deal context if available       |
| **Apollo**          | Email-first                               | Clean cold email; include prospect signal references    |
| **HubSpot Sales Hub** | Email + tasks                           | HubSpot sequence email; recommend a task type           |
| **Instantly**       | Email at scale                            | Deliverability-conscious email (<80 words, no link spam)|
| **Attio**           | Email + LinkedIn from CRM                 | Outreach record on the Attio person; reference the deal |
| **Amplemarket**     | 7 channels (email/LI/call/SMS/WA/voice/video) | Per-channel variants; suggest the strongest channel |
| **Generic / Gmail / Outlook** | Email                           | Clean copy-paste email; no tool-specific syntax         |

**Detect the active tool** in this priority order:
1. The host's installed-connector / installed-MCP inventory, when available (Claude Desktop, Cowork).
2. The conversation — what tools has the user mentioned or used recently? ("I'll send via lemlist" → assume lemlist.)
3. Ask the user when uncertain.

## The outcome / closing-the-loop habit

IRON LAW — OUTCOME AFTER OUTREACH. The moment the user reports outreach happened ("I sent it", "she didn't pick up", "left a voicemail", "they replied", a forwarded email thread, a calendar invite), you MUST (1) call leadbay_report_outreach with verification (gmail_message_id, calendar_event_id, or the user's literal one-sentence confirmation as user_confirmed.ref) AND (2) ask the user about the outcome and set epilogue_status to one of the 4 canonical values: EPILOGUE_INTEREST_VALIDATED_OR_MEETING_PLANED ("Meeting booked"), EPILOGUE_COULD_NOT_REACH_STILL_TRYING ("Trying to reach"), EPILOGUE_NOT_INTERESTED_LOST ("Not interested"), EPILOGUE_STILL_CHASING ("In progress"). Use the user-facing labels in dialogue ("What's the outcome — meeting booked, trying to reach, not interested, or in progress?"); never say "epilogue" out loud. Skipping this step silently de-ranks every future follow-up suggestion because pull_followups depends on honest, current outcomes.


User-facing dialogue:

- **Always say "outcome", never "epilogue"** — the backend field is `epilogue_status` of type `EpilogueStatusType` but that's wire-format jargon. The 4 user-facing labels:
  - `EPILOGUE_INTEREST_VALIDATED_OR_MEETING_PLANED` → **Meeting booked** 🎯
  - `EPILOGUE_COULD_NOT_REACH_STILL_TRYING` → **Trying to reach** ⚡
  - `EPILOGUE_NOT_INTERESTED_LOST` → **Not interested** ❄
  - `EPILOGUE_STILL_CHASING` → **In progress** 🟢
- **Always say "follow-ups", never "Monitor"** — "Monitor" is internal app jargon; salespeople say "follow-ups".

## "Not now" / snooze / pushback

When the user says "not now", "next quarter", "follow up in 3 / 6 / 12 months", "next year", etc., this is a **pushback** action (not a note). Call `leadbay_set_pushback({lead_ids, status})` where `status` is `3`, `6`, or `12` (months). The lead drops out of `leadbay_pull_followups` until the window expires. Use `leadbay_remove_pushback` to revive a lead ahead of expiry. User-facing dialogue: say "snooze for N months", not "pushback".

## Imports

When the user mentions a CSV / list / their CRM, use the **`leadbay_import_file`** prompt — it walks through scan → resolve → preserve → commit. The single-shot tool `leadbay_import_leads` is for clean, mechanical imports; the prompt handles messy ones.

## AI scoring on the daily batch

Roughly the **top 10** of every `leadbay_pull_leads` response carry full AI qualification (`qualification_summary.answered > 0`, `ai_agent_lead_score`, ❖ caps in the rendered bar). Leads below the top ~10 are NOT worse — the system is saving resources. A healthy daily rhythm: bulk-qualify the rows WITHOUT ❖ caps so tomorrow's top-10 is richer. Use `leadbay_bulk_qualify_leads([leadIds])` for this; default to `wait_for_completion:false` for any count > 5.

## Lens pinning

After your first `leadbay_pull_leads` call, capture `response.lens.id` (the response nests it under `lens`) and pass it explicitly as the `lensId` argument to every subsequent Leadbay call this session. Lens shifts mid-workflow throw away your prior batch — see Rule 1 in the long-running-tools heuristics above.

## What to read once you've matched intent

You don't need to memorize every tool here — each tool's own description carries a RENDERING block (how to present the response) and a NEXT STEPS block (observation → suggestion table). Read the relevant tool's description in full when the user picks an entry point. This overview just gets you to the right starting tool.

## Proposing a next step — only when it genuinely helps

After reporting account state, you MAY propose a concrete next step — but only when one is genuinely useful, not by reflex. A reflexive "want me to also…?" on every turn is noise; the user notices and it erodes trust.

**Propose a next step when** the overview surfaced an obvious unfinished thread or a blocker the user would want resolved — a fresh discovery batch waiting, follow-ups due today, or a quota/auth blocker with a specific unblock action. In those cases the next move is real and worth offering.

**Skip it when** there's no clear unfinished thread, the user only wanted the status (a bare "where do I stand?"), or the work they asked for is plainly done. A status read that ends cleanly is a complete answer — don't manufacture a next step just to have one.

**Lean on memory.** Check the `_meta.agent_memory.summary` for prior signal on how this user reacts to next-step offers. If the memory shows they routinely dismiss them, default to NOT proposing (let them ask). If they routinely act on them, lean toward proposing. When the user dismisses or accepts a proposal this turn, that's a material signal — call `leadbay_agent_memory_capture` (`source:"inferred"`, low confidence) so the preference compounds across sessions.

**When you do propose, the proposal IS a native choice dialog — never a prose "let me know if…".** Route 2–4 mutually-exclusive next moves into your host's next-step widget (`ask_user_input_v0` on Claude chat / ChatGPT, `AskUserQuestion` on Claude cowork / Claude Code). The widget is the question; do not also list the same options as prose.

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



The overview itself returns no `next_steps` object, so when you DO propose, build the options from this table — pick the 2–4 rows that match what the account state actually showed. If none apply cleanly, propose none (the status read was complete) rather than inventing an option.

All `Calls` below are agent-callable `leadbay_*` tools (never an MCP prompt name like `leadbay_daily_check_in` — the agent cannot invoke a prompt from a turn; route to the underlying tool instead).

| Observation                                                         | Suggest                                                | Calls                                                        |
|---------------------------------------------------------------------|--------------------------------------------------------|--------------------------------------------------------------|
| Fresh discovery batch waiting / user wants new leads                | "See today's best new leads"                           | leadbay_pull_leads(lensId = pinned)                          |
| Follow-ups due / known leads to re-engage                           | "Show follow-ups due now"                              | leadbay_pull_followups                                       |
| Quota/credit read shows low or exhausted balance                    | "Review what's eating your quota"                      | leadbay_account_status (deeper read)                         |
| Auth/connection blocker (e.g. 401 / AUTH_EXPIRED on a read)         | "Reconnect Leadbay to unblock actions"                 | (guide the user to re-authenticate — no tool call)           |
| Lens audience looks mismatched (batch is off-ICP)                   | "Adjust the lens audience to match your ICP"           | ASK first — collect the target sectors / sizes / exclusions, THEN leadbay_adjust_audience(...) with those params. NEVER call it with no args (an empty call writes the current filter / may clone the default lens — a no-op or unwanted change). |
| Status is healthy and nothing is pending                            | propose nothing — the overview is a complete answer    | —                                                            |

GATE — DEFER TO TOOL RENDERING. When you call a Leadbay composite that ships its own RENDERING block (every composite in 0.9.0+ does), render the response using that block's recipe verbatim — score bars, glyph palette, column order, hide-list, link priorities, all of it. Do NOT substitute prose, a numbered list, or a different column structure even when an orchestrating prompt's body suggests alternate framing. Prompt-specific commentary (motivational nudges, summaries, next-action recommendations) belongs ABOVE or BELOW the canonical table, never in place of it.

If the prompt's body and the tool's RENDERING appear to conflict, the tool's RENDERING wins for the structural layout; the prompt's voice wins for the commentary that surrounds it.
