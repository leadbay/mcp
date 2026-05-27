# Leadbay MCP — Supported workflows

This is the canonical map from user intent → MCP assets → tests.

When an incoming ask matches a row, you have an answer. When it doesn't, add a row (in "Supported", "Partial", "Planned", or "Needs backend") and link the originating issue.

This file is normative: a small audit (`packages/mcp/test/audit/workflows.test.ts`) asserts every backtick'd `leadbay_*` identifier resolves to a registered tool/prompt and every Tests path exists on disk. CI fails when the table drifts from reality.

---

## Supported today

| # | User story | MCP assets | Tests | Notes |
|---|---|---|---|---|
| 1 | **Daily lead discovery** — "show me today's leads / fresh prospects / what's in my inbox" | `leadbay_pull_leads` · `leadbay_account_status` · prompt `leadbay_daily_check_in` | `packages/mcp/test/audit/routing-block.test.ts` · `packages/mcp/test/smoke/live.test.ts` | Canonical entry point. |

```yaml expected
workflow_name: Daily lead discovery
prompt_name: leadbay_daily_check_in
required_calls:
  - leadbay_account_status
  - leadbay_pull_leads
  - leadbay_research_lead_by_id
forbidden_calls:
  - leadbay_report_outreach
required_order:
  - leadbay_account_status
  - leadbay_pull_leads
  - leadbay_research_lead_by_id
required_byproducts:
  - "STOP — awaiting user decision"
success_criteria:
  - "called leadbay_account_status exactly once"
  - "called leadbay_pull_leads exactly once"
  - "called leadbay_research_lead_by_id at least once on the top-scoring lead"
  - "emitted STOP — awaiting user decision byproduct"
  - "did NOT call leadbay_report_outreach"
  - "did NOT call leadbay_enrich_contacts without explicit user confirmation"
```

```yaml scenario
prompt: "Show me today's leads"
```

| 2 | **Follow-up check-in (incl. travel/geo)** — "leads I should follow up with", "before my trip to Berlin", "who should I re-engage" | `leadbay_pull_followups` · `leadbay_followups_map` · `leadbay_research_lead_by_id` · `leadbay_prepare_outreach` · prompt `leadbay_followup_check_in` | `packages/mcp/test/audit/routing-block.test.ts` · `packages/mcp/test/smoke/live.test.ts` | Geo flow renders via the host's `places_map_display_v0` widget. Map covers Monitor leads only — see Partial P1. |

```yaml expected
workflow_name: Follow-up check-in
prompt_name: leadbay_followup_check_in
required_calls:
  - leadbay_pull_followups
forbidden_calls:
  - leadbay_pull_leads
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_pull_followups at least once (Monitor view)"
  - "did NOT call leadbay_pull_leads (wrong entry point for follow-up queries)"
  - "did NOT call leadbay_report_outreach"
```

```yaml scenario
prompt: "What leads should I follow up with?"
```

| 3 | **Single-domain deep research** — "tell me about acme.com" | `leadbay_research_lead_by_name_fuzzy` · `leadbay_research_lead_by_id` · prompt `leadbay_research_a_domain` | `packages/mcp/test/research-lead-markdown.test.ts` · `packages/mcp/test/audit/routing-block.test.ts` | |

```yaml expected
workflow_name: Single-domain research
prompt_name: leadbay_research_a_domain
required_calls:
  - leadbay_research_lead_by_name_fuzzy
forbidden_calls:
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_research_lead_by_name_fuzzy or leadbay_research_lead_by_id at least once"
  - "rendered a research card with company name, score, and contact"
  - "did NOT call leadbay_report_outreach"
```

```yaml scenario
prompt: "Tell me about jaxpartycompany.com"
```

| 4 | **CSV import + AI qualification** — "I have 400 attendees, rank the most promising" | `leadbay_import_leads` · `leadbay_resolve_import_rows` · `leadbay_import_and_qualify` · `leadbay_bulk_qualify_leads` · `leadbay_enrich_titles` · prompt `leadbay_import_file` | `packages/mcp/test/smoke/live.test.ts` · `packages/mcp/test/audit/tool-description-source.test.ts` | Covers #3630 US2 (trade-show prioritization). |

