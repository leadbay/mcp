## RENDERING — identity pass (`rows[]`)

`rows[]` replaces `leads[]`: one row per company, in the user's order. One
table: **Company** (`input`, plus `name` when it differs) · **Website** ·
**LinkedIn**. Skipped rows stay in it: `not_in_universe` → "not in Leadbay",
`low_confidence_identity` → "several matches — add a city or website".

Then ONE coverage line from `summary`: found `resolved` of `rows_total` ·
`with_website` with a website · `with_linkedin` with a LinkedIn ·
`ambiguous` unclear · `not_found` not found. When most rows lack what the
user asked for, that line is the answer: say so, and do not look the
missing ones up one by one.

Done job with `next_poll.offset`: say "showing N of `rows_total`" and offer
the rest via `leadbay_lead_job_status(job_id, compact: true, offset)`.

`file` set (local install only): every row is saved there as a CSV. Give the
user that path.
