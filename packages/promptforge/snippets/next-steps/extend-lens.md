## NEXT STEPS — after `leadbay_extend_lens`

{{include:next-steps/ask-user-input-routing}}

Pick the row matching the response `status`. Seed-picking is internal; do NOT add chips that imply the user reviewed candidates.

| `status`                | Suggest                                                       | Calls                                                  |
|-------------------------|---------------------------------------------------------------|--------------------------------------------------------|
| `queued`                | "Pull leads in ~30s to see the new ones"                      | `leadbay_pull_leads()` (after a short wait)            |
| `quota_exceeded`        | "Try with a smaller `extra_count`"                            | `leadbay_extend_lens(extra_count=<smaller>)`           |
| `quota_exceeded`        | "Wait until the daily quota resets at `<resets_at>`"          | (no call — surface the reset time to the user)         |
| `quota_exceeded`        | "Upgrade plan for a higher daily limit"                       | (no call — direct user to contact account manager / sales) |
| `refresh_in_progress`   | "Lens is already filling — pull leads in a minute"            | `leadbay_pull_leads()` (after a short wait)            |
| `no_valid_seeds`        | (silent retry — re-call `leadbay_seed_candidates` then `leadbay_extend_lens`) | internal — only surface if the second attempt also fails |

If nothing matches cleanly, default to "pull leads now to see what's queued" — never invent a tool that doesn't exist.
