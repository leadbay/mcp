# Leadbay MCP — Supported workflows

This is the canonical map from user intent → eval contract.

The table is the human-readable index. The `yaml expected` + `yaml scenario` blocks below each row are the machine-readable SSoT that `/eval` reads — required/forbidden calls and success criteria live there only.

`packages/mcp/test/audit/workflows.test.ts` asserts every backtick'd `leadbay_*` identifier resolves to a registered tool or prompt. CI fails when the table drifts from reality.

---

## Supported today

| # | User story | Prompt | Scenario |
|---|---|---|---|
| 1 | **Daily lead discovery** — "show me today's leads / fresh prospects / what's in my inbox" | `leadbay_daily_check_in` | "Show me today's leads" |
| 2 | **Follow-up check-in (incl. travel/geo)** — "leads I should follow up with", "before my trip to Berlin", "who should I re-engage" | `leadbay_followup_check_in` | "What leads should I follow up with?" |
| 2b | **Follow-up routing (ambiguous phrasing)** — "best leads for today" misfires to `leadbay_pull_leads` even with `leadbay_followup_check_in` active | `leadbay_followup_check_in` | "Show me my best leads for today" |
| 3 | **Single-domain deep research** — "tell me about acme.com" | `leadbay_research_a_domain` | "Tell me about jaxpartycompany.com" |
| 4 | **CSV import + AI qualification** — "I have 400 attendees, rank the most promising" | `leadbay_import_file` | "I have some leads to import" |
| 5 | **AI qualification on top-N** — "qualify the top 10 of this batch" | `leadbay_qualify_top_n` | "Qualify the top 10 leads in my batch" |
| 6 | **Audience refinement** — "stop showing me X", "I prefer Y" | `leadbay_refine_audience` | "Stop showing me companies with more than 50 employees" |
| 7 | **Account state / prospecting overview** — "where am I, what should I do next" | `leadbay_prospecting_overview` | "Give me an overview of my prospecting" |
| 8 | **Outreach drafting** — "draft me an email to Acme" | *(no dedicated prompt)* | "Draft me an outreach email for JAX PARTY COMPANY LLC" |
| 9 | **Outreach logging + verification** — "I emailed Acme, log it" | `leadbay_log_outreach` | "I just emailed JAX PARTY COMPANY LLC, log it" |
| 10 | **Field sales tour planning** — "I'm visiting Limoges in 4 days — give me 3 customers + 3 qualified + 3 new on one map" | `leadbay_plan_tour_in_city` | "I'm visiting Jacksonville in 3 days — plan my visits" |
| 11 | **Manager-led prospecting via lens-driven campaigns** — manager creates a lens, validates candidates, persists as named campaigns | `leadbay_setup_team_prospecting` | "Set up a prospecting campaign for my team" |

---

### Workflow contracts

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

```yaml expected
workflow_name: Follow-up routing (ambiguous discovery phrasing)
prompt_name: leadbay_followup_check_in
required_calls:
  - leadbay_pull_followups
forbidden_calls:
  - leadbay_pull_leads
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_pull_followups (NOT leadbay_pull_leads) — user is in follow-up context, not discovery"
  - "did NOT call leadbay_pull_leads"
  - "did NOT call leadbay_report_outreach"
```

```yaml scenario
prompt: "Show me my best leads for today"
```

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

---

## Needs backend

| # | User story | What blocks it | Upstream |
|---|---|---|---|
| B1 | **Dormant account revival** — re-prioritize Monitor accounts with no visit in 12mo, weighted by recent business signals | Custom-field values are filterable but absent from list output. Without that, the "no visit in 12mo" filter can't be threaded into MCP responses. | [#3630 US4](https://github.com/leadbay/product/issues/3630#issuecomment-4500510555) |

---

## How to use this doc

1. **Triaging an incoming ask.** Skim the User story column. If a row matches, the workflow is supported — read the contract block below for required/forbidden calls.
2. **Adding a new workflow.** Add a row to the table and a `yaml expected` + `yaml scenario` block pair in the contracts section. No TypeScript files needed.
3. **Promoting a row.** When a Needs-backend row unblocks, move it to the table and add contract blocks.

## Running evals

```
/eval --workflow 1
/eval --workflow 1,3,5
/eval
```

The `/eval` skill reads the `yaml expected` + `yaml scenario` blocks from this file directly. Results are saved to `.context/evals/` and viewable via:

```bash
open .context/evals/eval-report.html
```

**Prerequisites:** `.env.eval` at repo root with `LEADBAY_TOKEN=u.xxx` and `LEADBAY_REGION=us`.

## Self-improving evals

Add `--improve` to automatically fix any workflow scoring below 5/5 on any judge dimension (MM, IA, NF, TSF):

```
/eval --workflow 5 --improve
```

Flow:
1. Runs the eval as normal (phases 0–7)
2. Checks all four judge scores (MM, IA, NF, TSF)
3. **If all 5/5** → prints ✓ and stops
4. **If any < 5** → loads `/relentless` and immediately starts the self-improvement loop:
   - Edits the MCP prompt template (`packages/promptforge/prompts/<prompt_name>.md.tmpl`)
   - Rebuilds (`pnpm prompts:build`)
   - Re-runs the eval
   - Loops until all dimensions reach 5/5
5. Dashboard shows all improvement iterations under the **🔄 Self-improve** filter chip

**What gets improved:** prompt templates only — the `.md.tmpl` source files. Never `.generated.ts` files directly.

**Regression guard:** once the target workflow reaches 5/5, the skill runs `/eval --workflow <others>` to confirm no regressions before stopping.

**Note:** for fully unattended runs (no approval prompts), launch with:
```bash
claude --dangerously-skip-permissions
```

## Adding a new eval

Add a row to the table and append a contract pair to the contracts section:

````
```yaml expected
workflow_name: My new workflow
prompt_name: leadbay_my_prompt   # or ~ if no dedicated prompt
required_calls:
  - leadbay_some_tool
forbidden_calls:
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_some_tool with the correct parameters"
  - "did NOT call leadbay_report_outreach"
```

```yaml scenario
prompt: "Do the thing"
```
````

## How this stays normative

`packages/mcp/test/audit/workflows.test.ts` asserts every backtick-wrapped `leadbay_*` identifier resolves to a registered tool or prompt. Proposed names for not-yet-shipped tools go in italics, not backticks.
