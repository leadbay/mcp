---
name: leadbay_schedule_weekly_arc
description: "Set up a WEEKLY scheduled run of the full outreach arc. Captures day/time + timezone, lead count, and an unattended enrichment credit ceiling, reads `leadbay_account_status`, then EMITS a copy-pasteable host `/schedule` cron artefact that runs `leadbay_weekly_outreach_arc` — DRAFT-ONLY. Trigger on \"schedule my weekly outreach\", \"run the arc every week\". Does NOT install host cron or run the arc — it emits the block the host's scheduler runs. The scheduled run drafts; I review and send myself."
---


## MEMORY

Before responding, glance at any `_meta.agent_memory.summary` returned by tool calls earlier in this session and reflect its top signals in your reasoning ("Filtering by your stated preference for healthcare"). After any material new signal from the user this conversation (sector, region, deal size, communication style, qualification rule, explicit retraction, or recurrence / scheduling preference such as "I do this every day" or "remind me every morning"), call `leadbay_agent_memory_capture` to persist it: `source:"user_stated"` if literal, `source:"inferred"` with confidence <=6 if inferred.


Set up my Leadbay weekly outreach arc as a recurring scheduled task<the value derived from "day" (phrase). Source: Optional: day of week to run (e.g. 'Monday'). Default Monday.>. I want it to run the full arc every week and leave me drafts to review and send.

# PHASE 1 — CONFIRM THE SCHEDULE

Collect (via your host's choice widget, ≤3 questions — don't prose-ask if a widget exists):

1. **Day + time + timezone** — default **Monday 08:00**; you MUST confirm the timezone (IANA, e.g. `Europe/Paris`) so cron fires at my local hour, not UTC.
2. **Lead count per run** — default **50**.
3. **Unattended enrichment credit ceiling** — "How many enrichment credits may the scheduled run spend per week without asking? (it runs while you're away.)" This bounds Phase 3 of the arc on unattended runs. Default to a conservative cap and let me change it.

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



# PHASE 2 — GROUND IT IN MY ACCOUNT

Call `leadbay_account_status` **once** to read my **active lens name** and current **enrichment credit balance**. Surface them so the artefact is grounded: "You have {credits_remaining} credits; the cap is set to {cap}/week. Active lens: {lens name}." Do NOT pull leads, qualify, or enrich — this prompt only schedules.

# PHASE 3 — MAP THE SCHEDULE TO A CRON EXPRESSION

Cron is `minute hour * * day-of-week`. Day-of-week mapping:

| Day | Sun | Mon | Tue | Wed | Thu | Fri | Sat |
|---|---|---|---|---|---|---|---|
| Number | 0 | 1 | 2 | 3 | 4 | 5 | 6 |

So **Monday 08:00 → `0 8 * * 1`**; Wednesday 17:30 → `30 17 * * 3`. Build the expression from the confirmed day + time.

# PHASE 4 — EMIT THE ARTEFACT

Emit this **copy-pasteable** block (fill the bracketed values from Phases 1–3; keep the DRAFT-ONLY constraint and the credit ceiling verbatim in the `--prompt`):

````
Copy-paste this into Claude Code to schedule your weekly arc:

/schedule create \
  --name "Leadbay weekly outreach arc" \
  --cron "0 8 * * 1" \
  --timezone "Europe/Paris" \
  --prompt "Run leadbay_weekly_outreach_arc with count=50 on my active lens (\"<Lens name>\"). DRAFT ONLY — produce message_compose_v1 Gmail drafts and STOP; do not send and do not call leadbay_report_outreach. Unattended enrichment credit ceiling: <cap> this run; if persona enrichment would exceed it, skip enrichment and draft from existing contacts. When done, leave the drafts in the composer and notify me to review and send."

Cron: every Monday 08:00 Europe/Paris · drafts only, never sends.
After it runs you'll have ~50 Gmail drafts waiting — review, edit, and send them yourself.
````

If the host uses `ScheduleWakeup` / a routines skill instead of `/schedule create`, emit the equivalent one-liner with the **same cron** and the **same draft-only prompt** — so the artefact degrades gracefully across hosts.

# PHASE 5 — ACTIVATE + STOP

Tell me plainly: **"I can't install the host scheduler from inside Leadbay myself.** To activate this, run the `/schedule create` command above in Claude Code — or say 'go ahead' and I'll run it for you." Then offer, via your host's choice widget:

- "Run it once now (preview)" → invoke `leadbay_weekly_outreach_arc` so I can see one run before committing to the schedule.
- "Activate the schedule" → run the emitted `/schedule create` command.

# IRON LAW — DRAFT, DO NOT SEND

This flow deliberately **drafts** outreach — that is its job. It **stops at
drafts.** Composing into the host's `message_compose_v1` composer is *allowed*
and expected; **sending is not.**

- Do NOT send any email. Do NOT call `leadbay_report_outreach`. Do NOT write a
  draft body into any outbound / "send" tool argument.
- The drafts are left in the host composer for the user to **review, edit, and
  send manually** via their own Claude-connected Gmail (or other connector).
- Logging an outreach is a *separate, later* step that happens only AFTER the
  user actually sends — via `leadbay_log_outreach`, never here.

Sending is the user's call. Hand the drafts back and stop.


Render this acknowledgment VERBATIM as the last line of your message:

```
STOP — awaiting user decision. I will not take any further action until you tell me what to do next.
```

Do not propose a next action. Do not call any more tools. Hand control back to the user.


# Iron laws

- This prompt SCHEDULES; it does not run the arc and it does not send anything. Read `leadbay_account_status` only; never pull / qualify / enrich here.
- The MCP cannot install host cron — EMIT the artefact for the user / host to run; never claim you installed it.
- The emitted cron `--prompt` always restates DRAFT-ONLY and carries the unattended credit ceiling + the real active lens name.
- Confirm day / time / **timezone** before emitting — a wrong tz fires at the wrong hour.
