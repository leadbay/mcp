## NEXT STEPS — after a find_new_leads delivery

{{include:next-steps/ask-user-input-routing}}

Pick the 2-3 options that match what actually happened — never all six:

| Observation | Suggest | Calls |
|---|---|---|
| Job still running (`still_running: true`) | "Check on it in ~1 min" | leadbay_lead_job_status(job_id, wait_seconds: 60) |
| Free run delivered on-profile leads | "Qualify these N against your criteria (paid — quote `dry_run` estimate first)" | leadbay_qualify_leads(prior_deliveries: {job_id}) |
| Delivered leads look right | "Draft outreach for the top ones" | leadbay_prepare_outreach |
| Delivered 0 or off-profile | "Reshape the example and retry" (state the specific fix from the funnel + scope_notes) | leadbay_find_new_leads (NEW request_id) |
| Stopped at cost cap / quota | "Raise the cap to $X and continue" | leadbay_find_new_leads (SAME request_id re-submits are dedup-safe only for live jobs — use a new request_id with higher max_cost) |
| User wants these tracked in Leadbay | "Add the keepers to a campaign" | leadbay_create_campaign / leadbay_add_leads_to_campaign |
