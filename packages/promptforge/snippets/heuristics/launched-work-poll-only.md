## A launched job cannot be stopped

Leadbay has no cancel. A job started by `leadbay_enrich_titles`,
`leadbay_bulk_qualify_leads`, `leadbay_import_leads` or
`leadbay_import_and_qualify` runs to completion on Leadbay. The user cancelling
in the chat, a request timeout, or a closed stream stops YOUR waiting, never the
job, and `cancelled: true` on an earlier result means we stopped watching, not
that the work stopped.

**This tool only reads.** Calling it again launches nothing and spends no quota,
so poll it as often as the job needs — a timeout here is a reason to call it
again, not a reason to stop.

What must not be repeated is the LAUNCH. Re-run a launcher only for a subset the
result says never started: `failed[]` entries with `error:"not_queued"`, or a
`rows_pending_upload` count. Never for the whole batch.
