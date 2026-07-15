## RENDERING — import result summary (single-record, terse)

The response carries either a completed result or an async handle. Render a brief summary; do NOT enumerate every imported lead.

Partition `not_imported` by `reason` into TWO buckets before you write the header:

- **Pending crawl** — `reason: "uncrawled"`: the website is real, Leadbay just hasn't crawled that domain yet and will add the lead asynchronously. These are NOT failures. (See the note below.)
- **Need attention** — `reason` ∈ `malformed` / `internal_error` / `no_match` / `ambiguous`: genuinely un-actionable or needs a follow-up call.

**Header — single line, choose by status:**

- Completed: `"✓ Import complete — N imported · P pending crawl · Q need attention"` (drop any segment whose count is 0)
- Running: `"⏳ Import running — handle_id <id>; poll leadbay_import_status"`
- Pending qualification (`leadbay_import_and_qualify`): `"✓ Imported N leads · qualifying M of them — qualify_id <id>"`

Count `uncrawled` rows as **pending**, never as failures — never say "M failed" when the M is mostly/entirely uncrawled rows.

**When the "need attention" or pending-crawl rows are non-empty**, follow the header with a small bulleted list (≤ 5 items): `<row identifier or domain> · <reason>`. Label each row by its real reason — "pending crawl" for `uncrawled`, and the specific reason otherwise. Frame pending rows reassuringly (Leadbay is crawling them; re-check with `leadbay_import_status`), not as errors. Then `"*+N more — leadbay_import_status for full detail*"`.

**When the user's request implied a downstream use** ("import then prep outreach for them"), emit `Imported leadIds: <up to 5 ids, then '+N more'>` — just the ids. Let the next composite render the leads.

Defer the full list of imported leads to `leadbay_pull_leads` or `leadbay_research_lead_by_id` in NEXT STEPS.

{{include:rendering/uncrawled-status}}
