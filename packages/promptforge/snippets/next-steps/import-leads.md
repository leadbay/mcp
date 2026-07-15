## NEXT STEPS — after an import

{{include:next-steps/ask-user-input-routing}}

| Observation                                    | Suggest                                                       | Calls                                                  |
|------------------------------------------------|---------------------------------------------------------------|--------------------------------------------------------|
| Status: running                                | "Check progress"                                              | leadbay_import_status(handle_id)                       |
| Status: complete, imports succeeded            | "Run AI qualification on the imported leads"                  | leadbay_bulk_qualify_leads([leadIds]) — or use leadbay_import_and_qualify next time |
| Pending-crawl (`uncrawled`) rows present       | "Re-check shortly — Leadbay crawls those domains and adds them later (not failures)" | leadbay_import_status(handle_id)                       |
| Ambiguous / unresolved rows present            | "Resolve the ambiguous rows"                                  | leadbay_resolve_import_rows(records, identity_mappings)|
| `malformed` / bad-mapping rows present         | "Check the org's mappable fields and remap the bad rows"      | leadbay_list_mappable_fields                           |
| User wants to see the imported leads           | "See the imported leads in your view"                         | leadbay_pull_leads                                     |
| User had follow-up intent for the imports      | "Prep outreach for [a specific imported lead]"                | leadbay_prepare_outreach(leadId)                       |
