## NEXT STEPS — after a qualify_leads delivery

{{include:next-steps/ask-user-input-routing}}

Pick the 2-3 options that match what actually happened:

| Observation | Suggest | Calls |
|---|---|---|
| Job still running | "Check on it in ~1 min" | leadbay_lead_job_status(job_id, wait_seconds: 60) |
| Fit leads with contacts delivered | "Draft outreach for the qualified ones" | leadbay_prepare_outreach |
| Items skipped `not_in_universe` | "Import those companies first, then re-qualify" | leadbay_import_leads → leadbay_qualify_leads |
| Items skipped `low_confidence_identity` | "Pick the right match" (show `resolution.alternatives`) | leadbay_qualify_leads with the chosen lead_id |
| Contacts delivered without channels | "Get verified emails/phones for the keepers (uses quota — say so first)" | leadbay_qualify_leads(lead_refs with contact_id, channels) |
| Disqualified with evidence | "Review why — adjust qualification questions if the criteria are off" | leadbay_get_qualification_questions |
| Identity pass, list over 500 | "Run the next 500" | leadbay_qualify_leads(next 500, qualify: false) |
| Identity pass, `summary.without_website` > 0. LAST option, never run unasked | "N have no website in Leadbay. Web research can look for one. It uses your plan's quota and may find none." | leadbay_qualify_leads(lead_refs: [{lead_id}] of rows without website, qualify: true) → quote first, confirm on the user's yes |
