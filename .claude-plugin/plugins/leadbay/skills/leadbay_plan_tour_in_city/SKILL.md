---
name: leadbay_plan_tour_in_city
description: "Use whenever the user names a city they'll be in and asks who to see — \"I'm in SF next Tuesday, who's worth meeting?\", \"I'm going to Berlin — who should I visit?\", \"plan my <city> tour\". Any in-person/visit intent tied to a place routes here, NOT to `leadbay_pull_leads`. It surfaces follow-ups + fresh Discover leads in the city via `leadbay_tour_plan`, ALWAYS offers to plot them on a map (rendering it on yes), then offers outreach drafts + campaign persistence."
---


Plan a field sales tour for me in **<City or region the user is visiting (e.g. 'Limoges', 'Bay Area'). Used as the geo filter for both Monitor and Discover lookups. If not provided in the user's most recent message, ask once before proceeding.>**<if the user supplied this argument, render the short parenthetical or inline clause derived from it; otherwise empty. Source: When the visit is (e.g. 'May 24', 'next Thursday'). Surfaced in the outreach drafts as 'I'll be in <city> on <date>'.>.

GATE — DEFER TO TOOL RENDERING. When you call a Leadbay composite that ships its own RENDERING block (every composite in 0.9.0+ does), render the response using that block's recipe verbatim — score bars, glyph palette, column order, hide-list, link priorities, all of it. Do NOT substitute prose, a numbered list, or a different column structure even when an orchestrating prompt's body suggests alternate framing. Prompt-specific commentary (motivational nudges, summaries, next-action recommendations) belongs ABOVE or BELOW the canonical table, never in place of it.

If the prompt's body and the tool's RENDERING appear to conflict, the tool's RENDERING wins for the structural layout; the prompt's voice wins for the commentary that surrounds it.


# PHASE 1 — BUILD THE ITINERARY

Call `leadbay_tour_plan({city: "<the city (as extracted above)>"})` with the default counts (6 follow-ups + 6 discover). If the response is `status: "ambiguous_locations"`, surface the candidates and ask me to pick one, then re-call with `city_id`.

Split the returned `monitor_leads` into two buckets client-side using their engagement-history fields:

- **Customers** — leads with prior engagement history: any of `epilogue_status`, `last_prospecting_action_at`, or `last_monitor_action_at` is set. Treat as known accounts with prior interaction.
- **Qualified prospects** — leads with a high `ai_agent_lead_score` (or `score`) but none of those history fields set (scored, not yet worked).

`discover_leads` are the **New** bucket.

Aim for a 3+3+3 split if possible. If the customers bucket has fewer than 3, fill from qualified. If discover_filter_note indicates a low match ratio for the city, mention it: "Only N/30 fresh leads matched your city" — better honest than padded.

# PHASE 2 — PRESENT THE ITINERARY + OFFER THE MAP

Show the planned tour as a concise per-lead list grouped by mode (Customers → Qualified → New), each line carrying its `★`/`✦` badge, the company, city, and best contact. Keep it tight — this is the summary, not the map.

Then **ALWAYS offer the map as the immediate next step** — a tour is inherently geographic, so the map is the natural payoff. End the turn with a single clear proposal:

> **Want me to put these <N> stops on a map?** I'll plot them so you can see the route for your <city> day.

Make it a genuine yes/no offer (route it through `ask_user_input_v0` / `AskUserQuestion` when that's in your tool set, so it's a tappable choice; otherwise the one-line question above). Do NOT render the map yet, and do NOT bury the offer — proposing the map is mandatory on every tour, for BOTH "plan a prospecting tour in <city>" and "who's worth meeting in <city>" phrasings. If the user already said "show me on a map" / "give me the map" in their request, skip the offer and go straight to PHASE 3.

# PHASE 3 — RENDER THE MAP (when the user accepts, or asked for it up front)

When the user says yes (or asked for the map in their original message), render it now. Two ways — you MUST do one, never a flat prose paragraph:

**Path A — `places_map_display_v0` is in your tool set.** Pass the `map_locations` array from the `leadbay_tour_plan` response **directly** into it — each entry is already `{name, address, latitude, longitude, notes}`, server-shaped, with the mode badge baked into `notes`. Do NOT rebuild from `location.pos` or re-derive the notes.

**Path B — the widget is NOT in your tool set (e.g. Claude Desktop).** Emit one **place-card block per lead** in EXACTLY this shape so the chat host auto-detects the address and renders its own Google-Place-card map carousel — the `### Company · City, State` heading + address is what triggers it:

```
### <Company Name> · <City>, <State>

<★ Customer | ★ Qualified | ✦ New> — <one-sentence why-it-fits>. Reach **[<Contact name>](<LinkedIn URL>)**, <role>. ☎ <bare phone>.
```

One block per lead in `map_locations`, grouped by mode. Pull company, city/state, badge, and contact straight from the tool response. A flat paragraph like "Brooklyn Brewery — Broadway, 10018 (Midtown). Best contact: …" does NOT auto-detect and is WRONG — the per-lead heading with the city is mandatory.

Coordinate-less leads are already omitted from `map_locations`; footnote them with `map_summary.leads_without_coords` ("+ N leads without coordinates").

# PHASE 4 — DRAFT IN-AREA OUTREACH (optional, ask first)

After the map, ask me ONCE: "Want me to draft 'I'll be in <the city (as extracted above)><the date_paren (as extracted above)>' outreach for the top accounts?" If I say yes, for each of the top 3 leads (1 Customer / 1 Qualified / 1 New), call `leadbay_prepare_outreach(leadId)` and route the draft through `message_compose_v1` with a single variant labeled "In-area visit" — body opens with the visit context, references the AI-summary angle, ends with a clear ask (15-min coffee / on-site stopover).

Serialize the prepare_outreach calls (max 3 in parallel — see the long-running-tools rule).

# PHASE 5 — PERSIST AS A CAMPAIGN (optional, ask first)

After drafts, ask me ONCE: "Save these 9 accounts as a campaign called '**<the city (as extracted above)> Tour<if the user supplied this argument, render the dash-prefixed phrase derived from it; otherwise empty. Source: When the visit is (e.g. 'May 24', 'next Thursday'). Surfaced in the outreach drafts as 'I'll be in <city> on <date>'.>**'?" If I say yes, call `leadbay_create_campaign({lead_ids: [...all_nine_lead_ids], name: "<the city (as extracted above)> Tour<the date_dash (as extracted above)>"})`. Surface the returned `id` + `name` as a confirmation line, and offer the NEXT STEPS chip "View progression" (which routes to `leadbay_campaign_progression`).

If I declined the campaign step, end the turn — the map + drafts are enough for an ad-hoc trip.

# PHASE 6 — STOP

Done. The map is the surface; the drafts are the action; the campaign is the persistence layer for managerial follow-up after the trip.
