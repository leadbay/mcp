## NEXT STEPS — after the research card

{{include:next-steps/ask-user-input-routing}}

Offer 2–3 follow-ups that match what the lead's response actually contains.

**Primary branching signal**: `contacts.reachable[]` vs `contacts.candidates[]`.
- `contacts.reachable[]` = people with an email or phone right now. Message them directly.
- `contacts.candidates[]` = people identified at this company (LinkedIn-only), `enrichment_done: false`. Cannot be messaged without first calling `leadbay_enrich_titles` (or `leadbay_prepare_outreach({enrich:true})`).
- `_meta.has_reachable_contact` is the boolean shortcut — true iff `reachable.length > 0` or the recommended_contact has a channel.

Always offer a cross-mode pivot at the end so the user can redirect if you guessed wrong.

### MODE A — Nobody reachable yet (`contacts.reachable` is empty)

| Observation                                            | Suggest                                                  | Calls                                                          |
|--------------------------------------------------------|----------------------------------------------------------|----------------------------------------------------------------|
| `contacts.candidates[]` non-empty                      | "Enrich N candidate contacts to acquire emails / phones" | leadbay_enrich_titles({ leadIds: [leadId] })                   |
| User wants outreach now anyway                         | "Enrich + draft outreach in one shot"                    | leadbay_prepare_outreach({ leadId, enrich: true })             |
| `qualification[]` is empty                             | "Run AI qualification on this lead first"                | leadbay_bulk_qualify_leads([leadId])                           |
| `web_insights_fetched_at` older than 30 days           | "Refresh the web research — this is stale"               | leadbay_research_lead_by_id({ leadId }) — re-runs the fetch    |
| User is exploring multiple companies                   | "Back to the lead list"                                  | leadbay_pull_leads                                             |

End MODE A with the pivot offer: `"Want the strategic overview before
enriching? (already shown above)"`

### MODE B — At least one reachable contact (`contacts.reachable[]` non-empty OR recommended_contact has channels)

| Observation                                            | Suggest                                                  | Calls                                                          |
|--------------------------------------------------------|----------------------------------------------------------|----------------------------------------------------------------|
| Recommended contact has an email                       | "Draft the outreach email"                               | leadbay_prepare_outreach({ leadId })                           |
| `firmographics.phone_numbers[]` non-empty              | "Show full call notes + a 60-second opener"              | leadbay_prepare_outreach({ leadId })                           |
| `recent_activities[]` non-empty                        | "Log a follow-up touchpoint"                             | leadbay_report_outreach                                        |
| Adding pre-call context                                | "Add a note to this lead"                                | leadbay_add_note                                               |
| `qualification[]` non-empty                            | "Expand the AI qualification answers"                    | (render qualification[] as a sub-card)                         |

End MODE B with the pivot offer: `"Want to qualify deeper before reaching
out?"`

### Cross-mode rows (always available)

| Observation                                            | Suggest                                                  | Calls                                                          |
|--------------------------------------------------------|----------------------------------------------------------|----------------------------------------------------------------|
| Lead is clearly not a fit (wrong industry, too small)  | "Dislike this lead"                                      | leadbay_dislike_lead({ leadId })                               |
| User is done with this lead                            | "Back to the inbox"                                      | leadbay_pull_leads                                             |
