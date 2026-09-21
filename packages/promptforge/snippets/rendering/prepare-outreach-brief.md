## RENDERING — outreach brief (single-record card)

Present as the richest single-record card the MCP emits. The user is seconds-to-minutes away from contacting someone — every section earns its place by either (a) telling them HOW to outreach, (b) showing what they've done before, or (c) surfacing what's missing and how to get it.

**Async enrichment.** When `enrichment.triggered && !enrichment.complete`, do NOT block the user. Render the brief with `⏳` on un-enriched channels and IMMEDIATELY draft a first version of the outreach using whatever data IS available (`split_ai_summary.approach_angle`, company-line phone, LinkedIn-search fallback). Tell the user: *"I'll refresh once enriched data lands."* On their next message (or after a clear pause), re-call `leadbay_prepare_outreach(leadId)` without `enrich`; if `enrichment.complete: true`, surface the now-resolved channels and offer to revise the draft.

### Structure

**Header** (H5): `📞 Outreach prep — [Contact name](LinkedIn) · [Company](website)`

- Sub-line: job title · `+N more contacts` when `additional_contacts_count > 0`.
- Prefix `https://` to `website` if it's a bare hostname.

**Score line** (when `lead.score` is present): the 10-segment bar inline, no `<br>`. Same algorithm as `pull_leads`.

**Channel readiness** — a single line of pill chips, ` · `-separated:

- `🔗 LinkedIn` — `profile` (linked to real URL) if `linkedin_page` present; `search` (linked to people-search fallback) otherwise. `⏳` during enrichment.
- `📧 Email` — show address if present; `⏳ enriching` when `enrichment.triggered && !complete`; `⚪ not enriched` otherwise.
- `📞 Phone` — contact-specific number if present; fall back to `lead.phone_numbers[0]` with `(company line)` annotation; `⏳` / `⚪` otherwise.

**H5: 🎯 Angles & approach**

- Render `lead.split_ai_summary.approach_angle` as the lead-in.
- 3–4 bullets distilling `split_ai_summary.next_step`, `signals` and `qualification` into salesperson-voice talking points. Cite `[source](url)` inline when known.
- Final line: `Recommended channel: <X> — <rationale>`. Compute the recommendation from what data is available (email present → email; phone present → call; LinkedIn only → DM).

**H5: 📜 History with [Company name]**

From `history`, newest first: `<date> · <activity type>` per `activities` entry, then the `notes` quote-blocked, each prefixed with its `contact` when set. When a note or an `EPILOGUE_*` entry records a past contact, the draft follows up on it instead of opening cold. Both lists empty: `*No prior touchpoints recorded.*`

**H5: 👥 Other contacts** (only if `additional_contacts_count > 0`)

One line: `+N more contacts at this company — [see them all](leadbay_research_lead_by_id)`.

**Closing line** (when enrichment is in progress): `*Enrichment running — I'll refresh once email/phone lands.*`

**Hide:** `id`, `lead.id`, raw `enrichment.hint` when redundant with channel pills, any field whose value is the string `"null"`, deprecated `other_contacts_count` (use `additional_contacts_count`).

{{include:linking/contact-linkedin}}
{{include:linking/company-socials}}
