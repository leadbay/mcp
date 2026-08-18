---
name: leadbay_refine_audience
description: "Refine the kind of leads Leadbay surfaces beyond firmographics, with a free-text instruction. Handles the clarification round-trip if the new prompt is ambiguous."
---


Refine the Leadbay audience prompt to: <The refinement (e.g. 'focus on hospitals running their own IT'). Set to plain English. If not provided in the user's most recent message, ask once before proceeding.>

# PHASE 0 — GATE: IS THIS A GEO ASK? (may end the run)
A refine prompt shapes the KIND of company, never WHERE it is. Classify my instruction
FIRST, before any tool call:

- **This workspace's own country** ("the whole US" on a US workspace, "nationwide") →
  **STOP HERE. Call NOTHING.** Do not continue to PHASE 1: `leadbay_refine_prompt` would
  overwrite my qualitative audience prompt and kick off an intelligence recompute to
  express a scope this workspace already has. Tell me there is nothing to set because the
  workspace already covers exactly that, offer the axes that do narrow an audience
  (sector, size, or a sub-country region / state / county / city), and end your turn.
- **A DIFFERENT country** ("partout en France" on a US workspace) → **STOP HERE too, but
  do not say "there is nothing to set" — that is false.** The ask is UNSUPPORTED, not
  already-satisfied: this workspace holds only its own country's companies, so there are
  no leads there to scope to. Say so plainly, do not offer an unfiltered view as if it
  answered the request, and end your turn.
- **A supra-national scope** ("EU-wide", "EMEA") → stop as well: name what the workspace
  covers and ask whether I want that instead, rather than assuming it.
- **A sub-country place** ("prospects in Texas", "restrict to Indre-et-Loire") → **do not
  continue to PHASE 1 either.** A place is not a qualitative refinement: route it to
  `leadbay_adjust_audience({locations: [...]})`, say why, and stop.
- **Anything else** (a genuine qualitative refinement) → continue to PHASE 1.

**One workspace = one country — a country name is NEVER a location filter.** The admin-area index holds no country nodes, so `"France"` matches the *commune of Francs* and `"United States"` matches *Statesboro*: the call is silently fenced to one village and every conclusion from it is wrong. City AND country named? Keep the city, drop the country.

**On `code: "COUNTRY_LEVEL_LOCATION"` read `country_locations[].axis` and `[].kind` — the recovery differs per case and they are NOT interchangeable, and do NOT retry with another spelling or a nearby city.**

`axis: "include"`:

- `home_country`, or "nationwide" / "everywhere" → drop that ONE value. Omit the geo argument (`city` / `locations` / `location_ids`) only if nothing else was on it — then the result covers the whole workspace. If other values remain, keep them and describe the result as those places.
- `foreign_country` ("leads in France" on a US workspace) → **unsupported, not unfiltered.** Do NOT re-run without the argument: whole-workspace results are US leads and answer nothing about France. Say the workspace holds only its own country's companies.
- `supranational` ("EU", "EMEA") → name what the workspace covers, then offer the whole-workspace view as an explicit choice rather than assuming it.
- `country_indeterminate` (custom/staging backend) → its country is unknown, so claim nothing about what it holds.

`axis: "exclude"` reverses all of that — **never "omit the argument"**, which returns the very companies the user asked to remove. Excluding this workspace's own country would empty it; excluding any other country is a harmless no-op. Either way drop the value and ask what to carve out instead.

On a lens-WRITING tool (`new_lens`, `adjust_audience`, `update_lens_filter`), if the country was the only scope: write nothing, do not re-call without it.

Place names never go in `keywords`, `sectors` or `refine_prompt` — text matches, not geo filters.


# PHASE 1 — REFINE (only when PHASE 0 classified the instruction as qualitative)
Call `leadbay_refine_prompt` with `prompt=<the instruction above>`.

# PHASE 2 — CLARIFICATION ROUND-TRIP (if needed)

IRON LAW — DO NOT ANSWER CLARIFICATIONS ON THE USER'S BEHALF. If the response includes a `clarification` block, surface the question and options to me VERBATIM and wait. Do NOT call `leadbay_answer_clarification`. I want to choose.

# PHASE 3 — APPLIED OR NOT
If the response status is `applied`, tell me Leadbay is regenerating intelligence and recommend I check back in a few minutes via `leadbay_account_status` (`computing_intelligence` flips to false when ready). If the status is anything else, name it explicitly.

GATE — DEFER TO TOOL RENDERING. When you call a Leadbay composite that ships its own RENDERING block (every composite in 0.9.0+ does), render the response using that block's recipe verbatim — score bars, glyph palette, column order, hide-list, link priorities, all of it. Do NOT substitute prose, a numbered list, or a different column structure even when an orchestrating prompt's body suggests alternate framing. Prompt-specific commentary (motivational nudges, summaries, next-action recommendations) belongs ABOVE or BELOW the canonical table, never in place of it.

If the prompt's body and the tool's RENDERING appear to conflict, the tool's RENDERING wins for the structural layout; the prompt's voice wins for the commentary that surrounds it.
