## NEXT STEPS — after the follow-ups table

{{include:next-steps/ask-user-input-routing}}

Always include at least one filter-modification offer (users think in filters: by city, by recency, by action type). Filter modification goes through `set_filter: FilterItem` which the composite POSTs to `/monitor/filter` server-side.

| Observation                                   | Suggest                                                  | Calls                                                                                              |
|-----------------------------------------------|----------------------------------------------------------|----------------------------------------------------------------------------------------------------|
| Always (top of menu)                          | "Prep outreach for [top row's contact]"                  | leadbay_prepare_outreach(leadId)                                                                   |
| User named a city / sector / timeframe        | "Refilter by [their phrase]"                             | leadbay_pull_followups(set_filter: { criteria: [...] })                                            |
| `pagination.has_more == true`                 | "Pull the next page"                                     | leadbay_pull_followups(page = current + 1)                                                         |
| ≥3 rows ✨ (never-touched)                    | "Surface only never-touched leads"                       | set_filter with `last_action_date.last_days = 0`                                                   |
| ≥3 rows ⚡ (Trying to reach)                  | "Focus on overdue commitments"                           | set_filter with `last_action.types = ["EPILOGUE_COULD_NOT_REACH_STILL_TRYING"]`                    |
| User planning a trip / in a city              | "Group by city for trip planning"                        | leadbay_pull_followups({city: "<their city>"}) — composite resolves admin_area_id via /geo/search  |
| All rows last action > 60d                    | "Re-qualify — context may have changed"                  | leadbay_bulk_qualify_leads([leadId, ...])                                                          |
| One obvious priority row                      | "Take me to that lead's full brief"                      | leadbay_prepare_outreach(leadId) / leadbay_research_lead_by_id(leadId)                                   |
| User wants to defer a lead                    | "Snooze [Company] for 3 / 6 / 12 months"                 | leadbay_set_pushback({ lead_ids:[leadId], status:"3" })                                            |
| User completed outreach mid-flow              | "Log the outreach + record the outcome"                  | leadbay_report_outreach                                                                            |
| Discovery mode might fit better               | "Looking for NEW leads instead? Switch to discovery."    | leadbay_pull_leads                                                                                 |
Always offer at least one of: prep outreach, refilter, pushback. Pushback is the canonical way to honor "not now" / "next quarter" — leads with active pushback are excluded from this view until expiry.
