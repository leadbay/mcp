## NEXT STEPS — after `leadbay_new_lens`

{{include:next-steps/ask-user-input-routing}}

Pick the rows that fit. On `created`, the switch + pull rows are the natural
follow-ups. On `ambiguous_sectors`, the only move is to pick a sector and re-call.

| Observation                       | Suggest                                  | Calls                                                  |
|-----------------------------------|------------------------------------------|--------------------------------------------------------|
| `preview` (not yet created)       | "Yes, create this lens"                  | `leadbay_new_lens(...same args..., confirm=true)`      |
| `preview` (not yet created)       | "Change the sectors/size first"          | (re-ask the user, then `leadbay_new_lens` with new args) |
| Lens created                      | "Switch to it and pull leads"            | `leadbay_my_lenses(switchToLensId=<new id>)` then `leadbay_pull_leads()` |
| Lens created                      | "Refine the audience further"            | `leadbay_adjust_audience(lensName=<new name>, ...)`    |
| Lens created                      | "Leave it; keep my current lens active"  | (no call)                                              |
| `ambiguous_sectors`               | "Pick the right sector and create"       | `leadbay_new_lens(name=..., sectors=[<chosen id>])`    |

If nothing fits, default to "switch to the new lens and pull leads" — never
invent a tool that doesn't exist.
