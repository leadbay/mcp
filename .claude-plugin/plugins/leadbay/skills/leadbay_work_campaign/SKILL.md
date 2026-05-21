---
name: leadbay_work_campaign
description: "Work a campaign as a real outreach session: pick the campaign, assess what the user has (phones / emails / coords), then PROPOSE the right session mode (call sheet, email sheet, enrich titles first, map). After they pick, render — and as they dictate outcomes per lead, record both note + epilogue via `leadbay_report_outreach` in one round trip."
---


Work my **<the user-supplied value if any; otherwise a sensible default. Source: Campaign name (fuzzy match against your own campaigns) or campaign UUID. Omit to list and pick interactively.>** campaign as an outreach session<if the user supplied this argument, render the short parenthetical or inline clause derived from it; otherwise empty. Source: Optional: skip the readiness-assessment proposal and jump directly into 'call_sheet' / 'email_sheet' / 'map' / 'enrich_first'. Omit (recommended) and let the prompt propose based on the data.>.

GATE — DEFER TO TOOL RENDERING. When you call a Leadbay composite that ships its own RENDERING block (every composite in 0.9.0+ does), render the response using that block's recipe verbatim — score bars, glyph palette, column order, hide-list, link priorities, all of it. Do NOT substitute prose, a numbered list, or a different column structure even when an orchestrating prompt's body suggests alternate framing. Prompt-specific commentary (motivational nudges, summaries, next-action recommendations) belongs ABOVE or BELOW the canonical table, never in place of it.

If the prompt's body and the tool's RENDERING appear to conflict, the tool's RENDERING wins for the structural layout; the prompt's voice wins for the commentary that surrounds it.


# PHASE 0 — PICK THE CAMPAIGN

If I gave you a name or id, resolve it. Otherwise call `leadbay_list_campaigns()` and surface the active campaigns as a `single_select` via `ask_user_input_v0` (cap at 4 — sort by `updated_at` desc, archived hidden):

> Which campaign do you want to work?
> - <Name 1> · <N leads> · last touched <date>
> - <Name 2> · <N leads> · last touched <date>
> - …

When the user picks, capture the `campaign_id`. If `<Campaign name (fuzzy match against your own campaigns) or campaign UUID. Omit to list and pick interactively. Optional.>` is a name, fuzzy-match against `campaigns[].campaign.name`. On ambiguous matches, surface a `single_select` instead of guessing.

# PHASE 1 — FETCH + ASSESS READINESS (the load-bearing phase)

Call `leadbay_campaign_call_sheet({campaign_id})`. The response carries `summary` + `readiness` — use them to figure out what the user CAN actually do today, then PROPOSE the right session mode rather than auto-rendering.

**Read the summary numbers**:
- `total_leads`, `total_contacts`
- `leads_with_phone` — can call from this many leads
- `leads_with_email` — can email this many
- `leads_with_coords` — can map this many
- `leads_without_contacts` — these need enrichment before any outreach is possible
- `leads_already_contacted` — these have prior touches; the rep may want to skip them for cold work

**Read the `readiness` booleans** (pre-computed thresholds):
- `ready_for_calling` (phone coverage ≥60%) — call session viable
- `ready_for_emailing` (email coverage ≥60%) — email session viable
- `needs_enrichment` (≥30% no-contacts OR both phone+email coverage <40%) — enrichment recommended first
- `travel_friendly` (≥5 geocoded leads AND coord coverage ≥60%) — map mode worth proposing

**One-line situation report** (always emit BEFORE the proposal):

```
📋 <total_leads> leads · 📞 <leads_with_phone> with a phone · ✉ <leads_with_email> with an email · 🗺 <leads_with_coords> with coords · 🔴 <leads_without_contacts> need enrichment · ✅ <leads_already_contacted> already touched
```

**Then PROPOSE the right modes via `ask_user_input_v0`** (2-4 options, sorted by what makes the most sense for THIS campaign's data):

- "📞 Start calling now" — IF `ready_for_calling`. Top option when phones are there.
- "✉ Email session instead" — IF `ready_for_emailing` AND `email_ratio > phone_ratio`. Don't surface this when calling is more obvious.
- "🔧 Enrich titles first" — IF `needs_enrichment`. Top option when most leads have no contacts. Phrase as "<N> leads have no reachable contact yet — enrich titles before we start?" so the user understands the cost.
- "🗺 View on a map" — IF `travel_friendly` **AND** the user hasn't previously signaled disinterest in maps (check your conversation memory; if you've seen the user dismiss map renders before in this session or saved a "no maps" preference, drop this option).

