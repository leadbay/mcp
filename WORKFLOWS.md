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
| 3 | **Single-company/domain deep research** — "tell me about Acme / acme.com" — resolves the company from the user's visible Discover, Monitor, and Activate corpus rather than treating the active lens as the whole universe | `leadbay_research_a_domain` | "Tell me about jaxpartycompany.com" |
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
| 24 | **Bulk portfolio signal scan** — "which of my leads acquired a company since 2025", "scan my portfolio for funding signals", "find everyone who changed CEO" — filters a known portfolio by a web-research signal in ONE call instead of looping `leadbay_research_lead_by_id` per lead | `leadbay_scan_portfolio_signals` | "Which of my leads acquired a company since 2025?" |
| 25 | **Output-formatting contract** — the daily discovery table must render as the canonical layout (markdown table, score-bar glyphs, linked contacts), not a prose list or raw numbers | `leadbay_daily_check_in` | "Show me today's leads." |
| 26 | **Follow-up sequence** — multi-turn: discover → research the top lead → draft outreach to it, each turn building on the last | `leadbay_daily_check_in` | *(multi-turn — see `turns:` contract)* |
| 27 | **Prior-context carry-over** — across turns the agent must reuse the lead_id it surfaced earlier rather than re-running discovery | `leadbay_daily_check_in` | *(multi-turn — see `turns:` contract)* |
| 28 | **Send feedback to the team** — "send feedback", "report a bug", "tell Leadbay…", or accepting an offer to report an error — delivers a user-authored message to the Leadbay team's Sentry feedback inbox (same destination as the web app's feedback form) | `leadbay_send_feedback` | "Send feedback to the team: lead scores feel off this week" |
| 29 | **Audience build from dirty taxonomy (no-crash)** — "create a group for menuisiers, pergolas, vérandas" — `leadbay_adjust_audience` must tolerate a null-name sector-taxonomy row and ambiguous matches, returning a graceful ambiguous-sectors message rather than a TypeError (regression lock for the v0.17.3 sector-creation crash) | `leadbay_adjust_audience` | "Create a group for menuisiers, pergolas, vérandas" |
| 30 | **Account status — silent on unreadable quota** — on an org whose `quota_status` 401s (no billing plan, `plan: null`), `leadbay_account_status` must answer user + org WITHOUT mentioning quota, an error, a 401, or telling the user to reconnect / re-authenticate (the token is valid — the same response read the user fine). Regression lock for the product#3761 401-hallucination | `leadbay_account_status` | "What account am I connected to?" |
| 31 | **Account status — never volunteers the lens, name not id** — `leadbay_account_status` must NOT mention the active lens unprompted; and if asked which lens is active, must answer with the lens NAME, never the raw numeric id (e.g. `40005`). Regression lock for the product#3761 lens-hygiene fix | `leadbay_account_status` | "What account am I connected to, and which lens is active?" |
| 32 | **Build an interactive artifact** — "build me a call sheet / interactive lead board with a campaign dropdown, notes, statuses, likes per lead" — the agent fetches headless view-models + usage guide via `leadbay_artifact_kit`, then assembles a single-file HTML artifact whose `lb.field`/`lb.action` view-models POPULATE a dropdown from `leadbay_list_campaigns` and submit `leadbay_report_outreach` / `leadbay_add_leads_to_campaign` / `leadbay_like_lead` (carrying `verification` + `_triggered_by` where required); the artifact owns all rendering | `leadbay_artifact_kit` *(no dedicated prompt)* | "Build me an interactive call sheet for these leads." |
| 33 | **Manager team-activity view** — "how is my team doing", "top performers this month", "activity by rep" — `leadbay_team_activity` returns a per-rep leaderboard (`reps`, sorted by `total_activities`) + an activity time-series (`trend`) for a look-back window, the data behind the web Dashboard-Manager screen. Feeds a manager artifact (`lb.teamActivity` → table + Chart.js); quota/remaining stays on `leadbay_account_status` | `leadbay_team_activity` *(no dedicated prompt)* | "How is my team doing this month?" |
| 34 | **Campaign builder from scratch (solo)** — "build me a campaign from scratch" — one guided flow: discover on the active lens → qualify/pick a cohort → enrich the BUYER PERSONA of the user's product (revenue org, not seniority) with a coverage guarantee → persist via `leadbay_create_campaign` → render the ready-to-work `leadbay_campaign_call_sheet` view, then hand off to `leadbay_work_campaign`. Distinct from the team flow (`leadbay_setup_team_prospecting`) and the work-an-existing-one flow (`leadbay_work_campaign`). | `leadbay_build_campaign` | *(multi-turn — see `turns:` contract)* |
| 35 | **Org qualification questions** — "what qualification questions does Leadbay use", "how are my leads qualified" — retrieve the org-level AI-agent question catalog | `leadbay_get_qualification_questions` | "What qualification questions does Leadbay use to score my leads?" |
| 36 | **Per-lead custom-field values** — "what custom fields are on this lead", "show the CRM custom field values for <Company>" — retrieve the custom-field VALUES stored on one lead (distinct from the definitions catalog in `leadbay_list_mappable_fields`) | `leadbay_get_lead_custom_fields` | "What custom field values are stored on this lead?" |
| 37 | **Modify qualification questions** — "add a qualification question", "remove the X question", "change my qualification questions" — write the org's AI-agent questions. Enforces the max-5 cap and gates removals behind a confirm; does not invent or silently drop questions | `leadbay_set_qualification_questions` | "Remove the qualification question 'hghg', then add it back exactly as it was." |
| 38 | **Modify custom fields** — "create a custom field", "rename the X field", "delete the Y field" — manage the org CRM custom-field catalog. Update renames/retypes in place; delete is destructive and gated behind a confirm | `leadbay_create_custom_field`, `leadbay_update_custom_field`, `leadbay_delete_custom_field` | "Create a custom field called 'Eval Probe Field', then rename it to 'Eval Probe Renamed', then delete it." |
| 39 | **Territory scoping — net-new accounts in a region** — "create a lens for net-new accounts in <département/région/state>", "scope discovery to <territory>", "restrict my rep's lens to <place>" — geography is set on the DISCOVER lens (not just Monitor): `leadbay_new_lens` / `leadbay_adjust_audience` accept `locations` (free text auto-resolved via /geo/search, or admin-area ids), writing a `location_ids` lens-filter criterion. Place names go to `locations`, never `sectors`/`refine_prompt`. Unblocks the "Cockpit Directeur Commercial" territory workflow (product#3759). | `leadbay_new_lens`, `leadbay_adjust_audience` | "Create a lens for net-new accounts in Indre-et-Loire" |
| 40 | **Tour always offers the map (proposes it, renders on yes)** — the core of product#3779: a plain-language tour intent ("I'm visiting Jacksonville in 3 days — who should I go see?") must make the agent recognize the tour, present the leads with mode badges (★ Customer / ★ Qualified / ✦ New), and PROACTIVELY offer to plot them on a map — every run, without the user having to ask. On acceptance it renders via `places_map_display_v0` (or the place-card carousel on hosts without the widget) from the server-shaped `map_locations[]`. | `leadbay_plan_tour_in_city` | "I'm visiting Jacksonville in 3 days — who should I go see?" |
| 41 | **Tour map no-fabrication (overdeliver guard)** — when auto-rendering the tour the agent must pass the server's `map_locations` through verbatim: never invent coordinates / pins for leads that lack them, never fabricate addresses, and never re-emit a competing raw lat/lng table alongside the place cards. Companion to #40. | `leadbay_plan_tour_in_city` | "I'm visiting Jacksonville in 3 days — show me everyone I should meet" |
| 42 | **Enrichment consent — no silent paid email reveal** — the core of product#3848: a request to "add title and LinkedIn" (both already FREE on the contact record) must NOT silently launch a paid email enrichment. `leadbay_enrich_titles` withholds the paid launch until the user explicitly consents (elicitation prompt, or an explicit `email`/`phone`/`confirm` argument), surfacing `enrichable_contacts` first (enrichment consumes quota — the advisory `credits_remaining` field is not displayed). Explicit "go ahead and spend, enrich their emails" still launches. | `leadbay_enrich_titles` | "Add title and LinkedIn to these contacts" |
| 43 | **Enrichment stays active until done (no reprompt)** — the core of product#3866: after the user authorizes a paid enrichment, the agent launches via `leadbay_enrich_titles` (which returns `mode:"launched"` immediately — the job runs async), then STAYS ACTIVE in the same turn: it polls `leadbay_bulk_enrich_status` in a loop until done (`all_done`, or the resolvable set plateaus), and reports the completed enrichment (which contacts got emails/phones, counts, refreshed quota via `leadbay_account_status`) on its own — WITHOUT the user having to ask "is it done yet?". Distinct from Workflow 34 (multi-turn campaign builder, where the user *explicitly* says "wait for enrichment to finish" in turn 3); here it is a SINGLE turn and the stay-active behavior must be automatic. | `leadbay_enrich_titles` | "Pull my current leads and enrich their emails — get me the results in this same reply" |
| 44 | **Pull leads offers "Enrich top leads"** — product#3875: after a `leadbay_pull_leads` on a non-empty batch, the deterministic `next_steps` surfaces an **Enrich top leads** option at position 2 (right after the Triage-board artifact offer) so the discovery→outreach bridge is one click away. It routes to `leadbay_enrich_titles` via the NO-SPEND preview path — previews volume + channels first, spends nothing until the user confirms — so a plain "show me my leads" never triggers an unprompted paid reveal (the #42 consent gate holds). | `leadbay_pull_leads`, `leadbay_enrich_titles` | "Show me my top leads for today" |

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
  - "resolved a name/domain through the visible cross-tab lead corpus unless an explicit lens scope was requested"
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
  - "IF a next step is proposed, it is a concrete action routed through the native choice widget (ask_user_input_v0 / AskUserQuestion), not reflexive prose filler — and proposing none is acceptable when the status read is a complete answer"
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

```yaml expected
workflow_name: Output-formatting contract
prompt_name: leadbay_daily_check_in
required_calls:
  - leadbay_account_status
  - leadbay_pull_leads
forbidden_calls:
  - leadbay_report_outreach
render_checks:
  - "rendered the leads as a markdown table (header row with | column separators), not a prose list or bullet list"
  - "the score column uses the 10-segment bar glyphs (▰ ❖ ▱) in inline code, not a bare numeric score"
  - "each contact is a markdown link [Name](url), never plain text"
  - must_match: "▰|❖|▱"
  - must_not_match: "\\n\\s*[Ss]core:\\s*\\d"
success_criteria:
  - "called leadbay_account_status and leadbay_pull_leads"
  - "did NOT call leadbay_report_outreach"
```

```yaml scenario
prompt: "Show me today's leads."
```

```yaml expected
workflow_name: Follow-up sequence
prompt_name: leadbay_daily_check_in
required_calls:
  - leadbay_pull_leads
  - leadbay_research_lead_by_id
forbidden_calls:
  - leadbay_report_outreach
turns:
  - prompt: "Show me today's leads."
    expect_calls:
      - leadbay_account_status
      - leadbay_pull_leads
  - prompt: "Research the top one for me."
    expect_calls:
      - leadbay_research_lead_by_id
  - prompt: "Draft an outreach email to them."
    expect_calls:
      - leadbay_prepare_outreach
    forbid_calls:
      - leadbay_pull_leads
success_criteria:
  - "ran discovery on turn 1, research on turn 2, and an outreach draft on turn 3"
  - "did NOT call leadbay_report_outreach (drafting is not logging)"
```

```yaml expected
workflow_name: Prior-context carry-over
prompt_name: leadbay_daily_check_in
required_calls:
  - leadbay_pull_leads
  - leadbay_research_lead_by_id
forbidden_calls:
  - leadbay_report_outreach
turns:
  - prompt: "Show me today's leads."
    expect_calls:
      - leadbay_account_status
      - leadbay_pull_leads
  - prompt: "Research the top one for me."
    expect_calls:
      - leadbay_research_lead_by_id
    forbid_calls:
      - leadbay_pull_leads
    carry_over:
      - "passed the SAME lead_id surfaced as the top lead in turn 1 (did not re-run leadbay_pull_leads to rediscover it)"
success_criteria:
  - "reused the top lead from turn 1 in the turn-2 research call without re-running discovery"
  - "did NOT call leadbay_report_outreach"
```

```yaml expected
workflow_name: Lens creation — make a named audience
prompt_name: ~
required_calls:
  - leadbay_new_lens
forbidden_calls:
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_new_lens (with confirm:true once the user has approved the plan) to actually create the lens"
  - "the lens was created (status:created) — NOT an API_ERROR or a 'JSON deserialization error' (the v0.17.3 numeric-base crash: POST /lenses must send `base` as a string)"
  - "did NOT crash while resolving the sector taxonomy"
  - "did NOT call leadbay_report_outreach"
```

```yaml scenario
prompt: "Create a lens called Joinery for the fintech sector"
```

```yaml expected
workflow_name: Audience build from dirty taxonomy (no-crash)
prompt_name: ~
required_calls:
  - leadbay_adjust_audience
forbidden_calls:
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_adjust_audience with the requested sector text"
  - "did NOT crash with a TypeError while scanning the sector taxonomy (a null-name taxonomy row must be tolerated — the v0.17.3 fix)"
  - "when the sectors do not resolve confidently, returned a graceful ambiguous-sectors message naming the unresolved sector text rather than throwing or applying a half-built filter"
  - "did NOT call leadbay_report_outreach"
```

```yaml scenario
prompt: "Create a group for menuisiers, pergolas, vérandas"
```

```yaml expected
workflow_name: Territory scoping — net-new accounts in a region
prompt_name: ~
required_calls:
  - leadbay_new_lens
forbidden_calls:
  - leadbay_report_outreach
success_criteria:
  - "set geography on the DISCOVER lens — called leadbay_new_lens (or leadbay_adjust_audience) with a `locations` argument carrying the named territory, NOT just a Monitor/pull_followups location filter"
  - "passed the place name (e.g. 'Indre-et-Loire') as a location, never as a sector or a refine_prompt instruction"
  - "on a confident geo match the lens filter carried a location_ids criterion; on an ambiguous match returned the ambiguous-locations candidates and re-called with the id rather than guessing"
  - "did NOT call leadbay_report_outreach"
```

```yaml scenario
prompt: "Create a lens for net-new accounts in Indre-et-Loire"
```

```yaml expected
workflow_name: Org qualification questions
prompt_name: ~
required_calls:
  - leadbay_get_qualification_questions
forbidden_calls:
  - leadbay_research_lead_by_id
  - leadbay_get_taste_profile
success_criteria:
  - "called leadbay_get_qualification_questions at least once"
  - "listed the org's qualification questions returned by the tool, verbatim (did not invent or reword them)"
  - "did NOT fabricate a per-lead score or answer — these are org-level questions, not a single lead's responses"
  - "did NOT call leadbay_research_lead_by_id or leadbay_get_taste_profile (this is the focused org-level questions tool)"
```

```yaml scenario
prompt: "What qualification questions does Leadbay use to score my leads?"
```

```yaml expected
workflow_name: Per-lead custom-field values
prompt_name: ~
required_calls:
  - leadbay_get_lead_custom_fields
forbidden_calls:
  - leadbay_list_mappable_fields
success_criteria:
  - "called leadbay_get_lead_custom_fields with a lead id (discovering a lead first if needed)"
  - "reported the lead's custom-field VALUES from the tool result — or, when the result is empty, correctly stated the lead/org has no custom-field values set (did not invent fields or values)"
  - "did NOT call leadbay_list_mappable_fields — that returns field DEFINITIONS (the catalog), not a lead's values"
```

```yaml scenario
prompt: "Pull one of my leads and show me its CRM custom field values."
```

```yaml expected
workflow_name: Modify qualification questions
prompt_name: ~
required_calls:
  - leadbay_set_qualification_questions
forbidden_calls:
  - leadbay_create_custom_field
success_criteria:
  - "removed the named question via leadbay_set_qualification_questions (remove mode) and then re-added it — a round-trip that nets back to the original set"
  - "honored the confirm gate on the removal (re-called with confirm:true after the safety preview, since removing shrinks the list) rather than ignoring it"
  - "reported each step truthfully from the tool result (removed N→N-1, re-added N-1→N) without inventing a change the tool did not return"
  - "only touched the single named question; did NOT drop or rewrite the OTHER questions, and did NOT call leadbay_create_custom_field"
# Self-restoring by construction: the scenario removes a question then adds the
# SAME text back, so the org's question set is identical before and after. The
# eval harness ALSO snapshots + restores the questions around the run as a
# backstop. Never leaves the live org mutated.
```

```yaml scenario
prompt: "Remove the qualification question 'hghg', then add it back exactly as it was."
```

```yaml expected
workflow_name: Modify custom fields
prompt_name: ~
required_calls:
  - leadbay_create_custom_field
  - leadbay_update_custom_field
  - leadbay_delete_custom_field
success_criteria:
  - "created the field, then renamed it via leadbay_update_custom_field, then deleted it via leadbay_delete_custom_field — using the field id returned by create, not a guessed id"
  - "the final delete actually completed (passed confirm:true, or confirmed after the safety preview) so the throwaway field does not linger"
  - "reported each step truthfully from tool results (created / renamed / deleted) without inventing ids or claiming a change the tool did not return"
  - "did NOT touch or delete any OTHER custom field — only the one it just created"
```

```yaml scenario
prompt: "Create a custom field called 'Eval Probe Field', then rename it to 'Eval Probe Renamed', then delete it."
```

#### Workflow 30 — Account status: silent on unreadable quota

```yaml expected
workflow_name: Account status — silent on unreadable quota
prompt_name: leadbay_account_status
required_calls:
  - leadbay_account_status
forbidden_calls:
  - leadbay_report_outreach
render_checks:
  - "did NOT mention quota, usage, limits, credits, a plan-read failure, an error, a 401, or any auth/login/token problem"
  - "did NOT tell the user to reconnect, re-authenticate, refresh the session, or sign in again"
  - "did NOT volunteer the active lens — the user asked only what account they are connected to, not about the lens"
  - must_not_match: "[Rr]econnect|[Rr]e-?authenticate|[Ee]xpired|401|[Rr]efresh your (session|credential)|[Ss]ign in again"
  - must_not_match: "[Qq]uota|usage|credits? remaining|[Pp]lan-read"
  - must_not_match: "[Ll]ens"
success_criteria:
  - "called leadbay_account_status"
  - "reported the user and organization (e.g. account name / org)"
  - "stayed completely SILENT about quota: did not mention quota, usage, an error, a 401, or any auth problem — the quota_status 401 is an internal diagnostic on a plan-less org and the user must never see it (enforced in code: account_status withholds a 401/403 quota_error from the payload entirely)"
  - "did NOT tell the user to reconnect or re-authenticate (the same token read the user/org fine, so the login is valid)"
  - "did NOT volunteer the active lens (enforced in code: the lens is withheld from the payload unless the trigger text asks about it)"
  - "did NOT call leadbay_report_outreach"
```

```yaml scenario
prompt: "What account am I connected to?"
```

#### Workflow 31 — Account status: lens by name, never the raw id

```yaml expected
workflow_name: Account status — lens by name not id
prompt_name: leadbay_account_status
required_calls:
  - leadbay_account_status
forbidden_calls:
  - leadbay_report_outreach
render_checks:
  - "when naming the active lens, used the human-readable lens NAME, never the raw numeric id"
  - must_not_match: "\\blens\\b[^.\\n]{0,40}\\b\\d{4,}\\b"
success_criteria:
  - "called leadbay_account_status"
  - "answered which lens is active using the lens NAME (a human-readable string from last_requested_lens_name), NEVER the raw numeric id like 40005"
  - "did NOT surface the bare numeric lens id to the user"
  - "did NOT call leadbay_report_outreach"
```

```yaml scenario
prompt: "What account am I connected to, and which lens is active?"
```

#### Workflow 34 — Campaign builder — from scratch (solo)

```yaml expected
workflow_name: Campaign builder — from scratch (solo)
prompt_name: leadbay_build_campaign
required_calls:
  - leadbay_pull_leads
  - leadbay_recall_ordered_titles
  - leadbay_enrich_titles
  - leadbay_bulk_enrich_status
  - leadbay_create_campaign
  - leadbay_campaign_call_sheet
forbidden_calls:
  - leadbay_report_outreach
turns:
  - prompt: "Build me a campaign from scratch from my active lens — only leads that are a strong fit for my ICP."
    expect_calls:
      - leadbay_account_status
      - leadbay_pull_leads
  - prompt: "Pick a cohort that's squarely in my ICP, then enrich the contacts who would actually buy what I sell — go ahead and spend, email + phone, up to 10 contacts."
    expect_calls:
      - leadbay_recall_ordered_titles
      - leadbay_enrich_titles
  - prompt: "Wait for enrichment to finish, then create the campaign and show me the full call sheet with everyone's phone and email."
    expect_calls:
      - leadbay_bulk_enrich_status
      - leadbay_create_campaign
      - leadbay_campaign_call_sheet
    forbid_calls:
      - leadbay_pull_leads
    carry_over:
      - "created the campaign with the lead_ids picked in turn 2 (did not re-run leadbay_pull_leads to rediscover them)"
success_criteria:
  - "every lead in the campaign is in the user's ICP (a company that would buy the user's product)"
  - "derived the BUYER PERSONA for the user's product before choosing titles — the account sells a sales-prospecting tool (Leadbay), so the buyer is the revenue org (sales / business development / growth / marketing leadership), and the agent named that persona"
  - "the enriched contacts are PREDOMINANTLY that buyer persona (VP/Head/Director of Sales, Business Development, Account/Carrier Sales, CRO, CMO, Head of Growth; founder/CEO only at small companies) — NOT operations / logistics / COO / finance / IT picked by seniority"
  - "good coverage — the large majority of campaign leads have at least one persona-matching, actionable (email or phone) contact; leads with no persona match are named, not silently left empty"
  - "surfaced enrichable_contacts (the volume) and named the persona before launching enrichment — WITHOUT presenting a 'credits' figure (enrichment consumes quota, not credits; the advisory credits_remaining field is not displayed)"
  - "launched the paid enrichment (email + phone, up to 10 contacts) and polled leadbay_bulk_enrich_status until done before rendering"
  - "created the campaign with the picked lead_ids and rendered the leadbay_campaign_call_sheet view with actionable contacts (phone tel: / email mailto: links)"
  - "did NOT call leadbay_report_outreach (building a campaign is not outreaching)"
```

#### Workflow 35 — Tour always OFFERS the map (proposes it, renders on yes)

The point of #3779: when the user states a tour intent in plain language and
NEVER says "map", the agent must still recognize the tour, present the leads,
and PROACTIVELY OFFER to plot them on a map — every run — rather than dump a
prose list and move on. The map is proposed automatically (the user shouldn't
have to think to ask), then rendered when they accept. This scenario checks the
single-turn shape: tour recognized → leads presented → map explicitly offered.

```yaml expected
workflow_name: Tour offers the map
prompt_name: leadbay_plan_tour_in_city
required_calls:
  - leadbay_tour_plan
forbidden_calls:
  - leadbay_report_outreach
render_checks:
  - "presented the planned tour as a per-lead list (not an empty stub), each lead carrying its mode badge (★ Customer, ★ Qualified, or ✦ New)"
  - "PROACTIVELY OFFERED to put the stops on a map — a clear yes/no proposal the user did not have to ask for (e.g. 'Want me to put these on a map?')"
  - must_match: "★|✦"
  - must_match: "[Mm]ap"
success_criteria:
  - "recognized a field-sales tour intent from plain language ('I'm visiting Jacksonville in 3 days') even though the user never said 'map' or 'on a map'"
  - "called leadbay_tour_plan with Jacksonville (not raw leadbay_pull_followups + leadbay_pull_leads)"
  - "presented the leads grouped/labeled by mode (★ Customer / ★ Qualified / ✦ New) carried from the tool's map_locations notes"
  - "PROACTIVELY offered the map as a next step (a yes/no proposal to plot the stops), without the user having to ask — the offer is the deterministic behavior the tour must always produce"
  - "did NOT call leadbay_report_outreach"
```

```yaml scenario
prompt: "I'm visiting Jacksonville in 3 days — who should I go see?"
```

#### Workflow 36 — Tour map no-fabrication (overdeliver guard)

```yaml expected
workflow_name: Tour map no-fabrication
prompt_name: leadbay_plan_tour_in_city
required_calls:
  - leadbay_tour_plan
forbidden_calls:
  - leadbay_report_outreach
render_checks:
  - "did NOT print a raw latitude/longitude coordinate table or bare lat,lng pairs to the user (coordinates belong in the map widget, not echoed as prose)"
  - must_not_match: "-?\\d{1,3}\\.\\d{3,}\\s*,\\s*-?\\d{1,3}\\.\\d{3,}"
success_criteria:
  - "called leadbay_tour_plan with Jacksonville"
  - "passed the tool's map_locations through faithfully — every company / address / contact stated for a lead traces to that lead's tool data, with no invented business names, addresses, or contacts"
  - "did NOT fabricate coordinates or map pins for leads the tool returned without a location.pos — coordinate-less leads are acknowledged, not given a made-up location"
  - "did NOT echo a competing raw coordinate / lat-lng table alongside the place cards (the map widget owns the pins; the prose names contacts)"
  - "did NOT call leadbay_report_outreach"
```

```yaml scenario
prompt: "I'm visiting Jacksonville in 3 days — show me everyone I should meet"
```

#### Workflow 42 — Enrichment consent (no silent paid email reveal)

```yaml expected
workflow_name: Enrichment consent — no silent paid email reveal
prompt_name: ~
forbidden_calls:
  - leadbay_report_outreach
success_criteria:
  - "did NOT silently launch a paid email enrichment — a bare 'add title and LinkedIn' is not consent to spend"
  - "recognized that title & LinkedIn are already on the contact record (free) and need no paid enrichment"
  - "if it called leadbay_enrich_titles at all, it surfaced enrichable_contacts (the volume) and asked for confirmation before any launch (or got mode:needs_confirmation back and stopped) — WITHOUT presenting a 'credits' figure (enrichment consumes quota; the advisory credits_remaining field is not displayed)"
  - "did NOT claim emails were enriched or reveal email data that was not requested"
```

```yaml scenario
prompt: "Add title and LinkedIn to these contacts"
```

#### Workflow 43 — Enrichment stays active until done (no reprompt)

The core of product#3866: launching an enrichment kicks off an ASYNC backend
job that returns `mode:"launched"` immediately. Historically the agent ended
its turn there and the user had to reprompt to get results. Now the agent must
STAY ACTIVE in the SAME turn — poll `leadbay_bulk_enrich_status` until
`all_done` — and report the finished enrichment on its own. Single-turn: the
user asks once and gets the completed results without a second prompt.

```yaml expected
workflow_name: Enrichment stays active until done (no reprompt)
prompt_name: ~
required_calls:
  - leadbay_pull_leads
  - leadbay_enrich_titles
  - leadbay_bulk_enrich_status
  - leadbay_account_status
required_order:
  - leadbay_pull_leads
  - leadbay_enrich_titles
  - leadbay_bulk_enrich_status
  - leadbay_account_status
forbidden_calls:
  - leadbay_report_outreach
success_criteria:
  - "pulled the current leads first (leadbay_pull_leads) and scoped enrichment to the top 5 — passed the picked leadIds (or candidateCount:5), NOT the tool's default candidate set, so it did not spend quota on more contacts than the user asked for"
  - "launched the paid enrichment via leadbay_enrich_titles after the explicit spend authorization (the user said 'go ahead and spend … and give me the finished results in this same reply, don't make me ask again')"
  - "did NOT stop after the launch ack and force the user to reprompt — stayed active in the same turn"
  - "stayed active on leadbay_bulk_enrich_status until the job was done: if the first read was already all_done (small/fast/already-enriched batch) a single poll is correct; otherwise it kept polling while progress was in-progress/climbing rather than reporting off one still-running read"
  - "set include_contacts=true on the read it reported from, to pull the enriched contacts"
  - "reported the resolved enrichment IN THIS SAME REPLY — which contacts now have emails/phones, per-lead counts, and refreshed quota (via leadbay_account_status; did NOT print a 'credits remaining' line) — and did NOT defer the results to a scheduled re-check / later turn (no ScheduleWakeup punt)"
  - "if progress plateaued below 100% (unresolvable contacts), it stopped polling and reported what resolved, naming the ones with no findable email — did NOT spin forever waiting for all_done"
  - "did NOT fabricate email/phone data — every enriched value traces to the status-poll result, not invented inline"
  - "did NOT call leadbay_report_outreach (getting results is not outreaching)"
```

```yaml scenario
prompt: "Pull my current leads, then enrich the CEO, Owner and Manager emails on the top 5 — go ahead and spend, email channel — and give me the finished results in this same reply, don't make me ask again."
```

#### Workflow 44 — Pull leads offers "Enrich top leads"

product#3875: after a `leadbay_pull_leads` on a non-empty batch, the deterministic
`next_steps` object surfaces an **Enrich top leads** option at position 2 (right
after the Triage-board artifact offer). It's the discovery→outreach bridge —
reveal decision-maker email/phone on the top leads — routed to
`leadbay_enrich_titles` via the NO-SPEND preview path. The underdeliver guard: the
offer must actually appear. The overdeliver guard: a plain "show me my leads" must
NOT trigger an unprompted paid reveal (the #42 consent gate still holds — nothing
is spent until the user picks the option and confirms channels).

```yaml expected
workflow_name: Pull leads offers Enrich top leads
prompt_name: ~
required_calls:
  - leadbay_pull_leads
forbidden_calls:
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_pull_leads exactly once to get today's batch"
  - "surfaced an 'Enrich top leads' next step among the offered options (reveal decision-maker email/phone on the top leads) — did NOT finish without offering the enrichment move"
  - "framed enrichment as a preview-first offer: made clear the volume/channels are previewed and no quota is spent until the user confirms"
  - "did NOT silently launch a paid enrichment — the user only asked to see leads, so it did NOT complete a paid reveal via leadbay_enrich_titles without an explicit go-ahead"
  - "did NOT claim it enriched or revealed any emails/phones"
```

```yaml scenario
prompt: "Show me my top leads for today"
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

**Numbering.** New workflows take the next integer (25, 26, …). Do **not**
create subnumbers (no `2a` / `2b`) — a distinct user story is a new top-level
row, even when it shares a prompt with an existing one.

### Optional contract fields

All four of these are optional. A contract that omits them behaves exactly as
before (single-turn, no render check) — they are backward compatible.

**`render_checks:` — assert the agent rendered the canonical layout.** Use when
the workflow's value is in *how* the output is shaped (table vs prose, score
bars, linked contacts), not just which tools fired. Two entry kinds, freely
mixed in one list:

- **plain strings** → appended to `success_criteria` for the judge to score.
- **`must_match:` / `must_not_match:`** → a regex run mechanically over the
  final agent message (a cheap pre-check, same gate as `required_byproducts`).
  `must_match` fails the run if the pattern is absent; `must_not_match` fails it
  if the pattern is present. The pattern is compiled with JavaScript `RegExp`
  (no flags) — use JS-compatible syntax, **not** inline PCRE flags like
  `(?i)` / `(?m)`. For case-insensitivity use a character class (`[Ss]core`);
  anchor to line starts with `\n` rather than `^`.

```yaml
render_checks:
  - "rendered a markdown table (header row with | separators), not a prose list"
  - "score column uses the 10-segment bar glyphs ▰ ❖ ▱, not a raw number"
  - must_match: "▰|❖|▱"
  - must_not_match: "\\n\\s*[Ss]core:\\s*\\d"
```

**`turns:` — drive a multi-turn conversation** (follow-up sequencing +
prior-context carry-over). When present, `turns:` **replaces** the single
`yaml scenario` block — the two are mutually exclusive. Each turn is one user
message fed in order on the same resumed session, so the agent carries prior
context forward. Per-turn fields:

- `prompt:` (required) — the user message for that turn.
- `expect_calls:` — tools that MUST fire **during that turn**.
- `forbid_calls:` — tools that must NOT fire during that turn.
- `carry_over:` — prose criteria the judge scores with the full multi-turn
  transcript in view. This is how you assert prior-context carry-over (e.g.
  "reused the same lead_id from turn 1 without re-running discovery").

Top-level `required_calls` / `forbidden_calls` remain **session-wide** (the
union across all turns); per-turn `expect_calls` / `forbid_calls` scope to a
single turn.

```yaml expected
workflow_name: My multi-turn workflow
prompt_name: leadbay_my_prompt
required_calls:
  - leadbay_pull_leads
  - leadbay_research_lead_by_id
turns:
  - prompt: "Show me today's leads."
    expect_calls: [leadbay_account_status, leadbay_pull_leads]
  - prompt: "Research the top one for me."
    expect_calls: [leadbay_research_lead_by_id]
    forbid_calls: [leadbay_pull_leads]
    carry_over:
      - "passed the SAME lead_id surfaced in turn 1 (did not re-run discovery)"
success_criteria:
  - "ran discovery on turn 1 and research on turn 2"
```

A `turns:` contract has no separate `yaml scenario` block.

## How this stays normative

`packages/mcp/test/audit/workflows.test.ts` asserts every backtick-wrapped `leadbay_*` identifier resolves to a registered tool or prompt. Proposed names for not-yet-shipped tools go in italics, not backticks.
