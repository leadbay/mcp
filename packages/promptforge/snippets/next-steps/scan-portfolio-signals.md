## NEXT STEPS — after the signal scan

{{include:next-steps/ask-user-input-routing}}

The scan exists to BUILD A COHORT, not just to list. The default next move is
almost always "turn the matched leads into a campaign."

| Observation                                       | Suggest                                                      | Calls                                                                                  |
|---------------------------------------------------|--------------------------------------------------------------|----------------------------------------------------------------------------------------|
| `matched` non-empty (top of menu)                 | "Build a campaign from the N matched leads"                  | leadbay_create_campaign / leadbay_add_leads_to_campaign(matched lead_ids)              |
| `not_researched` non-empty                        | "K leads aren't researched yet — qualify them, then re-scan" | leadbay_bulk_qualify_leads(not_researched lead_ids) → re-run leadbay_scan_portfolio_signals |
| Zero matches but leads were researched            | "Widen the query (synonyms) or relax `since`"                | leadbay_scan_portfolio_signals(query: "<broader terms>", since: omit-or-earlier)      |
| `truncated_at` set                                | "Scan only covered N — narrow scope or raise the cap"        | leadbay_scan_portfolio_signals({city / set_filter}) or raise `max_leads`              |
| One standout matched lead                          | "Open that lead's full brief"                                | leadbay_research_lead_by_id(leadId)                                                    |
{{commerce}}
| `quota_exceeded`                                  | "Wait for reset OR top up to finish the scan"                | leadbay_create_topup_link                                                              |
{{/commerce}}

NEVER report leads in `not_researched` as if they had no matching signal — they
were never read. Distinguish "no signal X found" (researched, no match) from
"not yet researched" (no data to search) every time.
