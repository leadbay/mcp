---
name: leadbay_sync_outreach
description: "Keep Leadbay's record of who was contacted current: read my mailbox and calendar, log every email and meeting with a Leadbay lead on the person it involved, then schedule the same sync to run every day. Trigger on \"log my emails in Leadbay\", \"sync my outreach\", \"keep Leadbay up to date with my emails\"."
---


Leadbay only knows the outreach someone logs in it. Keep that record current from my mailbox and calendar, so Leadbay can say who I contacted, when, and who went quiet.

IRON LAW — VERIFICATION REQUIRED. Before calling leadbay_report_outreach, you MUST collect one of: a gmail message id (verification.source = 'gmail_message_id'), a calendar event id (verification.source = 'calendar_event_id'), or a literal one-sentence user confirmation (verification.source = 'user_confirmed', verification.ref = the user's exact words). Skipping or fabricating verification poisons the human team's pipeline.


GATE — DEFER TO TOOL RENDERING. When you call a Leadbay composite that ships its own RENDERING block (every composite in 0.9.0+ does), render the response using that block's recipe verbatim — score bars, glyph palette, column order, hide-list, link priorities, all of it. Do NOT substitute prose, a numbered list, or a different column structure even when an orchestrating prompt's body suggests alternate framing. Prompt-specific commentary (motivational nudges, summaries, next-action recommendations) belongs ABOVE or BELOW the canonical table, never in place of it.

If the prompt's body and the tool's RENDERING appear to conflict, the tool's RENDERING wins for the structural layout; the prompt's voice wins for the commentary that surrounds it.


The lead lookups are for matching. Do not render them. The only table this sync shows is the one the block ends with.

# PHASE 0 — WHAT YOU CAN READ

Check which mail, calendar and CRM tools you have in this session. With no mail tool and no calendar tool, tell me to connect Gmail or Google Calendar to this assistant, and stop.

# PHASE 1 — FIRST RUN

Run the block below once, over the last <the user-supplied value if any; otherwise a sensible default. Source: Optional: how many days back the first run reads (default 14). The daily task always reads the last 2 days.> days instead of 2.

### Logging outreach from the user's mailbox and calendar

The `leadbay_sync_outreach` prompt runs the block below once, over the last 14 days instead of 2. It then schedules a daily task named "Leadbay outreach sync" whose instruction is the block, word for word. The block is the whole procedure, because a scheduled run sees nothing else.

> Leadbay outreach sync. Read my mailbox and calendar for the last 2 days: the emails I sent, the emails I received, and the meetings with outside guests. Never send, reply to, archive or label anything. Skip newsletters, no-reply senders, my own company's domain, and personal addresses such as gmail.com or orange.fr. For each other person, call leadbay_research_lead_by_name_fuzzy with only their full name as companyName, from the display name or from the address ("marcel.frei@" is Marcel Frei). This finds them on my own leads even when the company's website is another domain. If that finds no lead, or no contact on it with that exact email, call it again with the email's domain as companyName and website and the address as email. If there is still no lead, skip them and never import the company. Log each email and meeting with leadbay_report_outreach: the lead_id, the id of the contact with that email as contact_id, a one-line note ("Email sent: <subject>", "Replied: <what they said>" or "Meeting: <title>, <date>"), and verification {source: gmail_message_id, ref: the message id} or {source: calendar_event_id, ref: the event id}. Without a contact at that email, leave contact_id out. Set epilogue_status only on plain evidence: a meeting is INTEREST_VALIDATED_OR_MEETING_PLANED, a reply that declines is NOT_INTERESTED_LOST, a bounce is COULD_NOT_REACH_STILL_TRYING, and an email sent with no reply yet is STILL_CHASING. Log any other reply with no status and list it for me. A message or meeting already logged comes back in already_logged with nothing written. A CRM activity, or mail from a mailbox other than Gmail, has no id leadbay_report_outreach accepts as proof: list it, do not log it. End with a table of what you logged (lead, person, what, date, status) and what you skipped and why.


# PHASE 2 — SCHEDULE THE DAILY TASK

Then make the same sync run every morning. Asking for this sync is the go-ahead, so do not ask whether to schedule it.

- If you have a tool that creates scheduled or recurring tasks, create a daily task named "Leadbay outreach sync" whose instruction is the block, word for word.
- If you do not, show me the block and tell me to paste it into my assistant's scheduled tasks.

# PHASE 3 — REPORT

Show the table the block ends with. Then say in one line whether the daily task is scheduled or waiting for me to paste it.
