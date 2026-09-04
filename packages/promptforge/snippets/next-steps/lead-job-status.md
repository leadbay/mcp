## NEXT STEPS — after a job status poll

{{include:next-steps/ask-user-input-routing}}

Pick the ONE row matching the job's state and offer at most two options — this
is a status tool, keep it terse:

| Observation | Suggest | Calls |
|---|---|---|
| Still running | "Keep waiting (~1 min) or leave it — results are kept 30 days" | leadbay_lead_job_status(job_id, wait_seconds: 60) |
| Terminal (completed / partial / failed) | Render the delivery per the RENDERING block, then offer the matching find_new_leads / qualify_leads NEXT STEPS | — |
| `expired` (past the 30-day window) | "Re-read the billed leads from your delivery ledger" — there is nothing left to render: the job terminalized and its items are no longer listed, so do NOT present an empty delivery as a result | leadbay_qualify_leads(prior_deliveries: {job_id}) |
