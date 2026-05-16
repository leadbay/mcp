## NEXT STEPS — after rendering the pull_leads table

Pick 2–3 items below based on what was actually observed in the response. Surface them as a short bulleted list — do NOT recite the whole table.

| Observation                                                | Suggest                                                      | Calls                                                  |
|------------------------------------------------------------|--------------------------------------------------------------|--------------------------------------------------------|
| `has_more == true`                                         | "Pull the next page (page N+1 of M)"                         | leadbay_pull_leads(page = current + 1, lensId = pinned)|
| ≥ 3 rows have `qualification_summary.answered == 0`        | "Deepen AI qualification on the rows without ❖ caps"         | leadbay_bulk_qualify_leads(leadIds=[…])                |
| User points at a single row                                | "Research [Company] in depth"                                | leadbay_research_lead(leadId)                          |
| User wants the company-level web view                      | "Pull the company-level research for [Company]"              | leadbay_research_company({leadId} or {companyName})    |
| Top row has phone AND email                                | "Prepare an outreach for [Contact] — call + email"           | leadbay_prepare_outreach(leadId)                       |
| Top row has email but no phone                             | "Draft an outreach email for [Contact]"                      | leadbay_prepare_outreach(leadId)                       |
| Top row has phone but no email                             | "Show [Contact]'s call details + a 60-second opener"         | leadbay_prepare_outreach(leadId)                       |
| Top row has contacts but no phone/email                    | "Order contact enrichment to surface email/phone first"      | leadbay_enrich_titles(...) or leadbay_prepare_outreach(leadId, enrich:true) |
| `computing_scores == true` or `computing_wishlist == true` | "Scores are still being computed — re-pull in ~30s"          | leadbay_pull_leads (retry with same lensId)            |
| User wants a narrower / wider audience                     | "Adjust the lens filters (sector / size)"                    | leadbay_adjust_audience(...)                           |

If nothing in the menu applies cleanly, suggest only "pull next page" and "research a specific lead in depth" — never invent a tool that doesn't exist.
