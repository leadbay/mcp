## NEXT STEPS — after an import

| Observation                                    | Suggest                                                       | Calls                                                  |
|------------------------------------------------|---------------------------------------------------------------|--------------------------------------------------------|
| Status: running                                | "Check progress"                                              | leadbay_import_status(handle_id)                       |
| Status: complete, imports succeeded            | "Run AI qualification on the imported leads"                  | leadbay_bulk_qualify_leads([leadIds]) — or use leadbay_import_and_qualify next time |
| Ambiguous / unresolved rows present            | "Resolve the ambiguous rows"                                  | leadbay_resolve_import_rows(records, identity_mappings)|
| Failed rows from bad mappings                  | "Check the org's mappable fields and remap"                   | leadbay_list_mappable_fields                           |
| User wants to see the imported leads           | "See the imported leads in your view"                         | leadbay_pull_leads                                     |
| User had follow-up intent for the imports      | "Prep outreach for [a specific imported lead]"                | leadbay_prepare_outreach(leadId)                       |