```yaml expected
workflow_name: CSV import + qualify
prompt_name: leadbay_import_file
required_calls:
  - leadbay_import_leads
  - leadbay_bulk_qualify_leads
forbidden_calls:
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_import_leads at least once"
  - "called leadbay_bulk_qualify_leads at least once"
  - "did NOT call leadbay_report_outreach"
```

```yaml scenario
prompt: "I have some leads to import"
```

| 5 | **AI qualification on top-N** — "qualify the top 10 of this batch" | `leadbay_bulk_qualify_leads` · `leadbay_qualify_status` · prompt `leadbay_qualify_top_n` | `packages/mcp/test/smoke/live.test.ts` · `packages/mcp/test/audit/tool-name-convention.test.ts` | |

```yaml expected
workflow_name: AI qualify top-N
prompt_name: leadbay_qualify_top_n
required_calls:
  - leadbay_bulk_qualify_leads
forbidden_calls:
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_bulk_qualify_leads at least once"
  - "rendered a qualification results table"
  - "did NOT call leadbay_report_outreach"
```

```yaml scenario
prompt: "Qualify the top 10 leads in my batch"
```

| 6 | **Audience refinement** — "stop showing me X", "I prefer Y" | `leadbay_refine_prompt` · `leadbay_adjust_audience` · `leadbay_like_lead` · `leadbay_dislike_lead` · `leadbay_set_pushback` · prompt `leadbay_refine_audience` | `packages/mcp/test/audit/tool-name-convention.test.ts` · `packages/mcp/test/audit/tool-description-source.test.ts` | |

```yaml expected
workflow_name: Audience refinement
prompt_name: leadbay_refine_audience
required_calls:
  - leadbay_refine_prompt
forbidden_calls:
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_refine_prompt at least once with the user's instruction"
  - "confirmed the refinement was applied"
  - "did NOT call leadbay_report_outreach"
```

```yaml scenario
prompt: "Stop showing me companies with more than 50 employees"
```

| 7 | **Account state / prospecting overview** — "where am I, what should I do next" | `leadbay_account_status` · prompt `leadbay_prospecting_overview` | `packages/mcp/test/audit/routing-block.test.ts` · `packages/mcp/test/smoke/live.test.ts` | |

```yaml expected
workflow_name: Prospecting overview
prompt_name: leadbay_prospecting_overview
required_calls:
  - leadbay_account_status
forbidden_calls:
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_account_status at least once"
  - "reported remaining quota figures without fabrication"
  - "proposed a concrete next step"
  - "did NOT call leadbay_report_outreach or any mutating tool"
```

```yaml scenario
prompt: "Give me an overview of my prospecting"
```

