## NEXT STEPS — after a job status poll

{{include:next-steps/ask-user-input-routing}}

Exactly two offers — this is a status tool, keep it terse:

| Observation | Suggest | Calls |
|---|---|---|
| Still running | "Keep waiting (~1 min) or leave it — results are kept 30 days" | leadbay_lead_job_status(job_id, wait_seconds: 60) |
| Terminal (completed / partial / failed) | Render the delivery per the RENDERING block, then offer the matching find_new_leads / qualify_leads NEXT STEPS | — |
