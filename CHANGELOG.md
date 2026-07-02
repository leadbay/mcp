# Changelog

## 0.23.0 — 2026-06-21 — Build-a-campaign guided flow

- Added the `leadbay_build_campaign` prompt (and auto-generated Claude skill):
  one guided on-ramp that takes a solo user from intent to a ready-to-work
  campaign — discover on the active lens → qualify → pick an ICP candidate pool
  → enrich the people who would actually BUY the user's product → persist via
  `leadbay_create_campaign` → render the `leadbay_campaign_call_sheet` view,
  then hand off to `leadbay_work_campaign`.
- Enrichment is **buyer-persona-driven, not seniority-driven**: Phase 3 derives
  who buys the user's product from their ICP (a sales tool → the revenue org),
  filters `recall_ordered_titles` / discovery suggestions to that persona, and
  refuses ops/finance/IT-by-seniority. Confirms persona + spend before launching.
- **Coverage guarantee**: drops/swaps any lead with no enrichable buyer-persona
  contact for the highest-score in-ICP lead that has one — never trading ICP fit
  for coverage. Final cohort is all buyer-ready.
- **Suspect-contact flag**: marks ⚠ any enriched email whose domain ≠ the
  company, or any contact appearing on >1 lead, so the rep doesn't email a
  mis-attributed address. Polls enrichment to completion before rendering.
- Pure orchestration of existing composites — no new tool or endpoint.
- Added eval workflow #34 (multi-turn) in `WORKFLOWS.md`. Tuned over 4 live
  eval cycles against the test account (campaign quality 3/7 → 11/11 leads with
  a real revenue buyer reachable).

## 0.13.0 — 2026-05-21 — Agent memory v1

- Added local-file agent memory for Leadbay MCP: append-only JSONL entries
  under `~/.leadbay/memory/{account_id}/`, consolidated at read time with
  dedupe, confidence decay, validation bonuses, contradiction penalties, and
  tombstones.
- Added always-on `leadbay_agent_memory_recall`,
  `leadbay_agent_memory_capture`, and `leadbay_agent_memory_review` tools.
- Leads-touching tools now attach `_meta.agent_memory.summary` unless
  `LEADBAY_AGENT_MEMORY=off` is set, so agents can apply remembered taste
  signals without an extra recall round trip.
- Promptforge now injects a shared memory pointer into routed tool
  descriptions and a memory preamble into Leadbay workflow prompts.
- Active MCP install/runtime pins are bumped from `@leadbay/mcp@0.12` to
  `@leadbay/mcp@0.13`.

## 0.8.0 — 2026-05-15 — Skills + initialize catalog + daily check-in resilience

Two correlated workflow upgrades shipped together: (1) the six MCP
prompts now also ship as auto-discovered Claude Code skills and the
MCP `initialize` response advertises the catalog so UI-blind clients
(Cowork) learn the prompt set; (2) `leadbay_daily_check_in` gains
resilience rules against MCP per-call timeouts, mid-session lens
shifts, and `leadbay_research_lead` fan-out backpressure — three
failure modes seen in a real session.

### Daily check-in resilience

A live `leadbay_daily_check_in` run failed in three correlated ways — a
blocking `leadbay_bulk_qualify_leads` hit the MCP per-call timeout, the
recovery re-pull silently switched lens and discarded the EU batch, and
ten parallel `leadbay_research_lead` calls produced `"Tool permission
stream closed"` backpressure that the agent treated as terminal. All
three are workflow-contract gaps, not server bugs.

- New reusable snippet `packages/promptforge/snippets/heuristics/long-running-tools.md`
  codifies four resilience rules: pin the captured `lensId` to every
  subsequent call, default `wait_for_completion:false` + `qualify_status`
  polling for bulk ops, serialize `leadbay_research_lead` fan-out
  (≤3 parallel), and retry transient transport errors instead of
  replanning.
- `leadbay_daily_check_in.md.tmpl` includes the snippet, adds a
  `PHASE 0 — RESUME CHECK` so "continue from where you left off" does
  not restart, pins `lensId` in Phase 2, switches Phase 3's top-up to
  the async pattern with `lensId`, and serializes Phase 4. Three new
  `failure_modes` entries enforce the rules during evals.
- Belt-and-suspenders updates to three composite tool descriptions
  (`pull-leads`, `bulk-qualify-leads`, `research-lead`) so ad-hoc tool
  use gets the same hints even without the prompt.

### Prompts ship as Claude Code skills; initialize advertises them

The six MCP prompts (`leadbay_daily_check_in`, `leadbay_research_a_domain`,
`leadbay_import_file`, `leadbay_log_outreach`, `leadbay_qualify_top_n`,
`leadbay_refine_audience`) now also ship as auto-discovered Claude Code
skills, and the MCP server's `initialize` response advertises the catalog
to clients (Cowork is the prototypical case) that don't render the
`prompts/list` UI.

