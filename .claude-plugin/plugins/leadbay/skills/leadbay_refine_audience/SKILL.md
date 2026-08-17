---
name: leadbay_refine_audience
description: "Refine the kind of leads Leadbay surfaces beyond firmographics, with a free-text instruction. Handles the clarification round-trip if the new prompt is ambiguous."
---


Refine the Leadbay audience prompt to: <The refinement (e.g. 'focus on hospitals running their own IT'). Set to plain English. If not provided in the user's most recent message, ask once before proceeding.>

# PHASE 0 — GATE: IS THIS A GEO ASK? (may end the run)
A refine prompt shapes the KIND of company, never WHERE it is. Classify my instruction
FIRST, before any tool call:

- **Whole-country or supra-national scope** ("the whole US", "partout en France",
  "nationwide", "EU-wide") → **STOP HERE. Call NOTHING.** Do not continue to PHASE 1:
  `leadbay_refine_prompt` would overwrite my qualitative audience prompt and kick off an
  intelligence recompute to express a scope this workspace already has. Tell me the
  workspace serves exactly ONE country so there is nothing to set, offer the axes that do
  narrow an audience (sector, size, or a sub-country region / state / county / city), and
  end your turn.
- **A sub-country place** ("prospects in Texas", "restrict to Indre-et-Loire") → **do not
  continue to PHASE 1 either.** A place is not a qualitative refinement: route it to
  `leadbay_adjust_audience({locations: [...]})`, say why, and stop.
- **Anything else** (a genuine qualitative refinement) → continue to PHASE 1.

**One workspace = one country — a country name is NEVER a location filter.** This workspace serves exactly ONE country (US backend → US companies, FR → France). The admin-area index holds no country nodes, so `"France"` matches the *commune of Francs* and `"United States"` matches *Statesboro*: the call is silently fenced to one village and every conclusion from it is wrong. City AND country named? Keep the city, drop the country.

**Which country decides the recovery — these are NOT interchangeable:**

- **This workspace's own country**, or "nationwide" / "partout en France" / "everywhere" → omit the geo argument (`city` / `locations` / `location_ids`) and say the result covers the whole workspace.
- **A different country** ("leads in France" on a US workspace) → **unsupported, not unfiltered.** Do NOT re-run without the argument: whole-workspace results are US leads and answer nothing about France. Say the workspace holds only its own country's companies.
- **A supra-national scope** ("EU", "EMEA", "worldwide") → name what the workspace covers, then offer the whole-workspace view as an explicit choice rather than assuming it.
- **A country on a custom/staging backend** (`country_indeterminate`) → which country this workspace serves is unknown, so claim nothing: omit the argument ONLY if the user meant the whole workspace, and never present the result as an answer about one specific country.

On `code: "COUNTRY_LEVEL_LOCATION"` do NOT retry with another spelling or a nearby city — read `country_locations[].kind` (`home_country` / `foreign_country` / `supranational` / `country_indeterminate`) and follow the matching line.

Place names never go in `keywords`, `sectors` or `refine_prompt` — text matches, not geo filters.


# PHASE 1 — REFINE (only when PHASE 0 classified the instruction as qualitative)
Call `leadbay_refine_prompt` with `prompt=<the instruction above>`.

# PHASE 2 — CLARIFICATION ROUND-TRIP (if needed)

IRON LAW — DO NOT ANSWER CLARIFICATIONS ON THE USER'S BEHALF. If the response includes a `clarification` block, surface the question and options to me VERBATIM and wait. Do NOT call `leadbay_answer_clarification`. I want to choose.

# PHASE 3 — APPLIED OR NOT
If the response status is `applied`, tell me Leadbay is regenerating intelligence and recommend I check back in a few minutes via `leadbay_account_status` (`computing_intelligence` flips to false when ready). If the status is anything else, name it explicitly.

GATE — DEFER TO TOOL RENDERING. When you call a Leadbay composite that ships its own RENDERING block (every composite in 0.9.0+ does), render the response using that block's recipe verbatim — score bars, glyph palette, column order, hide-list, link priorities, all of it. Do NOT substitute prose, a numbered list, or a different column structure even when an orchestrating prompt's body suggests alternate framing. Prompt-specific commentary (motivational nudges, summaries, next-action recommendations) belongs ABOVE or BELOW the canonical table, never in place of it.

If the prompt's body and the tool's RENDERING appear to conflict, the tool's RENDERING wins for the structural layout; the prompt's voice wins for the commentary that surrounds it.
