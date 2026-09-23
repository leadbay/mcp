## NEXT STEPS — after a find_new_leads delivery

{{include:next-steps/ask-user-input-routing}}

Pick the 2-3 that match what happened, never the whole table:

| Observation | Suggest | Calls |
|---|---|---|
| ≥ 1 delivered — offer FIRST | "Build an interactive lead triage board" | leadbay_get_artifact_runtime → CANONICAL recipe, data in hand |
| Free run delivered on-profile leads | "Qualify these N against your criteria (uses quota — `dry_run` first)" | leadbay_qualify_leads(prior_deliveries: {job_id}) |
| Delivered leads look right | "Draft outreach for the top ones" | leadbay_prepare_outreach |
| Delivered 0 or off-profile | "Reshape the example and retry" (name the fix from funnel + scope_notes) | leadbay_find_new_leads (NEW request_id) |
| Stopped at the job's usage cap (`stop_reason: max_cost`) | "Raise the job's cap and get the remaining N" — no amount, no currency | leadbay_find_new_leads, NEW request_id + higher max_cost + `count` = the SHORTFALL (`items_requested` − delivered) + `exclude_lead_ids` = the examined-but-REJECTED ids (novelty covers delivered ones; without these the rerun re-buys the rejected) |
| Stopped on org quota (`stop_reason: quota`) | "Check which window is exhausted and when it resets" — never a re-run: it stops in the same place | leadbay_account_status |
{{commerce}}
| Stopped on quota and the user will not wait | "Top up to finish this run" | leadbay_create_topup_link |
{{/commerce}}
| User wants these tracked in Leadbay | "Add the keepers to a campaign" | leadbay_create_campaign / leadbay_add_leads_to_campaign |
