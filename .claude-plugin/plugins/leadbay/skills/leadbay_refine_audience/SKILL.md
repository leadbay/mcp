---
name: leadbay_refine_audience
description: "Refine the kind of leads Leadbay surfaces beyond firmographics, with a free-text instruction. Handles the clarification round-trip if the new prompt is ambiguous."
---


Refine the Leadbay audience prompt to: <The refinement (e.g. 'focus on hospitals running their own IT'). Set to plain English. If not provided in the user's most recent message, ask once before proceeding.>

# PHASE 0 — IS THIS ACTUALLY A GEO ASK?
A refine prompt shapes the KIND of company, never WHERE it is. If my instruction is a
place ("prospects in Texas", "restrict to Indre-et-Loire"), do NOT put it in the refine
prompt — route it to `leadbay_adjust_audience({locations: [...]})` instead, and say why.
If it names a whole country, set no geography at all and tell me the workspace already
covers exactly one country.

**One workspace = one country — a country name is NEVER a location filter.** This workspace serves exactly ONE country (US backend → US companies, FR → France), so every lead in it is already in that country. "Across the US", "nationwide", "partout en France" therefore mean **no location filter at all**: omit the geo argument (`city` / `locations` / `location_ids`) and say the result covers the whole workspace.

**Never pass a country name to a geo argument.** The admin-area index holds no country nodes, so `"France"` matches the *commune of Francs* and `"United States"` matches *Statesboro* — the call is silently fenced to one village and every conclusion drawn from it is wrong. City AND country named? Keep the city, drop the country. Country only, or a supra-national scope ("EU", "EMEA", "worldwide")? Pass no geo argument. On `code: "COUNTRY_LEVEL_LOCATION"`, do NOT retry with another spelling or a nearby city — re-issue the SAME call without the location argument.

Place names never go in `keywords`, `sectors` or `refine_prompt` — those are text matches, not geo filters.


# PHASE 1 — REFINE
Call `leadbay_refine_prompt` with `prompt=<the instruction above>`.

# PHASE 2 — CLARIFICATION ROUND-TRIP (if needed)

IRON LAW — DO NOT ANSWER CLARIFICATIONS ON THE USER'S BEHALF. If the response includes a `clarification` block, surface the question and options to me VERBATIM and wait. Do NOT call `leadbay_answer_clarification`. I want to choose.

# PHASE 3 — APPLIED OR NOT
If the response status is `applied`, tell me Leadbay is regenerating intelligence and recommend I check back in a few minutes via `leadbay_account_status` (`computing_intelligence` flips to false when ready). If the status is anything else, name it explicitly.

GATE — DEFER TO TOOL RENDERING. When you call a Leadbay composite that ships its own RENDERING block (every composite in 0.9.0+ does), render the response using that block's recipe verbatim — score bars, glyph palette, column order, hide-list, link priorities, all of it. Do NOT substitute prose, a numbered list, or a different column structure even when an orchestrating prompt's body suggests alternate framing. Prompt-specific commentary (motivational nudges, summaries, next-action recommendations) belongs ABOVE or BELOW the canonical table, never in place of it.

If the prompt's body and the tool's RENDERING appear to conflict, the tool's RENDERING wins for the structural layout; the prompt's voice wins for the commentary that surrounds it.
