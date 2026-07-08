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

**Poll a job you launched THIS turn; don't poll one from a PREVIOUS turn.** The rule splits by *when* the work was kicked off:

- **Previous turn / before an MCP restart, and the user has NOT asked about it** — don't poll for it in the background. Simply continue the conversation; the next time you call any tool, the completed-work entry appears in `_meta.notifications` (also on `leadbay_account_status.notifications`). This is the ambient push path — leave it to do its job. **But if the user explicitly asks for status or to "wait for it to finish"** (e.g. a multi-turn flow where a job was launched in a prior turn and this turn says "wait for enrichment to finish, then …"), DO poll its status tool now until done, exactly as for a this-turn job below — the ambient push only surfaces *completed* work, so it can't answer a live "is it done / wait for it" request while the job is still running.
- **This turn (you just launched it)** — do NOT end your turn on the "launched" ack. Stay active and poll the job's status tool in a loop until it reports done, then report the finished result yourself, rather than spinning forever or deferring the result to a later turn. Each status tool has its OWN terminal signal — poll until:
  - `leadbay_bulk_enrich_status` → `all_done:true` — OR `overall_progress.done` holds steady across several SPACED polls (~15–30s apart) over at least ~90s–2 min of elapsed time (some contacts are unresolvable, so `all_done` can stay false forever). Don't call a plateau from the first few back-to-back reads — early on `done` sits flat while the backend spins up. Once the plateau is real, report what resolved and name what didn't.
  - `leadbay_qualify_status` → `still_running` is empty: every launched lead has finished or failed. (`in_progress` also reads `false` on the fast path, but it can be `null` on the legacy/fallback read — so treat an empty `still_running` as terminal on its own; only require `in_progress:false` when that field is actually present.) LIKE imports, large qualification runs are async by design: `leadbay_bulk_qualify_leads` defaults to `wait_for_completion:false` for `count > 5` or chained workflows because blocking can time out, and `leadbay_qualify_status` may take minutes/hours. So don't force a long polling loop on a big run — return the handle/progress and let completion arrive via `_meta.notifications` — UNLESS the user explicitly asked to wait, or it's a small run that finishes quickly. A small `wait_for_completion:true` run you can poll to `still_running` empty inline.
  - `leadbay_import_status` → `status:"complete"` (or `"failed"`). BUT imports are the exception to the stay-active loop: a large `leadbay_import_leads({wait_for_completion:false})` is meant to return a handle and resolve over minutes, and the tool does ONE refresh pass per call. Don't block the conversation looping on it — surface the returned progress/handle and let the completion arrive via `_meta.notifications` — UNLESS the user explicitly asked you to wait for the import, or it's a small import that finishes quickly.

  Enrichment is the one that always polls to completion in-turn. For qualification and imports, poll inline only for small/quick runs or when the user explicitly asked you to wait; otherwise return the handle and let `_meta.notifications` deliver it. Either way, the user should never have to ask "is it done yet?" for work you kicked off in the same turn — you either report it or hand back a clear in-progress handle.

Also surfaced as a top-level `notifications` array on `leadbay_account_status` — same shape, same handling.
