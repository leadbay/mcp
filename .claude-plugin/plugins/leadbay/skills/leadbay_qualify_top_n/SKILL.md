---
name: leadbay_qualify_top_n
description: "Bulk-qualify the top N un-qualified leads in the active lens. Uses leadbay_bulk_qualify_leads with a sensible default budget."
---


Qualify the top <the user-supplied value if any; otherwise a sensible default. Source: How many leads to qualify (default 10, max 25). Higher counts may take 5+ minutes.> un-qualified leads in the active Leadbay lens.

# PHASE 1 — LAUNCH
Call `leadbay_bulk_qualify_leads` with `count=<the count_or_default (as extracted above)>`.

# PHASE 2 — POLL
While it polls, expect notifications / progress events showing per-lead transitions. Surface meaningful ones (e.g. "lead X just finished") to me as they arrive.

# PHASE 3 — SUMMARIZE

When `bulk_qualify_leads` returns, summarize:
- How many qualified (name the count)
- How many are still running (name them, by lead_id + lead name if available, so I can poll again later)
- The 3 highest-`ai_agent_lead_score` leads from THIS batch, with their `qualification_summary` (one sentence each)

# PHASE 4 — RECOMMEND
Recommend the single most-promising lead from this batch and offer to research it deeply with `leadbay_research_lead`. Do not actually call `research_lead` yet — wait for my go.
