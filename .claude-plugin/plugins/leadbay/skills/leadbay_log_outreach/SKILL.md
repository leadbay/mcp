---
name: leadbay_log_outreach
description: "Log outreach (an email I sent, a call I made, a meeting I had) on a specific lead. Captures verification so the SDR pipeline trusts the entry."
---


IRON LAW — VERIFICATION REQUIRED. Before calling leadbay_report_outreach, you MUST collect one of: a gmail message id (verification.source = 'gmail_message_id'), a calendar event id (verification.source = 'calendar_event_id'), or a literal one-sentence user confirmation (verification.source = 'user_confirmed', verification.ref = the user's exact words). Skipping or fabricating verification poisons the human team's pipeline.


Log this outreach on Leadbay lead <The lead UUID. Get it from leadbay_pull_leads or leadbay_research_lead. If not provided in the user's most recent message, ask once before proceeding.>:
Summary: <1-2 sentences describing what I did (e.g. 'Sent intro email to CTO citing recent Hornsea contract'). If not provided in the user's most recent message, ask once before proceeding.>

# PHASE 1 — COLLECT VERIFICATION (ask the user EXACTLY once)

Before calling `leadbay_report_outreach`, ask me ONCE which of these applies:

- I sent an **email** → ask for the Gmail message id (`verification.source = 'gmail_message_id'`, `verification.ref = <the id>`).
- I booked a **meeting** → ask for the calendar event id (`verification.source = 'calendar_event_id'`, `verification.ref = <the id>`).
- **Other** → ask me for a literal one-sentence confirmation that the outreach happened (`verification.source = 'user_confirmed'`, `verification.ref = my exact words`).

# PHASE 2 — RECORD

After I answer, call `leadbay_report_outreach({lead_id: '<the lead_id (as extracted above)>', note: <summary>, verification: {source, ref}})`. Optionally pass `dry_run:true` first to confirm exactly what would be sent — recommended if I described the outreach but you're not 100% sure how to phrase the note.

# PHASE 3 — CONFIRM
Tell me the outreach was logged, name the verification.source used, and surface the response's `outreach_id` if present so I can refer back to it.