If the MCP prompt argument `mode` was actually supplied, skip the proposal and jump to the matching mode below. If `mode` was omitted, do not treat `call_sheet` as implicit user consent — propose first.

# PHASE 2A — CALL-SHEET MODE (default after "📞 Start calling now")

Render per the `leadbay_campaign_call_sheet` RENDERING block — one CARD per lead with the 4-col contact table (Contact / Phone / Role / Recent). The phone in column 2 MUST be `[bare](tel:URL)` (use `contact.phone_tel_url` verbatim — the composite has already canonicalized it). The contact name in column 1 MUST be `[Name](linkedin_url)`. Email stacks under the name when present (`✉ [email](mailto_url)`). Recent stacks `📝 last note` + `📞 last_action_headline`.

End the turn with the standby line:

> Ready to start calling. Tell me what happened after each call — I'll record the note + outcome.

# PHASE 2B — EMAIL-SHEET MODE (after "✉ Email session instead")

Same data, slightly different render emphasis: drop the Phone column, put `✉ [email](mailto_url)` as column 2. Below each lead's table, generate a SUGGESTED short email draft per the next-step — but DON'T send. Drafts are for the user to copy-paste / send themselves.

# PHASE 2C — ENRICH-FIRST MODE (after "🔧 Enrich titles first")

Extract `leadIds` from `sheet.leads[].lead_id`, then call `leadbay_enrich_titles({leadIds, …})` (consult its description for titles / email / phone selection; do not pass `campaign_id`, because that is not part of the tool schema). Surface progress to the user. When complete, automatically loop back to Phase 1 (re-fetch the call sheet, re-assess readiness, re-propose).

# PHASE 2D — MAP MODE (after "🗺 View on a map")

Pass `response.map_locations` directly to `places_map_display_v0` — the composite has already built the per-pin notes string with the top contact's phone inline. After the widget, emit the standard 4-col card list anyway so the rich detail is still scannable.

# PHASE 3 — RECORD OUTCOMES, ONE AT A TIME (after the user starts dictating)

When the user says something like *"Called Bree, voicemail, trying again Tuesday"* or *"Talked to John, wants pricing sent next week"*, parse:

1. **Which lead** — by company name OR contact name (cross-reference with the cards you just rendered).
2. **The note** — the user's exact words about what happened (the SDR's voice — don't paraphrase).
3. **The outcome** — pick ONE of these four epilogue values based on what the user said:
   - `STILL_CHASING` — pursuing, no decision yet ("trying again", "they'll get back to me")
   - `COULD_NOT_REACH_STILL_TRYING` — voicemail, no answer, wrong number, gatekeeper blocked
   - `INTEREST_VALIDATED_OR_MEETING_PLANED` — meeting booked, quote requested, "send me more info"
   - `NOT_INTERESTED_LOST` — declined, "not now", "not a fit", "remove from list"

Call `leadbay_report_outreach({lead_id, note: <user's words>, epilogue_status: <picked>, verification: {source: "user_confirmed", ref: <user's exact words verbatim>}})`. Confirm in ONE line: *"✅ Logged: <Company> → <epilogue>. Next?"*

Then wait for the next dictation. Don't ask "anything else?" — just acknowledge and wait.

# PHASE 4 — STOP

When the user says "done" / "that's it" / "wrapping up" / similar, surface a session summary chip:

> Session complete — N calls logged: X meetings booked · Y still chasing · Z couldn't reach · W declined.

Optional: offer to review the `leadbay_campaign_progression` for the same campaign to see the updated counts.

# Iron laws

- The `verification` field on `leadbay_report_outreach` is REQUIRED. For calls (no message id), always use `{source: "user_confirmed", ref: <user's verbatim words>}`. Skipping it is forbidden; fabricating a gmail_message_id for a call is forbidden.
- ONE call → ONE `leadbay_report_outreach` invocation. Don't batch; each call has its own note + outcome.
- Map mode is OPT-IN, never automatic. The user invokes it via the proposal options or by passing `mode=map`.
- If you've seen the user dismiss / dislike map renders earlier in the session, don't propose map mode again.
- If the user dictates an outcome that doesn't cleanly map to one of the four epilogue values, ASK ONCE before guessing.
