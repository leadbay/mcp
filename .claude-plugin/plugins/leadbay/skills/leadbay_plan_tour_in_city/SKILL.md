---
name: leadbay_plan_tour_in_city
description: "Plan a field sales tour: in one flow, surface follow-ups + fresh Discover leads in the target city via `leadbay_tour_plan`, render to a map, draft in-area outreach via `leadbay_prepare_outreach`, and optionally persist the selected accounts as a named campaign via `leadbay_create_campaign`. Closes #3630 US1 end-to-end."
---


Plan a field sales tour for me in **<City or region the user is visiting (e.g. 'Limoges', 'Bay Area'). Used as the geo filter for both Monitor and Discover lookups. If not provided in the user's most recent message, ask once before proceeding.>**<if the user supplied this argument, render the short parenthetical or inline clause derived from it; otherwise empty. Source: When the visit is (e.g. 'May 24', 'next Thursday'). Surfaced in the outreach drafts as 'I'll be in <city> on <date>'.>.

GATE — DEFER TO TOOL RENDERING. When you call a Leadbay composite that ships its own RENDERING block (every composite in 0.9.0+ does), render the response using that block's recipe verbatim — score bars, glyph palette, column order, hide-list, link priorities, all of it. Do NOT substitute prose, a numbered list, or a different column structure even when an orchestrating prompt's body suggests alternate framing. Prompt-specific commentary (motivational nudges, summaries, next-action recommendations) belongs ABOVE or BELOW the canonical table, never in place of it.

If the prompt's body and the tool's RENDERING appear to conflict, the tool's RENDERING wins for the structural layout; the prompt's voice wins for the commentary that surrounds it.


# PHASE 1 — BUILD THE ITINERARY

Call `leadbay_tour_plan({city: "<the city (as extracted above)>"})` with the default counts (6 follow-ups + 6 discover). If the response is `status: "ambiguous_locations"`, surface the candidates and ask me to pick one, then re-call with `city_id`.

Split the returned `monitor_leads` into two buckets client-side using `last_monitor_action`:

- **Customers** — leads with any `last_monitor_action` history (CONTACTED, MEETING_BOOKED, etc.). Treat as known accounts with prior engagement.
- **Qualified prospects** — leads with high `ai_agent_lead_score` (or `score`) but no recent action.

`discover_leads` are the **New** bucket.

Aim for a 3+3+3 split if possible. If the customers bucket has fewer than 3, fill from qualified. If discover_filter_note indicates a low match ratio for the city, mention it: "Only N/30 fresh leads matched your city" — better honest than padded.

# PHASE 2 — RENDER THE MAP

Route the union of `monitor_leads + discover_leads` into `places_map_display_v0` (when the host exposes it). Per-lead `notes` string:

- `★ Customer — <one-sentence sector + why-now>. Reach <name>, <role>: <bare phone>, <bare email>.`
- `★ Qualified — <one-sentence>. Reach <name>...`
- `✦ New — <one-sentence>. Reach <name>...`

Skip leads with `location.pos === null` (no coordinates → no pin) — list them as "+ N leads without coordinates" below the widget.

Below the widget, emit a chat-prose summary grouped by mode (Customers / Qualified / New), with LinkedIn-linked contact name + bare phone/email pills per lead. Use the canonical `linking/contact-linkedin` rules.

# PHASE 3 — DRAFT IN-AREA OUTREACH (optional, ask first)

After the map, ask me ONCE: "Want me to draft 'I'll be in <the city (as extracted above)><the date_paren (as extracted above)>' outreach for the top accounts?" If I say yes, for each of the top 3 leads (1 Customer / 1 Qualified / 1 New), call `leadbay_prepare_outreach(leadId)` and route the draft through `message_compose_v1` with a single variant labeled "In-area visit" — body opens with the visit context, references the AI-summary angle, ends with a clear ask (15-min coffee / on-site stopover).

Serialize the prepare_outreach calls (max 3 in parallel — see the long-running-tools rule).

# PHASE 4 — PERSIST AS A CAMPAIGN (optional, ask first)

After drafts, ask me ONCE: "Save these 9 accounts as a campaign called '**<the city (as extracted above)> Tour<if the user supplied this argument, render the dash-prefixed phrase derived from it; otherwise empty. Source: When the visit is (e.g. 'May 24', 'next Thursday'). Surfaced in the outreach drafts as 'I'll be in <city> on <date>'.>**'?" If I say yes, call `leadbay_create_campaign({lead_ids: [...all_nine_lead_ids], name: "<the city (as extracted above)> Tour<the date_dash (as extracted above)>"})`. Surface the returned `id` + `name` as a confirmation line, and offer the NEXT STEPS chip "View progression" (which routes to `leadbay_campaign_progression`).

If I declined the campaign step, end the turn — the map + drafts are enough for an ad-hoc trip.

# PHASE 5 — STOP

Done. The map is the surface; the drafts are the action; the campaign is the persistence layer for managerial follow-up after the trip.
