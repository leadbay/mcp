## A launched job cannot be stopped

Leadbay has no cancel. Once `leadbay_enrich_titles`, `leadbay_bulk_qualify_leads`,
`leadbay_import_leads` or `leadbay_import_and_qualify` has returned a launched or
running result, that work is queued on Leadbay and runs to completion, and the
quota it costs is already committed. A discovery, preview or `dry_run` result
launched nothing and is not covered here.

The user cancelling in the chat, a request timeout, or a closed stream stops YOUR
waiting, never the job. `cancelled: true` means we stopped watching, not that the
work stopped. What to do next depends on what you are holding:

- **A handle.** Poll the status tool with it, and do not launch the work that
  handle covers a second time — that spends the quota again on the same rows.
  `leadbay_import_status` takes `importIds`, so pass the values of `import_ids`
  under that name. A qualification started by `leadbay_import_and_qualify` has no
  notification of its own: resume it with
  `leadbay_qualify_status({lead_ids, lens_id})`.
- **A handle AND a subset the result says never started** — `failed[]` entries
  with `error:"not_queued"`, or a `rows_pending_upload` count. Poll the handle
  for what was launched and re-run for that subset only, never for the whole
  batch.
- **No result at all**, because the call timed out or the stream closed before it
  returned. Check `leadbay_account_status` first: the launch may have landed and
  finished. Calling the same tool again with the same arguments will usually hand
  back the job already launched rather than starting a second one, but that guard
  is in-memory, five minutes, and per process, so it is best-effort — say what you
  are about to re-run before you spend the user's quota on it.
