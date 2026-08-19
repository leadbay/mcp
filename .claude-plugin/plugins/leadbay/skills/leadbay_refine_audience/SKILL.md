---
name: leadbay_refine_audience
description: "Refine the kind of leads Leadbay surfaces beyond firmographics, with a free-text instruction. Handles the clarification round-trip if the new prompt is ambiguous."
---


Refine the Leadbay audience prompt to: <The refinement (e.g. 'focus on hospitals running their own IT'). Set to plain English. If not provided in the user's most recent message, ask once before proceeding.>

# PHASE 0 — GATE: STRIP THE COUNTRY, THEN CLASSIFY WHAT IS LEFT (may end the run)
A refine prompt shapes the KIND of company, never WHERE it is. Before any tool call:

**Step 1 — strip, do not stop.** If my instruction names this workspace's own country or
a whole-country scope ("nationwide", "the whole US", "partout en France"), remove that
phrase and KEEP THE REST. It is redundant, never a filter — but it is almost never the
whole instruction. "Hospitals running their own IT nationwide" is a refinement about
hospitals; "hospitals in Paris, France" is Paris plus hospitals. Losing the rest because
a country rode along is the worse error of the two.

**Step 2 — if a COUNTRY is involved, find out which country this workspace serves
before you branch.** You cannot tell from my message: "French hospitals across France"
is a redundant clause on an FR backend and an unsupported ask on a US one, and the
language I write in says nothing about it. Do NOT guess from the country I named, from
my language, or from the fact that the request sounds plausible. Every Leadbay tool
result carries it at `_meta.region` (`us` | `fr` | `custom`); if no call this session has
returned one, call `leadbay_account_status` — read-only, writes nothing — and read
`_meta.region` from it. `custom` means the backend's country is unknown: claim nothing
about which country it holds. Only a place BELOW country level needs no such check.

**Step 3 — classify what REMAINS**, and act on every part of it:

- **Nothing remains** (the country was the entire instruction) → **STOP HERE. Call
  NOTHING.** Do not continue to PHASE 1: `leadbay_refine_prompt` would overwrite my
  qualitative audience prompt and kick off an intelligence recompute to express a scope
  this workspace already has. Tell me there is nothing to set because the workspace
  already covers exactly that, offer the axes that do narrow an audience (sector, size,
  or a sub-country region / state / county / city), and end your turn.
- **A DIFFERENT country** ("partout en France" on a US workspace) → **STOP HERE too, but
  do not say "there is nothing to set" — that is false.** The ask is UNSUPPORTED, not
  already-satisfied: this workspace holds only its own country's companies, so there are
  no leads there to scope to. Say so plainly, do not offer an unfiltered view as if it
  answered the request, and end your turn. If a qualitative part rode along with it, say
  it cannot be applied to a country that is not here either.
- **A supra-national scope** ("EU-wide", "EMEA") → stop as well: name what the workspace
  covers and ask whether I want that instead, rather than assuming it.
- **A sub-country place** ("prospects in Texas", "restrict to Indre-et-Loire") → a place
  is not a qualitative refinement: route it to `leadbay_adjust_audience({locations: [...]})`
  and say why. If a qualitative part ALSO remains, continue to PHASE 1 with that part —
  do not drop half the request.
- **A qualitative refinement** → continue to PHASE 1, passing the STRIPPED text and never
  the raw instruction.

**One workspace = one country — a country name is NEVER a location filter.** The admin-area index holds no country nodes, so `"France"` matches the *commune of Francs* and `"United States"` matches *Statesboro*: the call is silently fenced to one village and every conclusion from it is wrong. City AND country named? Keep the city, drop the country.

**On `code: "COUNTRY_LEVEL_LOCATION"` read `country_locations[].axis` and `[].kind` — the recovery differs per case and they are NOT interchangeable, and do NOT retry with another spelling or a nearby city.**

`axis: "include"`:

- `home_country`, or "nationwide" / "everywhere" → drop that ONE value. Omit the geo argument (`city` / `locations` / `location_ids`) only if nothing else was on it — then the result covers the whole workspace. If other values remain, keep them and describe the result as those places.
- `foreign_country` ("leads in France" on a US workspace) → **unsupported, not unfiltered.** Do NOT re-run without the argument: whole-workspace results are US leads and answer nothing about France. Say the workspace holds only its own country's companies.
- `supranational` ("EU", "EMEA") → name what the workspace covers, then offer the whole-workspace view as an explicit choice rather than assuming it.
- `country_indeterminate` (custom/staging backend) → its country is unknown, so claim nothing about what it holds.

`axis: "exclude"` reverses all of that — **never "omit the argument"**, which returns the very companies the user asked to remove. Excluding this workspace's own country would empty it; excluding any other country is a harmless no-op. Either way drop the value and ask what to carve out instead.

On a lens-WRITING tool (`new_lens`, `adjust_audience`, `update_lens_filter`) write NOTHING, with no re-call in any form: when the country was the only scope, and for ANY non-`foreign_country` `exclude` hit however much else came with it — dropping it and writing the rest inverts the ask.

Place names never go in `keywords`, `sectors` or `refine_prompt` — text matches, not geo filters.


# PHASE 1 — REFINE (only when PHASE 0 classified the instruction as qualitative)
Call `leadbay_refine_prompt` with `prompt=<the STRIPPED instruction from PHASE 0, Step 1>` — the text with any country phrase removed, never the raw instruction.

# PHASE 2 — CLARIFICATION ROUND-TRIP (if needed)

IRON LAW — DO NOT ANSWER CLARIFICATIONS ON THE USER'S BEHALF. If the response includes a `clarification` block, surface the question and options to me VERBATIM and wait. Do NOT call `leadbay_answer_clarification`. I want to choose.

# PHASE 3 — APPLIED OR NOT
If the response status is `applied`, tell me Leadbay is regenerating intelligence and recommend I check back in a few minutes via `leadbay_account_status` (`computing_intelligence` flips to false when ready). If the status is anything else, name it explicitly.

GATE — DEFER TO TOOL RENDERING. When you call a Leadbay composite that ships its own RENDERING block (every composite in 0.9.0+ does), render the response using that block's recipe verbatim — score bars, glyph palette, column order, hide-list, link priorities, all of it. Do NOT substitute prose, a numbered list, or a different column structure even when an orchestrating prompt's body suggests alternate framing. Prompt-specific commentary (motivational nudges, summaries, next-action recommendations) belongs ABOVE or BELOW the canonical table, never in place of it.

If the prompt's body and the tool's RENDERING appear to conflict, the tool's RENDERING wins for the structural layout; the prompt's voice wins for the commentary that surrounds it.