### New emit targets in `@leadbay/promptforge`

- `.claude-plugin/plugins/leadbay/skills/<name>/SKILL.md` — one auto-
  discovered skill per prompt. `{{arg:NAME}}` placeholders in the prompt
  body are rewritten in-place as natural-language extraction instructions
  because skills have no structured-argument system. Snippet includes are
  resolved by the existing assembler so iron-laws and gates ship in both
  surfaces from a single source. First occurrence of each placeholder
  gets the full extraction prompt; subsequent occurrences become terse
  back-references so calls like
  `tool({lead_id: '<the lead_id (as extracted above)>'})` stay readable.
- `PROMPT_CATALOG_HEADER` / `PROMPT_CATALOG_BULLETS` /
  `PROMPT_CATALOG_INSTRUCTIONS` exports added to
  `packages/mcp/src/prompts.generated.ts`. The MCP server splices the
  filtered bullets into its `initialize` `instructions` payload via
  `buildPromptsCatalogParagraph`. Bullets that literally name a tool
  outside the exposed set are suppressed — preserves the iter-12
  invariant that the system prompt never references a tool the agent
  cannot call (closes [product#3504](https://github.com/leadbay/product/issues/3504)'s
  spirit at the prompt layer).

### Plugin

- `.claude-plugin/plugins/leadbay/.claude-plugin/plugin.json` bumped
  `0.6.2` → `0.6.3`. Skills are auto-discovered from `skills/` by
  schema convention; no explicit manifest field needed.

### Tests

- `packages/promptforge/test/skills.test.ts` — every `.md.tmpl` has a
  matching `SKILL.md`, every emitted skill is byte-equal to disk
  (freshness gate), every description carries trigger phrasing, no
  unrewritten `{{arg:…}}` survives into the skill body, and the
  catalog string names every prompt + explains the direct-invoke
  fallback.
- `packages/mcp/test/server.test.ts` — two new assertions: default
  config's `instructions` mentions all six prompts; read-only config
  drops `leadbay_qualify_top_n` (its short_description references
  `leadbay_bulk_qualify_leads`, which is gated off).

## 0.6.0 — UNRELEASED — MCP best-practice initiative

The "make `@leadbay/mcp` the example MCP server" rollout. Closes the
P1 / P2 / P3 priorities from the comprehensive eval doc.

### Spec primitive coverage

- **Agentic file-import resolver.** New `leadbay_resolve_import_rows`
  wraps backend `POST /leads/resolve` for messy CSV-shaped user data,
  returns matched / ambiguous / unresolved candidates, optionally
  hydrates ambiguous candidates with active-lens profile facts, and emits
  `records_for_import` + safe identity-only `mappings_for_import` for the
  standard import and import-and-qualify composites. Import mappings now
  accept `LEADBAY_ID`, `CRM_ID`, and `SIREN` as resolver keys in addition
  to name / website. A new `leadbay_import_file` prompt teaches the full
  inspect → map → resolve → disambiguate → import / qualify workflow.
- **Tool annotations on every tool (spec MCP 2025-11-25 §Tools).** Each
  tool now declares `readOnlyHint`, `destructiveHint`, `idempotentHint`,
  `openWorldHint`, plus a short `title`, so MCP clients (Claude Desktop,
  Cursor) can surface the right confirmation UX per tool. Defaults
  honour the per-tool truth: composite reads are read-only + idempotent;
  composite writes split into idempotent (bulk_qualify_leads,
  enrich_titles, import_leads, import_and_qualify) vs non-idempotent
  (refine_prompt, answer_clarification, adjust_audience-merging,
  report_outreach). 56 tools total. A vitest drift-catcher prevents
  future regressions.
- **`outputSchema` + `structuredContent` on top-5 composites**:
  `pull_leads`, `research_lead`, `account_status`,
  `bulk_qualify_leads`, `report_outreach` now declare typed output
  shapes and emit a matching `structuredContent` block on success.
  Capable clients consume the typed payload without re-parsing the
  text. Backwards-compatible.
- **`prompts/*` capability** with 5 canned slash-commands —
  `leadbay_daily_check_in`, `leadbay_research_a_domain`,
  `leadbay_refine_audience`, `leadbay_log_outreach`,
  `leadbay_qualify_top_n`. Each composes 2-3 tool calls and accepts
  parameterised arguments.
- **`resources/*` capability** with three URI schemes:
  `lead://{uuid}/profile`, `lens://{id}/definition`,
  `org://taste-profile`. Cache-friendly for clients that opt in.
- **`notifications/progress`** — long-running composites stream
  per-lead progress when the client passes `_meta.progressToken`.
  `bulk_qualify_leads` is the first adopter.
- **`notifications/cancelled` → `ToolContext.signal`** — client
  cancels now actually abort in-flight composite polling.

### Hardening

- **`additionalProperties: false` on every tool's inputSchema.** Closes
  the prompt-injection extra-field surface. **Behavior callout**: any
  client that was passing extra unrecognized fields will now get a
  schema rejection. Documented as a deliberate hardening; existing
  tools never advertised acceptance of those fields.
- **Security regression suite** — `packages/mcp/test/security.test.ts`
  covers: extra-field rejection, prototype-pollution payload, type
  confusion, oversized inputs, nested-additionalProperties on the
  `verification` field of `report_outreach`.

### Field renames + deprecations

- **`research_lead.qualification[]` boost_score canonical alias.** The
  field was previously labelled `score_0_to_10`; the actual scale is
  the discrete `-10|0|10|20` boost (NOT a 0–10 average). 0.6.0 ships
  `boost_score` as canonical alongside an explicit `score_scale:
  "-10|0|10|20"` field; `score_0_to_10` is kept as a deprecated alias
  for one minor version and removed in 0.7.0. See `MIGRATION.md`.

### Token economy

- **Pagination metadata**: `pull_leads` and `discover_leads` payloads
  now include `has_more: boolean` and `next_page: number | null`.
- **Truncation steering on `research_lead`**: when the response
  exceeds ~25k characters, `truncated: true` and `truncation_hint`
  surface, naming the argument that would reduce the payload
  (`concise: true`).

### Tests

- Total: 328+ unit tests across `@leadbay/core` and `@leadbay/mcp`.
- New: `annotations.test.ts` (drift catcher), `security.test.ts`
  (5 hostile-input shapes), `output-schema.test.ts` (top-5 round
  trip), `cancellation.test.ts` (signal wiring), `progress.test.ts`
  (event flow), `prompts.test.ts` (5 prompts round-trip),
  `resources.test.ts` (3 URI schemes round-trip).

## 0.3.0 — 2026-04-29

- **`@leadbay/mcp` 0.3.0**: closes [product#3504](https://github.com/leadbay/product/issues/3504) end-to-end. Composite write tools (`refine_prompt`, `report_outreach`, `adjust_audience`, `bulk_qualify_leads`, `enrich_titles`, `answer_clarification`, `import_leads`) are now ON by default — `LEADBAY_MCP_WRITE` defaults to `"1"`. The `SERVER_INSTRUCTIONS` is now built dynamically from the actual exposed tool set, so the system prompt no longer references tools the server doesn't register. `leadbay-mcp login` defaults to writing a 0600-mode credentials file at the platform-correct path (`$XDG_CONFIG_HOME/leadbay/credentials.json`, `~/Library/Application Support/leadbay/credentials.json`, or `%APPDATA%\leadbay\credentials.json`); pass `--unsafe-print-token` for legacy CI flows. `leadbay-mcp install` now registers Claude Code at `--scope user` so the MCP server is visible from any project. **Behavior callout**: in 0.2.x the parser only recognized `LEADBAY_MCP_WRITE === "1"` as ON; 0.3.0 also accepts `true|yes|on` as ON. See `packages/mcp/MIGRATION.md`.

## 0.2.5 — 2026-04-28

- **`@leadbay/mcp` 0.2.5** + **`@leadbay/core` 0.2.5**: new `leadbay_import_leads` composite write tool ([product#3537](https://github.com/leadbay/product/issues/3537)). Imports a list of company domains and returns Leadbay leadIds for the ones the crawler already knows, chainable into `leadbay_bulk_qualify_leads` and `leadbay_research_lead`. Writes user state (creates a CRM-imports row visible in the web UI). Gated behind `LEADBAY_MCP_WRITE=1` (MCP) and `exposeWrite: true` (OpenClaw). See package CHANGELOGs for full surface, error codes, and limitations.

## 0.1.0 — 2026-04-20

Initial release.

### Tools (11)

Read-only (enabled by default):
- `leadbay_login` — authenticate with email + password
- `leadbay_list_lenses` — list saved search configs
- `leadbay_discover_leads` — AI-recommended leads
- `leadbay_get_lead_profile` — full lead profile with AI scores and web insights
- `leadbay_get_lead_activities` — lead activity feed
- `leadbay_get_taste_profile` — organization ICP + intent tags + qualification questions
- `leadbay_get_contacts` — contacts for a lead
- `leadbay_get_quota` — enrichment credit balance

Write (opt-in, `optional: true`):
- `leadbay_qualify_lead` — trigger AI qualification
- `leadbay_enrich_contacts` — enrich email/phone
- `leadbay_add_note` — add a note to a lead

### Tests

- Contract test: manifest ↔ code parity
- Unit tests: client error mapping, caching, tool branches
- Live smoke tests (opt-in via `LEADBAY_TEST_TOKEN`)
