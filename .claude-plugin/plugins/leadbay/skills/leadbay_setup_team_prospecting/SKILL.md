---
name: leadbay_setup_team_prospecting
description: "Manager-led prospecting setup: conversationally turn a natural-language audience ask into a Leadbay lens, validate the candidate leads, and persist them as one or more named campaigns the rep(s) can work through. Closes #3630 US3 end-to-end (within the current creator-scoped campaign visibility model)."
---


Set up manager-led prospecting for me: turn the audience into a lens, validate candidates, then persist as named campaigns.

Audience: **<Natural-language audience description (e.g. 'plumbing companies with 10-50 employees in Seine-Maritime'). The lens-creation step (`leadbay_refine_prompt` → `leadbay_create_lens`) interprets it. If not provided in the user's most recent message, ask once before proceeding.>**
<if the user supplied this argument, render the short block derived from it; otherwise empty. Source: Optional: how to split the validated leads into per-rep campaigns. Free text — e.g. 'split by city' or 'one campaign per rep: John gets Tulsa, Sarah gets OKC'. Splitting by country is not a split — the workspace is single-country.>

GATE — DEFER TO TOOL RENDERING. When you call a Leadbay composite that ships its own RENDERING block (every composite in 0.9.0+ does), render the response using that block's recipe verbatim — score bars, glyph palette, column order, hide-list, link priorities, all of it. Do NOT substitute prose, a numbered list, or a different column structure even when an orchestrating prompt's body suggests alternate framing. Prompt-specific commentary (motivational nudges, summaries, next-action recommendations) belongs ABOVE or BELOW the canonical table, never in place of it.

If the prompt's body and the tool's RENDERING appear to conflict, the tool's RENDERING wins for the structural layout; the prompt's voice wins for the commentary that surrounds it.


# PHASE 1 — INTERPRET INTENT INTO A LENS

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


**Before calling, classify any country in my `audience` — the three cases do NOT get the same treatment:**

- **This workspace's own country** ("plumbers across the US" on a US workspace) → drop only that clause and keep everything else. Say you dropped it, then continue: the lens covers the whole workspace anyway.
- **A different country** ("plumbers across France" on a US workspace) → **STOP. Create nothing.** Do NOT drop the country and build a lens for this workspace instead — that would hand me a US lens, plus campaigns, presented as the answer to a France request. Say this workspace holds only its own country's companies, so the ask cannot be filled here, and end your turn.
- **A supra-national scope** ("plumbers across EMEA") → also stop: name what the workspace covers and ask whether I want that instead, rather than assuming it.

Keep any sub-country place (state, *région*, *département*, county, city) exactly as-is.

Call `leadbay_refine_prompt({user_prompt: "<my audience with the home-country clause removed>"})` — pass the SANITIZED text, not the raw argument, or the country label reaches the lens anyway and fences it to a same-named village. This handles the clarification protocol natively — if the system needs more info (e.g. industry disambiguation, geography precision), it returns `status: "clarification_needed"` with options. Surface those to me; on my answer, re-call `leadbay_refine_prompt` until the prompt converges.

When the prompt has converged, call `leadbay_create_lens({user_prompt: <refined>, name: "<short descriptive name>"})` to create a draft lens, then `leadbay_promote_lens({lensId})` to make it the active lens.

# PHASE 2 — PULL + VALIDATE CANDIDATES

Call `leadbay_pull_leads({count: 20, lensId: <the new lens id>})` to surface the top 20 candidates from the freshly-created lens. Render with the canonical `pull_leads` table layout.

Ask me ONCE: "Want me to deep-research the top N for validation?" If yes, call `leadbay_research_lead_by_id` serialized over the top 3-5 (one at a time, max 3 in parallel per the long-running-tools rule). Surface a research summary per lead.

Then ask me ONCE: "Which of these should we drop?" If I name leads to drop, exclude them from the working set. The remaining is the validated set.

# PHASE 3 — DECIDE THE CAMPAIGN SHAPE

If I provided a `rep_split` ("one campaign per rep: John gets Tulsa, Sarah gets OKC"), partition the validated leads accordingly. If I didn't, ask ONCE: "Create one campaign for the whole batch, or split per rep / region / sector?" — surface 2-4 options via your host's choice widget (`ask_user_input_v0` or `AskUserQuestion`) when available, else as a bulleted list.

For each campaign-shape decision, derive a name. Templates:
- Whole batch: `"<lens-name> – <YYYY-MM-DD>"`
- Per rep: `"<lens-name> – <RepName>"`
- Per region: `"<lens-name> – <RegionName>"`

# PHASE 4 — PERSIST

For each campaign-shape partition, call `leadbay_create_campaign({lead_ids: [...partition], name: "<derived>"})`. Surface the returned `id` + `name` per campaign as a confirmation line.

# PHASE 5 — BE HONEST ABOUT SCOPE

Once the campaigns are created, surface this caveat in plain prose:

> Campaign visibility is currently scoped to the user who CREATED the campaign — the reps won't see these in their own MCP `leadbay_list_campaigns` calls. They CAN see them in the web UI at app.leadbay.ai → Campaigns. Cross-user MCP visibility would need backend work; flag this as a #3630 US3 product gap if your reps work primarily through MCP.

End with a NEXT STEPS chip via your host's choice widget (`ask_user_input_v0` or `AskUserQuestion`): "View progression on one of these now?" → routes to `leadbay_campaign_progression`.

# PHASE 6 — STOP

Done. The lens is live, the validated cohort is persisted as named campaigns, and the manager knows where the cross-user-visibility gap is.
