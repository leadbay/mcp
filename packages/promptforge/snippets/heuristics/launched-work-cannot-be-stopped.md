## A launched job cannot be stopped

Leadbay has no cancel. Once `leadbay_enrich_titles`, `leadbay_bulk_qualify_leads`,
`leadbay_import_leads` or `leadbay_import_and_qualify` has returned, the work is
queued on Leadbay and runs to completion. The user's quota is already committed.

The user cancelling in the chat, a request timeout, or a closed stream stops YOUR
waiting — never the job.

- **Never relaunch after an interruption.** Poll the status tool with the
  `notification_id` / `importIds` you were handed. A second launch spends the
  quota again on the same rows.
- **`cancelled: true` on a result means we stopped watching**, not that the work
  stopped. Rows already uploaded are still being imported.
- Work that has since finished is listed by `leadbay_account_status` under
  `notifications`.
