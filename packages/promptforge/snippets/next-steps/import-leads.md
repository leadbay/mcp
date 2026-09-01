## NEXT STEPS — after an import

{{include:next-steps/ask-user-input-routing}}

| Observation                                    | Suggest                                                       | Calls                                                  |
|------------------------------------------------|---------------------------------------------------------------|--------------------------------------------------------|
| Status: running, `handle_id` present           | "Check progress"                                              | leadbay_import_status(handle_id)                       |
| Status: running with `timed_out:true`          | "Check progress" — NOT "retry the import"                     | leadbay_import_status(importIds, dry_run if the result carried it) after ~30s; `result.leads` carries the leadIds once complete |
| `rows_pending_upload` present                  | "Import the rows that never got submitted"                    | leadbay_import_leads (that subset only)                |
| Status: complete, imports succeeded            | "Run AI qualification on the imported leads"                  | leadbay_bulk_qualify_leads([leadIds]) — or use leadbay_import_and_qualify next time |
| Pending-crawl (`uncrawled`) rows present       | "Re-run the import for those domains later, once Leadbay has crawled them" | leadbay_import_leads (re-run with just the uncrawled domains, later — they re-reconcile once crawled). NOTE: not a live-fetch of the added leads; those populate in the user's Leadbay account as the crawl completes |
| Ambiguous / unresolved rows present            | "Resolve the ambiguous rows"                                  | leadbay_resolve_import_rows(records, identity_mappings)|
| `malformed` / bad-mapping rows present         | "Check the org's mappable fields and remap the bad rows"      | leadbay_list_mappable_fields                           |
| User wants to see the imported leads           | "See the imported leads in your view"                         | leadbay_pull_leads                                     |
| User had follow-up intent for the imports      | "Prep outreach for [a specific imported lead]"                | leadbay_prepare_outreach(leadId)                       |
