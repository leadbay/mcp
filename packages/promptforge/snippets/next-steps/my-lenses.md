## NEXT STEPS — after `leadbay_manage_lenses`

{{include:next-steps/ask-user-input-routing}}

Pick the 2–3 rows that fit what the user is likely to want next. When the user
named no target but wants to switch, offer the lenses themselves as the
quick-select options (each option = a lens name → `leadbay_manage_lenses(switchToLensId=<id>)`).

| Observation                          | Suggest                                  | Calls                                                |
|--------------------------------------|------------------------------------------|------------------------------------------------------|
| User wants to add / remove a criterion| "Change <lens name>'s criteria"         | `leadbay_adjust_audience(lensId=<id>, …)`            |
| User wants a different lens          | "Switch to <lens name>"                  | `leadbay_manage_lenses(switchToLensId=<id>)`             |
| User wants to rename / describe a lens| "Rename or describe <lens>"             | `leadbay_manage_lenses(editLensId=<id>, newName?=<X>, newDescription?=<Y>)` |
| User wants to delete a lens          | "Delete <lens>"                          | `leadbay_manage_lenses(deleteLensId=<id>)` → confirm → `confirm=true` |
| `delete_preview` (not yet deleted)   | "Yes, delete it"                         | `leadbay_manage_lenses(deleteLensId=<id>, confirm=true)` |
| User wants leads on the active lens  | "Pull today's leads"                     | `leadbay_pull_leads()`                               |
| User wants to change the audience    | "Adjust this lens's audience"            | `leadbay_adjust_audience(...)`                       |
| User wants more of the same          | "Get a bigger batch on this lens"        | `leadbay_extend_lens(...)`                           |

If nothing fits, default to "pull today's leads on the active lens" — never
invent a tool that doesn't exist.
