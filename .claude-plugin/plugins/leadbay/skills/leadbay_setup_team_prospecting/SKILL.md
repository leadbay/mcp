---
name: leadbay_setup_team_prospecting
description: "Manager-led prospecting setup: conversationally turn a natural-language audience ask into a Leadbay lens, validate the candidate leads, and persist them as one or more named campaigns the rep(s) can work through. Closes #3630 US3 end-to-end (within the current creator-scoped campaign visibility model)."
---


Set up manager-led prospecting for me: turn the audience into a lens, validate candidates, then persist as named campaigns.

Audience: **<Natural-language audience description (e.g. 'plumbing companies with 10-50 employees in Seine-Maritime'). The lens-creation step (`leadbay_refine_prompt` → `leadbay_create_lens`) interprets it. If not provided in the user's most recent message, ask once before proceeding.>**
<if the user supplied this argument, render the short block derived from it; otherwise empty. Source: Optional: how to split the validated leads into per-rep campaigns. Free text — e.g. 'split by city' or 'one campaign per rep: John gets Tulsa, Sarah gets OKC'.>

GATE — DEFER TO TOOL RENDERING. When you call a Leadbay composite that ships its own RENDERING block (every composite in 0.9.0+ does), render the response using that block's recipe verbatim — score bars, glyph palette, column order, hide-list, link priorities, all of it. Do NOT substitute prose, a numbered list, or a different column structure even when an orchestrating prompt's body suggests alternate framing. Prompt-specific commentary (motivational nudges, summaries, next-action recommendations) belongs ABOVE or BELOW the canonical table, never in place of it.

If the prompt's body and the tool's RENDERING appear to conflict, the tool's RENDERING wins for the structural layout; the prompt's voice wins for the commentary that surrounds it.


# PHASE 1 — INTERPRET INTENT INTO A LENS

Call `leadbay_refine_prompt({user_prompt: "<the audience (as extracted above)>"})`. This handles the clarification protocol natively — if the system needs more info (e.g. industry disambiguation, geography precision), it returns `status: "clarification_needed"` with options. Surface those to me; on my answer, re-call `leadbay_refine_prompt` until the prompt converges.

When the prompt has converged, call `leadbay_create_lens({user_prompt: <refined>, name: "<short descriptive name>"})` to create a draft lens, then `leadbay_promote_lens({lensId})` to make it the active lens.

# PHASE 2 — PULL + VALIDATE CANDIDATES

Call `leadbay_pull_leads({count: 20, lensId: <the new lens id>})` to surface the top 20 candidates from the freshly-created lens. Render with the canonical `pull_leads` table layout.

Ask me ONCE: "Want me to deep-research the top N for validation?" If yes, call `leadbay_research_lead_by_id` serialized over the top 3-5 (one at a time, max 3 in parallel per the long-running-tools rule). Surface a research summary per lead.

Then ask me ONCE: "Which of these should we drop?" If I name leads to drop, exclude them from the working set. The remaining is the validated set.

# PHASE 3 — DECIDE THE CAMPAIGN SHAPE

If I provided a `rep_split` ("one campaign per rep: John gets Tulsa, Sarah gets OKC"), partition the validated leads accordingly. If I didn't, ask ONCE: "Create one campaign for the whole batch, or split per rep / region / sector?" — surface 2-4 options via `ask_user_input_v0` when available, else as a bulleted list.

For each campaign-shape decision, derive a name. Templates:
- Whole batch: `"<lens-name> – <YYYY-MM-DD>"`
- Per rep: `"<lens-name> – <RepName>"`
- Per region: `"<lens-name> – <RegionName>"`

# PHASE 4 — PERSIST

For each campaign-shape partition, call `leadbay_create_campaign({lead_ids: [...partition], name: "<derived>"})`. Surface the returned `id` + `name` per campaign as a confirmation line.

# PHASE 5 — BE HONEST ABOUT SCOPE

Once the campaigns are created, surface this caveat in plain prose:

> Campaign visibility is currently scoped to the user who CREATED the campaign — the reps won't see these in their own MCP `leadbay_list_campaigns` calls. They CAN see them in the web UI at app.leadbay.ai → Campaigns. Cross-user MCP visibility would need backend work; flag this as a #3630 US3 product gap if your reps work primarily through MCP.

End with a NEXT STEPS chip via `ask_user_input_v0`: "View progression on one of these now?" → routes to `leadbay_campaign_progression`.

# PHASE 6 — STOP

Done. The lens is live, the validated cohort is persisted as named campaigns, and the manager knows where the cross-user-visibility gap is.
