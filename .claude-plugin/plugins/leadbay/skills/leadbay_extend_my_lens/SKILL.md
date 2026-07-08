---
name: leadbay_extend_my_lens
description: "Add more leads to the current lens on demand — for users whose appetite exceeds the standard daily fill. The agent picks seeds silently from what's already on the lens, fires the extra refill, and surfaces the queue confirmation. The user never reviews the seed list."
---


The user wants more leads on the current lens — a bigger batch than what the standard daily fill delivers. Execute the extend flow end-to-end.

GATE — DEFER TO TOOL RENDERING. When you call a Leadbay composite that ships its own RENDERING block (every composite in 0.9.0+ does), render the response using that block's recipe verbatim — score bars, glyph palette, column order, hide-list, link priorities, all of it. Do NOT substitute prose, a numbered list, or a different column structure even when an orchestrating prompt's body suggests alternate framing. Prompt-specific commentary (motivational nudges, summaries, next-action recommendations) belongs ABOVE or BELOW the canonical table, never in place of it.

If the prompt's body and the tool's RENDERING appear to conflict, the tool's RENDERING wins for the structural layout; the prompt's voice wins for the commentary that surrounds it.


# PHASE 1 — PRE-CHECK QUOTA

Call `leadbay_account_status` and find the `LENS_EXTRA_REFILL` entry — in `quota.org.resources[]` first, falling back to `quota.user.resources[]` when `quota.org` is absent (non-admin callers only get the `user` group), matching the type case-insensitively (`LENS_EXTRA_REFILL` / `lens_extra_refill`). If `count` is at/over the daily cap and `extra_count` (when provided) wouldn't fit, **skip PHASE 2 and surface the three options via your host's choice widget (`ask_user_input_v0` or `AskUserQuestion`) now**: smaller count / wait until `resets_at` / upgrade plan. Don't waste a write call you already know will 429.

# PHASE 2 — PICK SEEDS SILENTLY

IRON LAW — DO NOT SHOW THE SEED CANDIDATES TO THE USER. They asked for more leads, not a candidate review. The seed list is internal scaffolding.

Call `leadbay_seed_candidates` (defaults to last-active lens). Pick 3–5 seeds using this priority order:

1. **Engagement** (load-bearing) — `liked: true`, then high `org_contacts_count + prospecting_actions_count`. The user already validated these.
2. **`qq_answers`** — pick candidates whose qualification answers align with the target profile.
3. **`tags`** — purchase-intent alignment.
4. **`sector / size_min / size_max`** — shape similarity.
5. **`ai_agent_score`** — overall AI fit (tie-breaker).

Default heuristic when nothing else differentiates: top 3 by engagement (prefer `liked`; break ties by combined action count), then fill to 5 with the top `ai_agent_score` rows whose `tags` overlap the engagement leaders.

# PHASE 3 — FIRE THE EXTEND

Call `leadbay_extend_lens` with:
- `seed_lead_ids`: the picked `lead_id`s from PHASE 2
- `extra_count`: <How many extra leads to add. Optional. Omit to use the backend default. Optional.> when set, otherwise omit (backend default)
- `lensId`: omit (uses the same default as PHASE 2)

# PHASE 4 — REACT TO STATUS

| `status`                | What to do                                                                                                              |
|-------------------------|-------------------------------------------------------------------------------------------------------------------------|
| `queued`                | ✅ One-line confirmation: "Queued <N> extra leads on lens <id>. Pull in ~30s." Offer `leadbay_pull_leads` as next step. |
| `quota_exceeded`        | Surface the three options via your host's choice widget (`ask_user_input_v0` or `AskUserQuestion`): smaller `extra_count` / wait until `resets_at` / upgrade plan (TIER1=150, TIER2=1000). Do NOT silently retry. |
| `refresh_in_progress`   | "Lens is already filling — pull leads in a minute." Offer `leadbay_pull_leads` after a short wait.                      |
| `no_valid_seeds`        | Silently re-call `leadbay_seed_candidates` and retry `leadbay_extend_lens` once. Only surface to the user if the second attempt also fails. |

Never list `accepted_seeds` to the user. They are internal — the user wants the *outcome* (queue confirmation), not the *picking step*.
