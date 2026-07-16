## RENDERING — import result summary (single-record, terse)

The response carries either a completed result or an async handle. Render a brief summary; do NOT enumerate every imported lead.

**Dry run first:** if the result has `dry_run:true` (or ANY `not_imported` row has `reason: "dry_run"`), this was a VALIDATION pass — nothing was committed. Render `"🔎 Dry run — V rows validated OK, nothing imported yet. Re-run without dry_run to commit."` where V = the count of `dry_run` rows. If malformed rows are ALSO present (`reason: "malformed"`), list those separately as `"⚠ M rows can't be imported as-is: <row · malformed>"` so the validation count is never swallowed. Do NOT use the pending-crawl/need-attention bucket header below for a dry run (those buckets are for a real committed import).

Otherwise, partition `not_imported` by `reason` into these buckets before you write the header:

- **Pending crawl** — `reason: "uncrawled"` **AND the row has a `domain`**: Leadbay just hasn't crawled that domain yet and will add the lead asynchronously. These are NOT failures. (The label doesn't verify the URL resolves — don't claim the site is bad, but don't certify it's valid either. See the note below.)
- **Need attention** — everything else that didn't import:
  - `reason: "uncrawled"` but the row has **no `domain`** (name/CRM-id-only row): there is nothing for Leadbay to crawl, so it will NOT self-resolve — count these under need-attention, not pending crawl, and tell the user to supply a company website/identity and re-import.
  - `reason` ∈ `malformed` / `internal_error` / `no_match` / `ambiguous`: genuinely un-actionable or needs a follow-up call.

**Header — single line, choose by status:**

- Completed: `"✓ Import complete — N imported · P pending crawl · Q need attention"` (drop any segment whose count is 0)
- Running: `"⏳ Import running — handle_id <id>; poll leadbay_import_status"`
- Pending qualification (`leadbay_import_and_qualify`): `"✓ Imported N leads · qualifying M of them — qualify_id <id>"`

Count `uncrawled` rows as **pending**, never as failures — never say "M failed" when the M is mostly/entirely uncrawled rows.

**When the "need attention" or pending-crawl rows are non-empty**, follow the header with a small bulleted list (≤ 5 items): `<row identifier or domain> · <reason>`. Label each row by its real reason — "pending crawl" for `uncrawled`, and the specific reason otherwise. Frame pending rows reassuringly (Leadbay is crawling them; the leads it adds will populate in the user's Leadbay account as the crawl completes — see the semantics note below for where they show up), not as errors. The full `not_imported` breakdown is already in THIS response — list from it directly; then `"*+N more (see the full not_imported list in the response)*"`.

**When the user's request implied a downstream use** ("import then prep outreach for them"), emit `Imported leadIds: <up to 5 ids, then '+N more'>` — just the ids. Let the next composite render the leads.

Defer the full list of imported leads to `leadbay_pull_leads` or `leadbay_research_lead_by_id` in NEXT STEPS.

{{include:rendering/uncrawled-status}}
