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
| 3 | **Single-domain deep research** — "tell me about acme.com" | `leadbay_research_a_domain` | "Tell me about jaxpartycompany.com" |
| 4 | **CSV import + AI qualification** — "I have 400 attendees, rank the most promising" | `leadbay_import_file` | "I have some leads to import" |
| 5 | **AI qualification on top-N** — "qualify the top 10 of this batch" | `leadbay_qualify_top_n` | "Qualify the top 10 leads in my batch" |
| 6 | **Audience refinement** — "stop showing me X", "I prefer Y" | `leadbay_refine_audience` | "Stop showing me companies with more than 50 employees" |
| 7 | **Account state / prospecting overview** — "where am I, what should I do next" | `leadbay_prospecting_overview` | "Give me an overview of my prospecting" |
| 8 | **Outreach drafting** — "draft me an email to Acme" | *(no dedicated prompt)* | "Draft me an outreach email for JAX PARTY COMPANY LLC" |
| 9 | **Outreach logging + verification** — "I emailed Acme, log it" | `leadbay_log_outreach` | "I just emailed JAX PARTY COMPANY LLC, log it" |
| 10 | **Field sales tour planning** — "I'm visiting Limoges in 4 days — give me 3 customers + 3 qualified + 3 new on one map" | `leadbay_plan_tour_in_city` | "I'm visiting Jacksonville in 3 days — plan my visits" |
| 11 | **Manager-led prospecting via lens-driven campaigns** — manager creates a lens, validates candidates, persists as named campaigns | `leadbay_setup_team_prospecting` | "Set up a prospecting campaign for my team" |
| 12 | **Lens extension — on-demand fill for bigger appetite** — "I want more leads on this lens / I need a bigger batch today" | `leadbay_extend_my_lens` | "I want more leads on this lens — bigger batch today" |
| 13 | **Lens management — list / switch audiences** — "show me my lenses", "which audiences do I have", "switch to my Joinery lens" | `leadbay_my_lenses` | "Show me my lenses and switch to the Joinery one" |
| 14 | **Lens creation — make a named audience** — "create a lens called X for sector Y", "set up a new audience" | `leadbay_new_lens` | "Create a lens called Joinery for the fintech sector" |
| 15 | **Add a contact to a known company** — "this company has no contacts — add Jane Doe, here's her LinkedIn", "add this person I found to that lead" | `leadbay_add_contact` (direct `POST /leads/{id}/contacts`; pass `lead_id` + name + optional linkedin/title/email/phone) | "Acme has no contacts — add Jane Doe, VP Eng, here's her LinkedIn" |
| 16 | **Remove a contact from a company** — "remove this contact", "delete that person, wrong one", "undo the contact I just added" | `leadbay_remove_contact` (archives by the contact's own `contact_id`) | "Remove Jane Doe from that company — I added her by mistake" |
| 17 | **Pin a contact as priority** — "pin this contact", "mark this person as the main contact", "favourite this contact" | `leadbay_pin_contact` (by the contact's own `contact_id`) | "Pin Jane Doe as the main contact on this company" |
| 18 | **Unpin a contact** — "unpin this contact", "remove the pin", "not the priority anymore" | `leadbay_unpin_contact` (by the contact's own `contact_id`) | "Unpin Jane Doe — she's not the priority anymore" |
| 19 | **Update a contact's details** — "update this contact's title", "fix their email/LinkedIn", "edit this person" | `leadbay_update_contact` (by `contact_id`; first/last name required) | "Update Jane Doe's title to SVP Engineering" |
| 20 | **Reprioritize a neglected account** — "what's the history on this account", "why did it resurface", "summarize everything we've done with Acme" — current AI signals + full notes + interaction timeline in one call | `leadbay_account_history` *(no dedicated prompt)* | "What's the full history on this account — is it worth another visit?" |
| 21 | **Artifact proposal gate** — after a lead batch, agent must offer to build a named artifact | `leadbay_daily_check_in` | "Show me today's leads." |
| 22 | **Recurrence routing gate** — recurrence language ("I do this every day") must run the daily DISCOVERY check-in, not misroute to follow-ups | `leadbay_daily_check_in` | "Run my morning check-in — I do this every day." |
| 23 | **Widget overdelivery guard** — when user pre-states full action chain, no "what next?" widget | `leadbay_daily_check_in` | "Show me today's leads and then research the top one for me." |

---

### Workflow contracts

```yaml expected
workflow_name: Daily lead discovery
prompt_name: leadbay_daily_check_in
required_calls:
  - leadbay_account_status
  - leadbay_pull_leads
forbidden_calls:
  - leadbay_report_outreach
required_order:
  - leadbay_account_status
  - leadbay_pull_leads
required_byproducts:
  - "STOP — awaiting user decision"
success_criteria:
  - "called leadbay_account_status exactly once"
  - "called leadbay_pull_leads exactly once"
  - "emitted STOP — awaiting user decision byproduct"
  - "did NOT call leadbay_report_outreach"
  - "did NOT call leadbay_enrich_contacts without explicit user confirmation"
  - "offered to build a named artifact (interactive lead triage board) as the FIRST next-step option"
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

```yaml expected
workflow_name: Add a contact to a known company
prompt_name: ~
required_calls:
  - leadbay_add_contact
forbidden_calls:
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_add_contact with the parent company lead_id plus the person's name (and any linkedin/title given)"
  - "did NOT switch to an external CRM or claim Leadbay can't add contacts"
  - "did NOT call leadbay_report_outreach"
```

```yaml scenario
prompt: "Acme (lead id 11111111-1111-1111-1111-111111111111) has no suggested contacts — add Jane Doe, VP Eng, https://www.linkedin.com/in/janedoe"
```

```yaml expected
workflow_name: Artifact proposal gate
prompt_name: leadbay_daily_check_in
required_calls:
  - leadbay_account_status
  - leadbay_pull_leads
forbidden_calls:
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_account_status and leadbay_pull_leads"
  - "proposed building a named artifact as the FIRST option in the ask_user_input_v0 widget options array — check widget_calls[0].options[0], not just prose"
  - "artifact label is concrete (e.g. 'interactive lead triage board'), NOT generic ('artifact')"
  - "did NOT call leadbay_report_outreach"
```

```yaml scenario
prompt: "Show me today's leads."
```

```yaml expected
workflow_name: Remove a contact from a company
prompt_name: ~
required_calls:
  - leadbay_remove_contact
forbidden_calls:
  - leadbay_dislike_lead
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_remove_contact with the target contact's own contact_id"
  - "did NOT dislike/skip the whole lead (leadbay_dislike_lead) — only the contact was removed"
  - "confirmed the contact was removed"
```

```yaml scenario
prompt: "Remove the contact Jane Doe (contact id 9124b221-281e-413d-8839-84b6f05085a4) from that company — I added her by mistake"
```

```yaml expected
workflow_name: Pin a contact as priority
prompt_name: ~
required_calls:
  - leadbay_pin_contact
forbidden_calls:
  - leadbay_remove_contact
success_criteria:
  - "called leadbay_pin_contact with the target contact's own contact_id"
  - "did NOT remove the contact (leadbay_remove_contact) — only pinned it"
```

```yaml scenario
prompt: "Pin the contact Jane Doe (contact id 9124b221-281e-413d-8839-84b6f05085a4) as the main contact on that company"
```

```yaml expected
workflow_name: Unpin a contact
prompt_name: ~
required_calls:
  - leadbay_unpin_contact
forbidden_calls:
  - leadbay_remove_contact
success_criteria:
  - "called leadbay_unpin_contact with the target contact's own contact_id"
  - "did NOT remove the contact — only cleared the pin"
```

```yaml scenario
prompt: "Unpin the contact Jane Doe (contact id 9124b221-281e-413d-8839-84b6f05085a4) — she's not the priority anymore"
```

```yaml expected
workflow_name: Update a contact's details
prompt_name: ~
required_calls:
  - leadbay_update_contact
forbidden_calls:
  - leadbay_remove_contact
  - leadbay_add_contact
success_criteria:
  - "called leadbay_update_contact with the contact's own contact_id plus first_name + last_name and the changed field"
  - "did NOT add a new contact or remove the existing one — edited in place"
```

```yaml scenario
prompt: "Update the contact Jane Doe (contact id 9124b221-281e-413d-8839-84b6f05085a4) — change her title to SVP Engineering"
```

```yaml expected
workflow_name: Scheduled task proposal gate
prompt_name: leadbay_daily_check_in
routing_mode: true
required_calls:
  - leadbay_account_status
  - leadbay_pull_leads
forbidden_calls:
  - leadbay_report_outreach
success_criteria:
  - "routed to leadbay_daily_check_in (not leadbay_followup_check_in) — recurrence language must not misroute"
  - "called leadbay_account_status and leadbay_pull_leads"
  - "ran the daily check-in (rendered today's leads) rather than treating the request as a one-off lookup"
  - "did NOT call leadbay_report_outreach"
```

```yaml scenario
prompt: "Run my morning check-in — I do this every day."
```

```yaml expected
workflow_name: Widget overdelivery guard
prompt_name: leadbay_daily_check_in
required_calls:
  - leadbay_account_status
  - leadbay_pull_leads
  - leadbay_research_lead_by_id
forbidden_calls:
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_account_status, leadbay_pull_leads, AND leadbay_research_lead_by_id (user pre-stated the research action)"
  - "did NOT emit ask_user_input_v0 after completing the research — user already named the next action so the widget is not needed"
  - "completed the research on the top lead (surfaced contacts, qualification signals, or company details)"
  - "did NOT call leadbay_report_outreach"
```

```yaml scenario
prompt: "Show me today's leads and then research the top one for me."
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
