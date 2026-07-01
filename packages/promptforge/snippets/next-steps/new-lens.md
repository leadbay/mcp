## NEXT STEPS — after `leadbay_new_lens`

{{include:next-steps/ask-user-input-routing}}

Pick the rows that fit. On `created`, the switch + pull rows are the natural
follow-ups. On `ambiguous_sectors`, the only move is to pick a sector and re-call.

**`created` with `computing_wishlist: true`** — the new lens's leads are being
(re)computed asynchronously. Do NOT fire an immediate `leadbay_pull_leads` and
report "empty" — the lens is warming up, not empty. Tell the user the lens was
created and its leads are streaming in, and offer to pull in ~30s.

| Observation                             | Suggest                                  | Calls                                                  |
|-----------------------------------------|------------------------------------------|--------------------------------------------------------|
| `preview` (not yet created)             | "Yes, create this lens"                  | `leadbay_new_lens(...same args..., confirm=true)`      |
| `preview` (not yet created)             | "Change the sectors/size first"          | (re-ask the user, then `leadbay_new_lens` with new args) |
| Lens created, `computing_wishlist=true` | "Give it ~30s, then pull leads (the wishlist is still computing)" | `leadbay_my_lenses(switchToLensId=<new id>)` then `leadbay_pull_leads()` after ~30s |
| Lens created (no criteria)              | "Switch to it and pull leads"            | `leadbay_my_lenses(switchToLensId=<new id>)` then `leadbay_pull_leads()` |
| Lens created                            | "Refine the audience further"            | `leadbay_adjust_audience(lensName=<new name>, ...)`    |
| Lens created                            | "Leave it; keep my current lens active"  | (no call)                                              |
| `ambiguous_sectors`                     | "Pick the right sector and create"       | `leadbay_new_lens(name=..., sectors=[<chosen id>])`    |

If nothing fits, default to "switch to the new lens and pull leads in ~30s
(the wishlist may still be computing)" — never invent a tool that doesn't exist.
