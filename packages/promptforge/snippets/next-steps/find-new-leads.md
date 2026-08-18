## NEXT STEPS — after a find_new_leads delivery

{{include:next-steps/ask-user-input-routing}}

Pick the 2-3 options that match what actually happened — never all seven:

| Observation | Suggest | Calls |
|---|---|---|
| Job still running (`still_running: true`) | "Check on it in ~1 min" | leadbay_lead_job_status(job_id, wait_seconds: 60) |
| Free run delivered on-profile leads | "Qualify these N against your criteria (paid — `dry_run` first)" | leadbay_qualify_leads(prior_deliveries: {job_id}) |
| Delivered leads look right | "Draft outreach for the top ones" | leadbay_prepare_outreach |
| Delivered 0 or off-profile | "Reshape the example and retry" (name the fix from funnel + scope_notes) | leadbay_find_new_leads (NEW request_id) |
| Stopped at cost cap (`stop_reason: max_cost`) | "Raise the cap to X and continue" — X in the account's currency per the funnel-line rule, never a hard-coded `$` | leadbay_find_new_leads, NEW request_id + higher max_cost (a same-id re-submit only dedupes onto a LIVE job) |
| Stopped on org quota (`stop_reason: quota`) | "Wait for the reset, or top up" — never a re-run: it cannot clear an org quota and burns a submit slot to stop in the same place | leadbay_account_status, then leadbay_create_topup_link |
| User wants these tracked in Leadbay | "Add the keepers to a campaign" | leadbay_create_campaign / leadbay_add_leads_to_campaign |
