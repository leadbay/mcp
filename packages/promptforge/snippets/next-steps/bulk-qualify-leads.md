## NEXT STEPS — after kicking off bulk qualification

Exactly two offers — keep it terse, this is a status tool:

| Observation                          | Suggest                                       | Calls                          |
|--------------------------------------|-----------------------------------------------|--------------------------------|
| Qualification kicked off (async)     | "Check progress in ~30s"                      | leadbay_qualify_status         |
| Job is done / blocking call returned | "Refresh leads view — the new qualifications should be on the top"  | leadbay_pull_leads(lensId = pinned) |
