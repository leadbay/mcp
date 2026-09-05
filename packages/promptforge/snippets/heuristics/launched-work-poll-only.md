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

One import state does NOT progress: a chunk cancelled before its mappings were
committed reads `running` / `committing` forever. If the counts hold flat across
several spaced polls, say so and stop, rather than polling on.

What must not be repeated is the LAUNCH — for work that actually launched. Re-run
a launcher only for a subset that never started, never for the whole batch:

- `failed[]` entries with `error:"not_queued"`;
- a `rows_pending_upload` count;
- leads in `still_running` after a CANCELLED `leadbay_import_and_qualify`. Its
  fan-out is sequential, so an interruption leaves the remainder unlaunched and
  folds them in with the ones that did launch. This tool cannot start them. If
  leads there never settle across several spaced polls, launch qualification for
  those ids and leave the rest polling.
