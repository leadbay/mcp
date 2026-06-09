## GATE — INSPECT `_meta.notifications` ON EVERY RESPONSE

Some Leadbay tool responses include a `_meta.notifications` array listing **background work the user (or you) initiated that has since completed**. The three relevant kinds:

| Kind | What just finished |
|---|---|
| `bulk_enrich` | A bulk contact-enrichment job (emails / phone numbers attached to leads' contacts). |
| `bulk_qualify` | A bulk lead-qualification job (web-fetch + AI rescore, producing `ai_agent_lead_score` and qualification answers). |
| `import` | A CSV / CRM file import (rows resolved to leads in the user's pipeline). |

**Your job when you see an entry: revise prior outputs the just-finished work might have made stale.** This is NOT a pending-task list. It's a "your earlier answer used data that has now changed" signal.

| Kind | Outputs you've produced that may now be stale — refresh them |
|---|---|
| `bulk_enrich` | Outreach drafts mentioning these leads' contacts; contact lists; recommended-lead lists citing `contact_count`; NEXT STEPS that asked the user to wait for emails / phones. Re-fetch via `leadbay_get_contacts(leadId)` for the affected leads. |
| `bulk_qualify` | Lead rankings / shortlists you produced without `ai_agent_lead_score`; "today's leads"; followup maps; prepare-outreach picks. Re-pull via `leadbay_pull_leads` / `leadbay_research_lead_by_id`. |
| `import` | "Available leads" claims; pulls from the affected lens that ran before the import landed; followup planning that needed the imported set. Re-pull via `leadbay_pull_leads` / `leadbay_pull_followups`. |

**After revising (or after confirming no prior output is affected):** call `leadbay_acknowledge_notification(notification_id)` so the entry stops resurfacing on every tool response. Ack-and-move-on is correct even when nothing was stale — that's how the inbox stays focused on what's actually pending.

**Do NOT** interpret these entries as "things waiting for the user." The user expects you to handle them silently. They are signals to YOU — agent — that prior outputs need a refresh.

**Don't poll.** When you launch a long operation (enrichment / qualification / import), simply continue the conversation — the next time you call any tool, the completed-work entry will appear in `_meta.notifications`. Status tools (`leadbay_bulk_enrich_status`, `leadbay_qualify_status`, `leadbay_import_status`) exist for the case where you want the answer NOW (mid-conversation), not for ambient polling.

Also surfaced as a top-level `notifications` array on `leadbay_account_status` — same shape, same handling.
