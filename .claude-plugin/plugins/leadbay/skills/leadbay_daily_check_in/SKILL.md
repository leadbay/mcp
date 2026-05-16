---
name: leadbay_daily_check_in
description: "Run the canonical daily check-in: see account state, pull a fresh batch, triage the top 10, deep-dive on every promising one, and offer contact enrichment. The user's typical morning workflow. Trigger when the user asks for \"leadbay leads\", \"best leads to prospect today\", \"what should I work on\", or anything resembling \"show me the day's batch\"."
---


Run the Leadbay daily check-in for me. Treat this prompt the same way for any equivalent ask: "get me leadbay leads", "best leads to prospect today", "what should I work on", "show me my batch".

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

# PHASE 3 — TRIAGE (top 10, motivational framing)

Pick the top **10** leads — prefer leads with a fresh `ai_agent_lead_score` (those have been newly AI-qualified); fall back to `score` only when `ai_agent_lead_score` is absent. For each, write ONE motivational sentence — framed as *why prospecting this lead today might be a good idea right now* (almost a coach's nudge, not a flat description). Lean on `qualification_summary` for the substance, but reframe — don't paste it verbatim.

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