| 8 | **Outreach drafting** — "draft me an email to Acme" (the user's own LLM writes the body; we hand it the brief) | `leadbay_prepare_outreach` · `leadbay_research_lead_by_id` | `packages/mcp/test/audit/routing-block.test.ts` · `packages/mcp/test/smoke/live.test.ts` | Renders via the host's `message_compose_v1` widget when available. |

```yaml expected
workflow_name: Outreach drafting
prompt_name: ~
required_calls:
  - leadbay_prepare_outreach
forbidden_calls:
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_prepare_outreach at least once with the correct lead ID"
  - "used brief data (company description, contact name, recent signals) in the draft"
  - "did NOT call leadbay_report_outreach (logging is a separate step)"
```

```yaml scenario
prompt: "Draft me an outreach email for JAX PARTY COMPANY LLC"
```

| 9 | **Outreach logging + verification** — "I emailed Acme, log it" | `leadbay_report_outreach` · prompt `leadbay_log_outreach` | `packages/mcp/test/report-outreach-elicit.test.ts` | Verification iron-law: source + ref required. |

```yaml expected
workflow_name: Outreach logging
prompt_name: leadbay_log_outreach
required_calls:
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_report_outreach with source and ref fields populated"
  - "confirmed the outreach was logged"
```

```yaml scenario
prompt: "I just emailed JAX PARTY COMPANY LLC, log it"
```

| 10 | **Field sales tour planning** (#3630 US1) — "I'm visiting Limoges in 4 days — give me 3 customers + 3 qualified + 3 new on one map" | `leadbay_tour_plan` · `leadbay_followups_map` · `leadbay_prepare_outreach` · `leadbay_create_campaign` · `leadbay_add_leads_to_campaign` · prompt `leadbay_plan_tour_in_city` | `packages/mcp/test/audit/tool-name-convention.test.ts` · `packages/mcp/test/smoke/live-campaigns.test.ts` | Mixed-mode itinerary (Monitor + Discover on one map) + optional persistence as a named tour campaign. |

```yaml expected
workflow_name: Field sales tour
prompt_name: leadbay_plan_tour_in_city
required_calls:
  - leadbay_tour_plan
forbidden_calls:
  - leadbay_pull_leads
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_tour_plan with the correct city (not raw pull_followups + pull_leads)"
  - "included Monitor follow-up leads in the itinerary"
  - "included geo-matched Discover leads and excluded non-matching ones"
  - "presented the itinerary as a map or place-card list"
  - "did NOT call leadbay_report_outreach"
```

```yaml scenario
prompt: "I'm visiting Jacksonville in 3 days — plan my visits"
```

| 11 | **Manager-led prospecting via lens-driven campaigns** (#3630 US3) — manager creates a lens, validates candidates, persists as named campaigns | `leadbay_refine_prompt` · `leadbay_create_lens` · `leadbay_promote_lens` · `leadbay_pull_leads` · `leadbay_research_lead_by_id` · `leadbay_create_campaign` · `leadbay_add_leads_to_campaign` · `leadbay_list_campaigns` · `leadbay_campaign_progression` · prompt `leadbay_setup_team_prospecting` | `packages/mcp/test/audit/tool-name-convention.test.ts` · `packages/mcp/test/smoke/live-campaigns.test.ts` | Per-rep visibility is creator-scoped — the prompt surfaces this honestly. Cross-user MCP visibility would need backend work (tracked separately). |

```yaml expected
workflow_name: Team prospecting
prompt_name: leadbay_setup_team_prospecting
required_calls:
  - leadbay_pull_leads
  - leadbay_create_campaign
forbidden_calls:
  - leadbay_report_outreach
success_criteria:
  - "created or activated a lens targeting the audience"
  - "called leadbay_pull_leads to validate the lens"
  - "created at least one named campaign via leadbay_create_campaign"
  - "did NOT call leadbay_report_outreach"
```

```yaml scenario
prompt: "Set up a prospecting campaign for my team"
```

## Needs backend

| # | User story | What blocks it | Upstream |
|---|---|---|---|
| B1 | **Dormant account revival** (#3630 US4) — re-prioritize Monitor accounts with no visit in 12mo, weighted by recent business signals | Custom-field values are filterable but **absent from list output** (confirmed by @jmfouq in the issue thread). Without that, the "no visit in 12mo" filter and historical-context retrieval can't be threaded into MCP responses. | [#3630 US4 + comment](https://github.com/leadbay/product/issues/3630#issuecomment-4500510555) |

---

## How to use this doc

1. **Triaging an incoming ask.** Skim the User story columns. If a row matches, the ask is *Supported* / *Partial* / *Planned* / *Needs backend* — answer with the row number + the Notes / What's missing column.
2. **Adding a new ask.** Add a row in the most accurate table. If you can name a test that already exercises it, it's Supported. If the backend has the primitives but no MCP composite, it's Planned. If the backend is missing the primitives, it's Needs backend — link the product issue.
3. **Promoting a row.** When a Planned row ships, move it to Supported and add the test pointer. When a Needs-backend row unblocks, decide whether it's planned or already-shippable.

## How this stays normative

`packages/mcp/test/audit/workflows.test.ts` parses this file and asserts:

- Every backtick-wrapped `leadbay_*` identifier resolves to a registered tool (from `@leadbay/core`), a registered MCP prompt (from `listPrompts()`), or a Claude Code skill (directory under `.claude-plugin/plugins/leadbay/skills/`). Proposed names for not-yet-shipped tools go in italics, not backticks.
- Every path in a Tests column exists on disk.
- The doc renders to valid markdown table syntax (every data row has the same column count as its header).

That's the entire normative contract. No frontmatter schema, no generator, no separate workflow files.
