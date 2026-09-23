---
name: leadbay_outreach_session
description: "Run an outreach session over ANY set of leads: follow-ups, a Discover lens, or a campaign. Assess who is actually reachable, build the lead desk, then record each outcome as you dictate it. Trigger on \"relance plan\", \"campagne de relance\", \"cold calling session\", \"prospection session\", \"outreach session\", \"let's contact leads\", \"who do I call today\". For a campaign the user NAMES, prefer `leadbay_work_campaign`."
---


Run an outreach session over my **<the value derived from "source" (label). Source: Optional: where the leads come from — 'followups' (the Monitor, default), 'discover' (the active lens), or 'campaign'. Omit and the session asks.>**<if the user supplied this argument, render the short parenthetical or inline clause derived from it; otherwise empty. Source: Optional: campaign name (fuzzy-matched against your own campaigns) or UUID, when source is 'campaign'. Omit to list and pick.>.

GATE — DEFER TO TOOL RENDERING. When you call a Leadbay composite that ships its own RENDERING block (every composite in 0.9.0+ does), render the response using that block's recipe verbatim — score bars, glyph palette, column order, hide-list, link priorities, all of it. Do NOT substitute prose, a numbered list, or a different column structure even when an orchestrating prompt's body suggests alternate framing. Prompt-specific commentary (motivational nudges, summaries, next-action recommendations) belongs ABOVE or BELOW the canonical table, never in place of it.

If the prompt's body and the tool's RENDERING appear to conflict, the tool's RENDERING wins for the structural layout; the prompt's voice wins for the commentary that surrounds it.


# PHASE 0 — PICK THE SOURCE

If the source was given, use it. Otherwise surface a `single_select` via your host's choice widget (`ask_user_input_v0` or `AskUserQuestion`):

> Which leads do you want to work?
> - Follow-ups — leads already in my Monitor
> - New leads — today's batch from my active lens
> - A campaign — pick one

For the campaign branch, resolve the name I gave you or call `leadbay_list_campaigns()` and let me pick (cap at 4, sorted by `updated_at` desc, archived hidden). Capture the `campaign_id`.

**If I named a specific campaign up front**, this prompt is the wrong door — `leadbay_work_campaign` is the campaign-shaped session and already knows that flow. Say so in one line and hand over.

# PHASE 1 — ASSESS WHO IS ACTUALLY REACHABLE (the load-bearing phase)

Fetch one page from the chosen source:

- follow-ups → `leadbay_pull_followups({count: 25})`
- discover → `leadbay_pull_leads({count: 25})`
- campaign → `leadbay_campaign_call_sheet({campaign_id})`

Then count, on the rows you just got back, how many carry a company phone or email. A lead is reachable when `has_phone` is true, or `phone_numbers` holds a real value, or `email` does. **The API returns the literal string `"null"` for a missing value** in both `phone_numbers` and `email` — guard it, or the count reports a callable book that is not.

**`contacts_count > 0` is NOT reachability.** It counts known people, not people you can dial; a lead can show thousands of contacts and zero channels.

**One-line situation report**, always, before anything else:

```
📋 <N> leads · ☎ <with_phone> with a phone · ✉ <with_email> with an email · 🔴 <no_channel> need enrichment
```

**Then branch:**

- **Nothing reachable at all** — do NOT build a board the rep cannot work. Say it plainly ("none of these 25 leads has a phone or email on file"), then offer, as a `single_select`: enrich the top leads' buyer titles (`leadbay_enrich_titles`), build the desk anyway so I can enrich row by row, or pick a different source.
- **Some reachable** — go to Phase 2. Mention the unreachable count once so I know the desk will show enrich controls on those rows.

# PHASE 2 — BUILD THE LEAD DESK

Call `leadbay_get_artifact_runtime` and follow its **LEAD DESK** recipe. Build from the leads already in hand — do NOT re-call the source tool to populate the board.

The desk is one row per lead, carrying:

- the company, its sector / description and the COMPANY switchboard (labelled as the company's, never as the contact's direct line)
- the contact, with email and phone — **lazy**, loaded when I open the row, because those come from `research_lead_by_id` and prefetching is one request per row
- an enrich control on any contact missing a channel, which names the spend before buying
- the CRM status (Wanted / Won / Lost / Unwanted), saving on change
- this attempt's outcome + a note, which is required
- like / dislike, and Qualify / Requalify

Set the artifact's `mcp_tools` to every tool the page calls, or its controls are inert.

End the turn with the standby line:

> The desk is up. Tell me what happened after each call or email — I'll record the outcome and the status.

# PHASE 3 — RECORD OUTCOMES, ONE AT A TIME

When I dictate something like *"Called Michel at Starmat, voicemail, trying Thursday"* or *"Talked to Christian, wants a quote, meeting booked Tuesday"*, parse:

1. **Which lead** — by company or contact name, cross-referenced with the rows on the desk.
2. **The note** — my exact words. Don't paraphrase; the next rep reads this.
3. **The outcome** — ONE of:
   - `STILL_CHASING` — pursuing, no decision ("trying again", "they'll get back to me")
   - `COULD_NOT_REACH_STILL_TRYING` — voicemail, no answer, gatekeeper
   - `INTEREST_VALIDATED_OR_MEETING_PLANED` — meeting booked, quote requested, "send me more"
   - `NOT_INTERESTED_LOST` — declined, "not now", "not a fit"

Call `leadbay_report_outreach({lead_id, note, epilogue_status, verification: {source: "user_confirmed", ref: <my exact words>}})`.

**If I also reported a commercial outcome** — "we won it", "they're out" — that is a LEAD STATUS, a different axis. Fire `leadbay_set_lead_status` as well. Setting one never sets the other.

Confirm in ONE line: *"✅ Logged: <Company> → <outcome>. Next?"* Then wait. Don't ask "anything else?".

# PHASE 4 — STOP

When I say "done" / "that's it" / "wrapping up":

> Session complete — N logged: X meetings booked · Y still chasing · Z couldn't reach · W declined.

If any lead still has no channel, add one line: *"<N> leads still have nobody to call — want to enrich them for next time?"*

# Iron laws

- `verification` on `leadbay_report_outreach` is REQUIRED. For a call, `{source: "user_confirmed", ref: <my verbatim words>}`. Fabricating a gmail_message_id for a call is forbidden.
- ONE attempt → ONE `leadbay_report_outreach`. Never batched at the end of the session.
- Epilogue and lead status are different systems. When I report both in one breath, fire both.
- Enrichment SPENDS QUOTA. Name the contact and the channels before buying, and never buy a channel already on file.
- Never build the desk by hand. `leadbay_get_artifact_runtime` owns the skin and the wiring; a hand-built board logs nothing.
- If an outcome I dictate doesn't map cleanly to one of the four epilogue values, ASK ONCE rather than guessing.
