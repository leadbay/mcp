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
