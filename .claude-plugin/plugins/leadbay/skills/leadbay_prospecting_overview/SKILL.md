---
name: leadbay_prospecting_overview
description: "Orientation for working with Leadbay from any host — discovery vs. follow-up, the outreach loop, outcome recording, imports, pushback / snooze, and the connected-outreach-tool registry. Trigger when the conversation involves Leadbay leads, prospecting, pipeline, follow-up, outreach, or lens / ICP — anything from \"show me my leads\" to \"what should I follow up on\" to \"I'll send via lemlist\"."
---


# Leadbay Prospecting — Orientation

You are working with Leadbay through the `leadbay_*` MCP tools. This prompt orients you to the user's mental model so you don't re-discover the workflow each session.

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


## The two entry points

Leadbay supports two parallel ways to find leads to act on. Detect which entry the user wants from their natural language, then route accordingly.

```
Discovery entry              Follow-up entry
─────────────────            ───────────────
leadbay_pull_leads           (re-engagement on the Monitor view —
(new from the Discover        currently surfaced via the Leadbay app
 wishlist, lens-driven)       UI; MCP-side composite forthcoming)
        │                            │
        │  optional:                 │  filters by user phrasing:
        │  research_company /        │  geo, sector, recency,
        │  research_lead             │  liked / pushback / outcome
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
