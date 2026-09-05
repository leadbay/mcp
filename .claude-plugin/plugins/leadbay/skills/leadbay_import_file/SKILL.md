---
name: leadbay_import_file
description: "Import a user-supplied CSV/file into Leadbay through five phases with evidence gates — scan, derive, resolve identities, preserve & commit, then optionally qualify and report. The job is to maximize how many rows the Leadbay system actually ingests and matches."
---


Import the user's Leadbay file<if the user supplied this argument, render the short parenthetical or inline clause derived from it; otherwise empty. Source: Path or user-visible name of the CSV/file to import. If omitted, use the file the user attached or referenced.> and satisfy this instruction: <the user-supplied value if any; otherwise a sensible default. Source: Additional user goal, e.g. "then qualify the leads", "preserve owner phone as a custom field", or "only import restaurants in Manhattan".>.

# GOAL — what we're actually trying to do

The job is to **prepare the file so the Leadbay system ingests and matches as many rows as possible**. Every choice you make in the phases below — column mapping, domain derivation, identity resolution, custom-field creation — exists to maximize that match rate. The user shouldn't have to lose data because a header was unusual, a website was missing, or a CRM column had no obvious counterpart in Leadbay.

A job well done has TWO deliverables:
1. **Maximum-coverage column mapping**: every meaningful source column is mapped — to a standard Leadbay field where one exists, to a CONTACT_* field for person columns, to a custom field where no standard fits (including the CRM record link as a special EXTERNAL_ID custom field that's later clickable inside Leadbay), or to a Leadbay note for free-text context. Dropping data is the failure case; finding it a home is the success case.
2. **An augmented file**: the user's original file enriched with a new `LEADBAY_ID` column populated wherever you confidently disambiguated a match. The user keeps this as their audit trail of what got ingested and what didn't.

IRON LAW — NO FABRICATION. Every lead id, contact email, custom field id, mapping decision, and tool argument must trace to a value you read from the file the user attached or to an output from a leadbay_* tool call in this session. Do not invent values. Do not "fill in" a missing leadId with a name match. Do not synthesize a CRM id from a guess. If a value is missing, leave the field blank and say so.


GATE — DEFER TO TOOL RENDERING. When you call a Leadbay composite that ships its own RENDERING block (every composite in 0.9.0+ does), render the response using that block's recipe verbatim — score bars, glyph palette, column order, hide-list, link priorities, all of it. Do NOT substitute prose, a numbered list, or a different column structure even when an orchestrating prompt's body suggests alternate framing. Prompt-specific commentary (motivational nudges, summaries, next-action recommendations) belongs ABOVE or BELOW the canonical table, never in place of it.

If the prompt's body and the tool's RENDERING appear to conflict, the tool's RENDERING wins for the structural layout; the prompt's voice wins for the commentary that surrounds it.


# PHASE 1 — SCAN

Read the file yourself. Inspect every header, sample values from multiple rows, row count, duplicate/blank columns, and obvious dirty data. Build a column preservation plan before importing: for each meaningful column decide standard field, CONTACT_* field, Leadbay note, custom field, derived helper, or skip with a reason. Default to preserving client-provided business data; skip only blank placeholders, duplicate plumbing, raw unparsed blobs after extracting their useful values, or values that would actively harm data quality.

## GATE 1 — COLUMN PRESERVATION PLAN

Before calling any leadbay_* tool, render the COLUMN PRESERVATION PLAN byproduct in your response. Do NOT proceed to PHASE 2 until this table is in your output.

Render this block VERBATIM as your byproduct:

```
COLUMN PRESERVATION PLAN
========================
| Source column      | Disposition                       | Reason                            |
|--------------------|-----------------------------------|-----------------------------------|
| <header from file> | standard:LEAD_NAME                | cleaned company name              |
| <header>           | standard:LEAD_WEBSITE             | domain agrees with brand          |
| <header>           | contact:CONTACT_EMAIL             | per-person mailbox                |
| <header>           | custom:HubSpot record (EXTERNAL_ID)| preserve link via url_template   |
| <header>           | note                              | meaningful per-lead context       |
| <header>           | derived:company_domain            | extracted from biz email          |
| <header>           | skip                              | blank placeholder / dup plumbing  |
========================
```

One row per meaningful source column. If you have 30+ columns, group blank/duplicate-plumbing columns under a single "skip" row with the count.


# PHASE 2 — DERIVE (especially: company domain)

**Domain extraction is the single biggest lever for match success.** A row with a company website resolves cleanly; a row without one drops to name-based fuzzy matching, which is unreliable. Whenever a row has no `website`/`domain` column but DOES have a contact email at a real business domain, derive a `company_domain` (and treat it as `LEAD_WEBSITE` for resolution) — that one move can turn a 60% match rate into 90%.

**Domain extraction is a key factor of match success.** Build semantic helper columns BEFORE resolving identities. The Leadbay matcher leans heavily on `LEAD_WEBSITE`/`company_domain`; rows that arrive without one drop to fuzzy name matching, which is unreliable. Whenever a row lacks a website/domain column but contains a contact email at a real business domain, derive a `company_domain` from the email and treat it as `LEAD_WEBSITE` for resolution — but ONLY when that domain agrees with the company/deal/brand context (do not blindly use whatever's after the @).

Ignore consumer mailbox domains such as gmail.com, hotmail.com, outlook.com, yahoo.com, icloud.com, proton.me/protonmail.com, aol.com, live.com, msn.com, me.com, gmx.*, and similar personal email providers — these are NOT company domains. Also ignore POS/vendor/group domains that conflict with the company (e.g. a `square.com` email on a coffee-shop row is the POS provider, not the shop). Keep the original email for CONTACT_EMAIL.

When in doubt, sample several rows that share a candidate derived domain and confirm the company names cluster sensibly under it before committing.


# PHASE 3 — RESOLVE IDENTITIES

Decide resolver `identity_mappings` from the actual file semantics. Prefer: website/domain/url or **vetted derived business email domain** -> website; cleaned company/account/restaurant/establishment name -> name; CRM/system id -> crm_id; registry/SIREN/SIRET/company number -> registry_number; full address/city/postcode/country/phone/email/socials when present. For HubSpot/deal exports, clean campaign suffixes like BYOC, BYOC only, DD, Uber, trailing separators, and duplicate pipeline labels before using the value as LEAD_NAME. If a column is ambiguous, inspect row values before mapping it. Do not rely on fixed header names.

Call `leadbay_resolve_import_rows` with representative or all rows and your explicit `identity_mappings`. For large files, batch rows so responses stay readable. Use `include_candidate_profiles=true` for small batches or rerun it on ambiguous rows only. If a row is ambiguous and candidate profiles are missing or truncated, rerun just those rows with `include_candidate_profiles=true` and a larger `candidate_profile_limit` before deciding.

Disambiguate relentlessly. Use matched `lead_id` values directly. For ambiguous candidates, first make sure you have enough evidence: rerun the ambiguous rows with `include_candidate_profiles=true` and a larger `candidate_profile_limit` if profiles are truncated, and include every trustworthy source signal available (website, full address, postcode, city, phone, registry/CRM id, source URL path, neighborhood/location words).

Compare addresses intelligently as a human would: recognize ordinary formatting, abbreviation, spelling, punctuation, casing, direction, ordinal, and suite/unit differences without reducing the decision to rigid rules.

Write LEADBAY_ID when candidate facts uniquely agree with strong source evidence: exact registry/CRM id, exact phone, exact canonical website/domain with only one candidate, or name plus clear same-place address match with postcode/city and no conflict. If several candidates share the same website/domain, treat it as a chain/multi-location problem and use street address, postcode, city/neighborhood, phone, source URL path/location slug, and location words in the source name to pick the specific place when exactly one candidate matches.


# WHAT GOOD LOOKS LIKE — the disambiguation bar

A "good" run produces an **augmented file** (input file + a new LEADBAY_ID column) where every row that COULD be confidently matched IS matched, and every row that couldn't is honestly left blank with the reason. Concretely:

- Write LEADBAY_ID when candidate facts uniquely agree with strong source evidence: exact registry/CRM id, exact phone, exact canonical website/domain with only one candidate, or name plus clear same-place address match with postcode/city and no conflict.
- For chain/multi-location problems (several candidates share the same website/domain), use street address, postcode, city/neighborhood, phone, source URL path/location slug, and location words in the source name to pick the specific place when exactly one candidate matches.
- **Never** pick LEADBAY_ID from score alone, name-only, fuzzy-name-only, generic directory websites, root-domain-only, brand-only, postcode-only, or city-only evidence.
- Leave LEADBAY_ID blank only after those checks still leave real ambiguity, and record why in the DECISION LOG.

A row left blank with a clear reason is a SUCCESS, not a failure — it gives the user an honest audit trail. Fabricating an ID is a critical failure.

## GATE 3 — DECISION LOG

Before writing LEADBAY_ID for any ambiguous row, render the DECISION LOG byproduct in your response. One line per row that was not a deterministic match.

Append one line per ambiguous-or-resolved row to the DECISION LOG block:

```
DECISION LOG
============
row <N>: LEADBAY_ID=<id|blank>  evidence=<which signals agreed>  rejected=<why other candidates were not chosen>
row <N>: LEADBAY_ID=<id|blank>  evidence=<...>                   rejected=<...>
============
```

For rows where no resolution was possible, write `LEADBAY_ID=blank evidence=insufficient` and explain in `rejected=` why the available signals were not enough.


# PHASE 4 — PRESERVE & COMMIT

Build a clean records array for import from the preservation plan. Preserve user-requested and semantically meaningful business fields, add LEADBAY_ID where resolved, normalize obvious scalar fields, and split JSON/list blobs into useful scalar columns when they contain real business data. For meaningful columns with no standard Leadbay field, call `leadbay_list_mappable_fields` and create/reuse custom fields rather than dropping the data. Drop blank-header columns and placeholder values like `couldn't find`, `yes`, empty arrays, and raw JSON after useful values have been extracted. Do not preserve scraper plumbing, duplicate blank columns, or long reasoning text, but do preserve meaningful client notes, data-quality warnings that affect outreach, source record links, and evidence URLs when they help the user's workflow.

Treat contact exports and embedded owner/contact data as lead+contact imports. Map the parent company identity columns (LEADBAY_ID/LEAD_WEBSITE/LEAD_NAME/CRM_ID/SIREN) and also map person columns to CONTACT_FIRST_NAME, CONTACT_LAST_NAME, CONTACT_EMAIL, CONTACT_PHONE_NUMBER, CONTACT_TITLE, CONTACT_LINKEDIN. If a restaurant/company row contains structured owners, decision makers, or contact lists, expand those people into additional import rows that repeat the parent lead identity and contain one CONTACT_* person per row. Multiple rows may share the same LEADBAY_ID/company; import each row as a contact for that lead.

**Preserve the source CRM record as a clickable link.** Source CRM URLs/ids — HubSpot, Salesforce, Pipedrive, Close, Attio, or anything similar — are high-value: they let the user click straight from a Leadbay lead back to the original record in their CRM. Don't drop them.

Workflow:
1. Call `leadbay_list_mappable_fields` first; if a suitable EXTERNAL_ID-style field already exists for the source CRM, reuse it.
2. If no suitable field exists, call `leadbay_create_custom_field` with `kind=EXTERNAL_ID` and a `config.url_template` for the specific CRM. Pass the stable object id (not the URL) as the value.

Per-CRM templates — pass the CRM's stable object id as `{value}`:
- **HubSpot**: `https://app.hubspot.com/contacts/<portal-id>/record/0-1/{value}` (companies) or `.../record/0-2/{value}` (contacts) or `.../record/0-3/{value}` (deals)
- **Salesforce**: `https://<your-instance>.lightning.force.com/lightning/r/Account/{value}/view` (Accounts) or `.../Lead/{value}/view`, `.../Contact/{value}/view`, `.../Opportunity/{value}/view`
- **Pipedrive**: `https://<your-domain>.pipedrive.com/organization/{value}` or `.../person/{value}` or `.../deal/{value}`
- **Close**: `https://app.close.com/lead/{value}/`
- **Attio**: `https://app.attio.com/<workspace-slug>/company/{value}`
- **Other CRMs**: ask the user for the URL template; if they don't know, fall back to a TEXT custom field for the full URL.

Preserve raw source identifiers (e.g. `hubspot_id`, `salesforce_account_id`, `associated_deal`, `pipedrive_org_id`) in custom fields when they aren't already represented by a better standard/custom field. If only a full URL exists and no stable id/template can be recovered, create/use a TEXT custom field for the URL.

Leadbay has CONTACT_PHONE_NUMBER but no standard LEAD_PHONE in this tool surface; preserve establishment/company phone only via an intentional custom field.


Preserve notes intentionally. If the file contains meaningful per-lead notes/context that should live as Leadbay notes, keep them aside during import and, after the import returns lead IDs, call `leadbay_add_note` for the relevant imported/resolved leads when that tool is available. For dry runs, report which notes would be written. If lead notes are not available and the user asked to preserve the text, create/reuse an import-notes custom field instead of dropping it.

Build the final mappings yourself. Start from `leadbay_resolve_import_rows.mappings_for_import`, then map semantically: LEADBAY_ID, LEAD_WEBSITE, LEAD_NAME, CRM_ID, SIREN, LEAD_LOCATION*, LEAD_SECTOR, LEAD_SIZE, contact fields, and useful `CUSTOM.<id>` fields. Call `leadbay_list_mappable_fields` before using custom fields.

# PHASE 5 — QUALIFY (optional) + REPORT

Prefer `leadbay_import_and_qualify` when the user asks to qualify/research after import; otherwise use `leadbay_import_leads`. For large files or short client timeouts, pass `wait_for_completion=false` and poll `leadbay_import_status`. After import, qualify only lead IDs returned by the import. Rows that came back `uncrawled` are pending a background crawl (not failures); the leads Leadbay adds for them populate in the user's Leadbay account as the crawl completes — tell the user that, not that a tool call will fetch them (`import_status` refreshes status/progress only; `pull_leads` reads the active lens, so an imported lead outside it may not appear; re-running the import later re-reconciles those companies).

**Deliver the augmented file back to the user**: the original file plus a new `LEADBAY_ID` column populated from the resolution step. This is the second deliverable of a job well done.

## GATE 5 — FINAL REPORT

Before ending the session, render the FINAL REPORT byproduct in your response.

Render the FINAL REPORT block VERBATIM as your byproduct:

```
FINAL REPORT
============
rows read:                 <n>
rows skipped (blank/dup):  <n>
deterministic matches:     <n>
ambiguous left unresolved: <n>
contacts imported:         <n>
notes written or staged:   <n>
custom fields created:     <n>
custom fields reused:      <n>
import IDs / handle IDs:   <list>
leads imported now:        <list-or-count>
needs later polling:       <yes/no, via leadbay_import_status>
============
```

If any field is N/A for this run, render the row with `n/a` instead of dropping it.
