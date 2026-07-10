## NEXT STEPS — after rendering the pull_leads table

{{include:next-steps/ask-user-input-routing}}

Pick 2–3 items below based on what was actually observed in the response. The table is the source of truth for which moves are valid.

| Observation                                                | Suggest                                                      | Calls                                                  |
|------------------------------------------------------------|--------------------------------------------------------------|--------------------------------------------------------|
| ≥ 5 leads returned (any batch)                             | "Build an interactive lead triage board for this batch"      | emit antArtifact from data in hand (do NOT re-call leadbay_pull_leads) |
| ≥ 1 lead returned (any batch)                              | "Enrich top leads" (reveal decision-maker email/phone on the top leads) | leadbay_enrich_titles({ dry_run: true }) — preview the volume + channels first; launch only after the user confirms (never a silent paid reveal) |
| `has_more == true`                                         | "Pull the next page (page N+1 of M)"                         | leadbay_pull_leads(page = current + 1, lensId = pinned)|
| ≥ 3 rows have `qualification_summary.answered == 0`        | "Deepen AI qualification on the rows without ❖ caps"         | leadbay_bulk_qualify_leads(leadIds=[…])                |
| User points at a single row                                | "Research [Company] in depth"                                | leadbay_research_lead_by_id(leadId)                    |
| User only has a name (no leadId in context)                | "Look up [Company] by name"                                  | leadbay_research_lead_by_name_fuzzy(companyName)       |
| Top row has phone AND email                                | "Prepare an outreach for [Contact] — call + email"           | leadbay_prepare_outreach(leadId)                       |
| Top row has email but no phone                             | "Draft an outreach email for [Contact]"                      | leadbay_prepare_outreach(leadId)                       |
| Top row has phone but no email                             | "Show [Contact]'s call details + a 60-second opener"         | leadbay_prepare_outreach(leadId)                       |
| Top row has contacts but no phone/email                    | "Order contact enrichment to surface email/phone first"      | leadbay_enrich_titles(...) or leadbay_prepare_outreach(leadId, enrich:true) |
| `computing_scores == true` or `computing_wishlist == true` | "Scores are still being computed — re-pull in ~30s"          | leadbay_pull_leads (retry with same lensId)            |
| Batch is EMPTY and `computing_wishlist`/`computing_scores == true` (e.g. a just-created lens) | render the `next_steps` widget — it carries "Re-pull in ~30s" (first) + "Refine audience". Do NOT report "no leads": the lens is warming up, not empty | leadbay_pull_leads (retry with same lensId after ~30s) |
| User wants a narrower / wider audience                     | "Adjust the lens filters (sector / size)"                    | leadbay_adjust_audience(...)                           |
| Phase 4 research was run (`research_lead_by_id` called) AND top contacts lack direct email/phone | "Enrich contacts on [Lead1], [Lead2] to get direct emails and phone numbers" | leadbay_enrich_contacts(leadId, contactId) — ONE call per contact (the tool takes a single leadId + contactId, never a list) |
If nothing in the menu applies cleanly, suggest only "pull next page" and "research a specific lead in depth" — never invent a tool that doesn't exist.
