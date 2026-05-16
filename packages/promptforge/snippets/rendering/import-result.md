## RENDERING — import result summary (single-record, terse)

The response carries either a completed result or an async handle. Render a brief summary; do NOT enumerate every imported lead.

**Header — single line, choose by status:**

- Completed: `"✓ Import complete — N leads imported · M failed · P resolved-with-ambiguity"`
- Running: `"⏳ Import running — handle_id <id>; poll leadbay_import_status"`
- Pending qualification (`leadbay_import_and_qualify`): `"✓ Imported N leads · qualifying M of them — qualify_id <id>"`

**When failures or ambiguous rows are non-empty**, follow the header with a small bulleted list (≤ 5 items): `<row identifier or domain> · <reason>`. Then `"*+N more — leadbay_import_status for full detail*"`.

**When the user's request implied a downstream use** ("import then prep outreach for them"), emit `Imported leadIds: <up to 5 ids, then '+N more'>` — just the ids. Let the next composite render the leads.

Defer the full list of imported leads to `leadbay_pull_leads` or `leadbay_research_lead` in NEXT STEPS.
