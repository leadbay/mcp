## NEXT STEPS — after the research card

Offer 2–3 follow-ups that match the detected mode. Always offer a cross-mode pivot at the end so the user can redirect if you guessed wrong.

### MODE A (Discovery)

| Observation                                            | Suggest                                            | Calls                                              |
|--------------------------------------------------------|----------------------------------------------------|----------------------------------------------------|
| `qualification[]` is empty                             | "Run AI qualification on this lead"                | leadbay_bulk_qualify_leads([leadId])               |
| ≥1 hot recent item in 📈 business signals              | "Prepare outreach referencing [signal headline]"   | leadbay_prepare_outreach(leadId)                   |
| `contacts_count > len(contacts)` shown                 | "Pull the full contact list (N more)"              | leadbay_get_contacts(leadId)                       |
| `web_insights_fetched_at` > 30 days                    | "Re-run the web research — this is stale"          | leadbay_research_company(leadId) — refresh         |
| User wants the deeper lens-scoped bundle               | "Pull the full lead profile (research_lead)"       | leadbay_research_lead(leadId)                      |
| User is exploring multiple companies                   | "Back to the lead list"                            | leadbay_pull_leads                                 |
| `qualification[]` non-empty                            | "Expand the AI qualification answers"              | (render qualification[] as a sub-card)             |

End MODE A with the pivot offer: `"Want the contact-prep view for [recommended contact name]?"`

### MODE B (Contact preparation)

| Observation                                            | Suggest                                            | Calls                                              |
|--------------------------------------------------------|----------------------------------------------------|----------------------------------------------------|
| `phone_numbers[]` non-empty                            | "Show full call notes + a 60-second opener"        | leadbay_prepare_outreach(leadId)                   |
| Recommended contact has an email                       | "Draft the outreach email"                         | leadbay_prepare_outreach(leadId)                   |
| Neither phone nor email for recommended contact        | "Order contact enrichment first"                   | leadbay_prepare_outreach(leadId, enrich:true) or leadbay_enrich_titles |
| After the user reports a touchpoint                    | "Log the call/email outcome"                       | leadbay_report_outreach                            |
| Adding pre-call context                                | "Add a note to this lead"                          | leadbay_add_note                                   |

End MODE B with the pivot offer: `"Want the full strategic overview instead?"`
