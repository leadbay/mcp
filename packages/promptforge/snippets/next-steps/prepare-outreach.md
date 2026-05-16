## NEXT STEPS — after the outreach brief

Offer 2–3 follow-ups. Choose based on enrichment state + available channels + history. Always offer the "log outreach" option once the user has clearly contacted someone.

| Observation                                     | Suggest                                                       | Calls                                                  |
|-------------------------------------------------|---------------------------------------------------------------|--------------------------------------------------------|
| `enrichment.triggered && !enrichment.complete`  | "Refresh now to check enrichment progress"                    | leadbay_prepare_outreach(leadId) — re-call             |
| Email available                                 | "Draft the outreach email"                                    | (agent self-drafts inline, using split_ai_summary)     |
| Direct phone available                          | "Draft the 60-second call opener"                             | (agent self-drafts inline)                             |
| LinkedIn URL available                          | "Draft the LinkedIn DM"                                       | (agent self-drafts inline)                             |
| Only company line, no direct phone              | "Draft a switchboard script targeting [Contact]"              | (agent self-drafts; flag uncertainty)                  |
| `additional_contacts_count > 0`                 | "Show me the other N contacts at this company"                | leadbay_get_contacts(leadId)                           |
| History is empty                                | "Pull the strategic overview before drafting"                 | leadbay_research_company(leadId)                       |
| User reports they reached out                   | "Log this outreach — creates prospecting action + outcome"    | leadbay_report_outreach(leadId, contact_id, ...)       |
| User adds context for next time                 | "Save a note on the contact or company"                       | leadbay_add_note                                       |
| After a successful exchange                     | "Update qualification answers based on what you learned"      | leadbay_answer_clarification                           |

The "log outreach" step is the most-important follow-up — it closes the loop and populates history for the next `leadbay_prepare_outreach` call. Detect intent from natural language: "I sent the email", "she didn't pick up", "left a voicemail", "they responded yes/no", etc.
