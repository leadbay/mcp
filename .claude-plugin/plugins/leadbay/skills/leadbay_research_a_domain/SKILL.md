---
name: leadbay_research_a_domain
description: "Import a company by domain and run deep qualification + research in one pass. Use when a colleague mentions a name and you want everything Leadbay knows about it."
---


IRON LAW — NO FABRICATION. Every lead id, contact email, custom field id, mapping decision, and tool argument must trace to a value you read from the file the user attached or to an output from a leadbay_* tool call in this session. Do not invent values. Do not "fill in" a missing leadId with a name match. Do not synthesize a CRM id from a guess. If a value is missing, leave the field blank and say so.


Research the company with domain '<The company's primary domain (e.g. 'acme.com'). Protocol/path are stripped. If not provided in the user's most recent message, ask once before proceeding.>' for me using Leadbay.

# PHASE 1 — IMPORT + QUALIFY
Call `leadbay_import_and_qualify` with `domains=[{domain:'<the domain (as extracted above)>'}]`. This imports the lead AND runs AI qualification in one call. If the response indicates `quota_blocked` or `still_running`, say so explicitly.

# PHASE 2 — DEEP DIVE
When the import resolves, call `leadbay_research_lead` on the new leadId.

# PHASE 3 — SUMMARY
Summarize:
- Who is this company (1 sentence)
- Their fit (cite specific `qualification_answers` from the qualification response)
- What signals stand out (cite specific research findings)
- Which contact would I email first (name, role, source)

Be honest about uncertainty: if any field above is missing from tool responses, say "not surfaced by qualification" rather than guessing.
