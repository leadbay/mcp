## NEXT STEPS — after an import

{{include:next-steps/ask-user-input-routing}}

| Observation                                    | Suggest                                                       | Calls                                                  |
|------------------------------------------------|---------------------------------------------------------------|--------------------------------------------------------|
| Status: running                                | "Check progress"                                              | leadbay_import_status(handle_id)                       |
| Status: complete, imports succeeded            | "Run AI qualification on the imported leads"                  | leadbay_bulk_qualify_leads([leadIds]) — or use leadbay_import_and_qualify next time |
| Pending-crawl (`uncrawled`) rows present       | "Re-run the import for those domains later, once Leadbay has crawled them" | leadbay_import_leads (re-run with just the uncrawled domains, later — they re-reconcile once crawled). NOTE: not a live-fetch of the added leads; those populate in the user's Leadbay account as the crawl completes |
| Ambiguous / unresolved rows present            | "Resolve the ambiguous rows"                                  | leadbay_resolve_import_rows(records, identity_mappings)|
| `malformed` / bad-mapping rows present         | "Check the org's mappable fields and remap the bad rows"      | leadbay_list_mappable_fields                           |
| User wants to see the imported leads           | "See the imported leads in your view"                         | leadbay_pull_leads                                     |
| User had follow-up intent for the imports      | "Prep outreach for [a specific imported lead]"                | leadbay_prepare_outreach(leadId)                       |
