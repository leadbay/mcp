# Changelog — @leadbay/mcp

## 0.11.0 — 2026-05-20

In-server auto-update flow: the MCP server now self-polls GitHub releases (24h throttle, ETag-aware, in-flight guarded) and surfaces an `update_available` block on `leadbay_account_status` when a newer version is published — both at boot AND on every tool call, so long-running Claude Desktop sessions still pick up new releases without restart.

- **New tool — `leadbay_acknowledge_update`**: records the user's choice from the `ask_user_input_v0` prompt. `action: 'install'` returns the `.mcpb` download URL (Claude Desktop's native installer opens on click); `'remind_tomorrow'` snoozes 24h; `'skip'` permanently suppresses that version. State persists to `~/.leadbay/update-state.json` (0o600, atomic write, symlink-rejecting; mirrors `bulk-store.ts`).
- **Five new PostHog events** for the funnel + conversion: `mcp_update_check`, `mcp_update_prompted`, `mcp_update_install_clicked`, `mcp_update_dismissed`, `mcp_version_updated` (fires on the next boot under a newer `VERSION` constant — works regardless of how the user upgraded: `.mcpb`, npm, npx).
- **Routing instruction** appended to `buildServerInstructions`: when `update_available` is present on `leadbay_account_status`, the agent prompts via `ask_user_input_v0` with three options and routes the choice through `leadbay_acknowledge_update`. Opt-out: `LEADBAY_UPDATE_CHECK_DISABLED=1`.
- **Pin bumps**: every `@leadbay/mcp@0.10` reference across `bin.ts`, `server.json`, `README.md`, `packages/dxt/manifest.template.json`, `.claude-plugin/.../plugin.json`, and the root `README.md` is now `@0.11`.

## 0.10.1 — 2026-05-20

Documentation + version-pin sweep paired with hardening the release pipeline. No functional changes to the published binary.

- **Pin bumps**: every `npx -y @leadbay/mcp@<old>` reference in `bin.ts` (install command output, error hints, doctor instructions, generated client configs), `README.md`, `server.json` (MCP Registry manifest), `packages/dxt/manifest.template.json`, and `.claude-plugin/plugins/leadbay/.claude-plugin/plugin.json` is now `@0.10`. New installs land on the latest minor.
- **Release pipeline migrated to npm Trusted Publishers OIDC** (`.github/workflows/release.yml`): npm revoked Classic tokens on Dec 9 2025 and Granular tokens with the "Bypass 2FA" flag still hit known publish-rejection bugs ([npm/cli#9268](https://github.com/npm/cli/issues/9268)). The publish step now uses OIDC via the [Trusted Publishers binding](https://docs.npmjs.com/trusted-publishers) configured per-package on npmjs.com. Runtime bumped to Node 24 in publish jobs for the bundled npm ≥ 11.5 that speaks the OIDC handshake (Node 22's npm 10 can't, and self-upgrade via `npm install -g npm@latest` consistently breaks on the runner image).
- **Auto-release** (existing `.github/workflows/auto-tag.yml` — unchanged in this release, documented here): merges to `main` that bump `packages/mcp/package.json#version` automatically push `mcp-v<ver>` and dispatch `release.yml` on the tag, which publishes to npm + MCP Registry + uploads the .dxt to a GitHub Release. No manual tagging needed.

## 0.10.0 — 2026-05-19

First stable cut of the 0.10 line. Consolidates everything since 0.9.1: host-native widget rendering, structured routing schema, the top-up flow, like/dislike write tools, the `research_lead` split, and PostHog + Sentry telemetry. See dev-iteration commits for granular per-PR history; this is the npm-shipped consolidation.

### Host-native widgets + chat-native rendering (#42)

Iframe widget rendering via MCP Apps `_meta.ui` is **removed entirely** — it short-circuited Claude's native widget routing and never blended with chat themes. All tools now render via two surfaces only: (1) chat-native markdown (the canonical `RENDERING` block every tool description carries — tables, cards, chips, headings; inherits the chat's theme + dark-mode for free), and (2) Claude's three first-party widgets when the host exposes them: `places_map_display_v0` (≥2 locations / travel intent), `message_compose_v1` (outreach drafts), `ask_user_input_v0` (NEXT STEPS / clarifications). Same widget-routing pattern applies on ChatGPT via `_meta.openai/outputTemplate`. The `Tool.ui` field is removed from the `Tool` interface — DO NOT re-introduce it.

Hosts that auto-detect addresses in agent prose (Claude.ai web, cowork, Claude Desktop) now get fed per-lead blocks shaped for their Google-Place-card carousel — see the `leadbay_followup_check_in` "TRAVEL / IN-PERSON ROUTING" block as the canonical example.

### Structured routing schema in promptforge (#42)

Every user-facing tool description follows a new 5-section convention enforced by promptforge + audit tests:

```
[1] ## WHEN TO USE   ← auto-emitted from frontmatter.routing
[2] ## RENDER (quick) ← auto-emitted from frontmatter.rendering_hint
---
[3] <free-form body>
[4] {{include:rendering/…}}
[5] {{include:next-steps/…}}
```

Routing frontmatter is structured YAML: `triggers`, `anti_triggers` (with `route_to` cross-references), `prefer_when` decision hint, and ≥3 positive + ≥3 negative example messages per [Anthropic's skill-author guide](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills). The audit (`routing-block.test.ts`) asserts the `## WHEN TO USE` block lands within the first 600 chars (the context-truncation window every host honors), anti-trigger `route_to` values resolve to registered tool names, and the example floor (≥2 of each) holds for every routed tool. Backfilled on the 7 user-facing composites in this release.

### Top-up flow + billing tools always-on (#42)

`leadbay_create_topup_link` (POST `/stripe/topup_checkout` → Stripe checkout URL) and `leadbay_open_billing_portal` are now **always exposed** in `compositeReadTools` (not gated behind `LEADBAY_MCP_ADVANCED=1`) because they're the canonical recovery path from a `QUOTA_EXCEEDED` wall. Without them, the agent would know about the wall but not the door out.

`QUOTA_EXCEEDED` error hints now explicitly offer top-up as the path that clears the throttle immediately (vs. waiting for the daily/weekly/monthly window reset). The new `QUOTA_AND_TOPUP_PARAGRAPH` in the server instructions tells the agent to OFFER top-up on every quota wall and, after the user signals they've topped up, RESUME the originally-failed call rather than gate-keeping on a stale `account_status` snapshot.

New composite `leadbay_followups_map` for travel / itinerary / state-level intent — handles NYC/SF/LA city aliases and a universal `city` arg that resolves state/country/region levels server-side.

### `research_lead` split (#43)

`leadbay_research_lead` / `leadbay_research_company` are replaced by a pair whose **input mode is in the name itself**:

- `leadbay_research_lead_by_id` — exact UUID lookup; rich composite carrying qualification + signals + firmographics + two-tier contacts + unified `recent_activities` + engagement counts + `web_insights_fetched_at` + `_meta`. The `_meta.has_reachable_contact` flag is the one-shot signal that drives NEXT STEPS (false → propose `leadbay_enrich_titles`; true → propose `leadbay_prepare_outreach`).
- `leadbay_research_lead_by_name_fuzzy` — thin wrapper that resolves a `companyName` against the active lens's top-50 wishlist by substring (highest score wins), then delegates to `_by_id`.

Routing collapses to a syntactic choice (UUID vs. name) instead of a semantic guess, which was the source of misroutes when an agent had both a name and a partial ID.

### `leadbay_like_lead` + `leadbay_dislike_lead` write tools (#41)

The thumbs-up / thumbs-down actions already available on the Leadbay website are now MCP tools. Agents can send positive and negative lead signals back to the Leadbay scoring engine to improve future batch quality.

- `leadbay_like_lead` — POSTs to `/leads/{id}/like`. Fires on "this one looks good", "thumbs up", "I like this".
- `leadbay_dislike_lead` — POSTs to `/leads/{id}/dislike`. Fires on "not relevant", "wrong industry", "thumbs down". Distinct from `leadbay_set_pushback` (temporary deferral, not a permanent negative signal).

Both ship in the default write surface (no `LEADBAY_MCP_ADVANCED=1` required); gated by `LEADBAY_MCP_WRITE=1` (default ON since 0.3.0). Descriptions carry the new structured `routing` + `rendering_hint` frontmatter.

### PostHog + Sentry telemetry (#44, closes #3631)

Every tool invocation now fires an `mcp tool called` event to PostHog (same project as the frontend, project id 23333, EU instance), with quota walls surfaced as `mcp quota hit` and successful top-up checkout-link generation as `mcp topup link created`. Unexpected throws (TypeError, network failures, parse bugs) report to a new MCP-specific Sentry DSN; expected `LeadbayError` envelopes (QUOTA_EXCEEDED, NOT_FOUND, AUTH_EXPIRED, FORBIDDEN, BILLING_SUSPENDED, API_ERROR) stay in PostHog only.

- **Identity by email**: PostHog `distinctId = me.email` so MCP events consolidate with web-app events under the same person. Person properties (`leadbay_id`, `leadbay_organization`, `leadbay_organization_id`, etc.) match the frontend's `usePostHog.tsx` shape. **Events are NOT anonymous** — explicitly stated in `--help`, the install banner, and README.
- **`$groups.organization` attached** so org-level rollups work out of the box.
- **Privacy**: we capture `tool`, `duration_ms`, `ok`, `format`, `bytes`, `error_code` — never tool argument bodies, response bodies, lead emails, or Stripe URLs (unit test enforces).
- **Opt-out as a first-class toggle**: `leadbay-mcp install` always writes `LEADBAY_TELEMETRY_ENABLED=true` into your client's env block (next to `LEADBAY_TOKEN` / `LEADBAY_REGION`), so MCP-client config UIs (Claude Desktop, Cursor) render it as a toggle the user can flip without editing files. Pass `--no-telemetry` to install with telemetry off, or flip the env value to `"false"` anytime. Accepted: `true|1|yes|on` (enable), `false|0|no|off` (disable), case-insensitive. Also disabled when `NODE_ENV=test`.
- **Override**: `LEADBAY_POSTHOG_KEY` and `LEADBAY_SENTRY_DSN` env vars override the baked-in defaults.
- **stdio safety**: both SDKs are configured to never write to stdout (the JSON-RPC channel). Sentry runs without its default integrations (no console capture) and shutdown is bounded at 2s to never block process exit.

## 0.9.1 — 2026-05-16

**B23 fix — prompts no longer override per-tool RENDERING blocks**: 0.9.0 shipped RENDERING + NEXT STEPS blocks on every composite tool description. But agents still rendered prose for the daily-leads workflow, because the orchestrating `leadbay_daily_check_in` prompt's Phase 3 directed motivational one-line summaries that "won" over the per-tool RENDERING block in pull_leads. Phase 3 is rewritten to defer to the canonical pull_leads table layout (score bars, three columns, hide-list) and to add a 2–4 sentence "Today's nudges" paragraph ABOVE the table for the 3 most-promising rows — never in place of it. The same pattern is applied to `leadbay_qualify_top_n` (Phase 3 re-pulls newly-qualified leads via pull_leads and renders the canonical table, with a "Standouts from this batch" line above) and `leadbay_research_a_domain` (Phase 2 renders the research-company-card layout for the deep-dive result, with a 2–3 sentence summary above).

**New `gates/defer-to-tool-rendering` snippet — architectural prevention**: a new gate snippet codifies the rule "the tool's RENDERING wins for the structural layout; the prompt's voice wins for the commentary that surrounds it." Included from every prompt that orchestrates a composite carrying a RENDERING block (`leadbay_daily_check_in`, `leadbay_qualify_top_n`, `leadbay_research_a_domain`, `leadbay_import_file`, `leadbay_prospecting_overview`, and the new `leadbay_followup_check_in`). A new assembler test enforces the gate include: any prompt whose `expected_calls` lists a composite with a RENDERING block MUST include the snippet — CI fails otherwise. Closes the door on future prompts quietly bypassing the contract.

**Discover-vs-Monitor routing fix (companion to B23)**: 0.9.0 shipped `leadbay_pull_followups` (the Monitor view) and `leadbay_pull_leads` (Discover wishlist) as parallel entry points but no orchestrator prompt parallel to `leadbay_daily_check_in` for the follow-up flow. When the user asked "leads I should follow up with today", no prompt auto-triggered and the agent freelanced — typically iterating pages of `pull_leads` filtering by `prospecting_actions_count > 0` (the wrong backend table). Four fixes:

- **New `leadbay_followup_check_in` prompt** — Monitor-view orchestrator paired 1:1 with `leadbay_daily_check_in` (Discovery). Triggers on "follow up", "already known leads", "leads I haven't contacted", "leads in [city]", "before my trip", "this week", "what's overdue", "who should I re-engage". Calls `leadbay_pull_followups` (never `pull_leads`), renders the canonical followups-table with a "Where to start today" paragraph above. Auto-emits as a Claude Code skill via the existing skills pipeline.
- **Narrowed `leadbay_daily_check_in` triggers** — `short_description` rewritten to scope to DISCOVERY phrasings ("best NEW leads", "what's new today", "let's prospect"); explicitly does NOT trigger on "what should I follow up on", "before my trip", etc. New failure_mode entry catches accidental routing into discovery from follow-up queries.
- **Anti-confusion guardrail in `leadbay_pull_followups` description** — names the specific failure mode ("iterating pages of `pull_leads` looking for rows with `prospecting_actions_count > 0` or `notes_count > 0` → STOP, wrong entry point") and points to `leadbay_followup_check_in` as the canonical orchestrator. The pair of backend tables doesn't share rows — a touched lead may age out of the new-leads queue entirely.
- **Routing-pair section in `leadbay_prospecting_overview`** — explicit mapping from user phrasing to orchestrator prompt, plus a hard rule never to call `pull_leads` directly for a follow-up query (or `pull_followups` for a discovery query).

**Server-side fix to the catalog filter**: the `buildPromptsCatalogParagraph` filter that drops bullets referencing unexposed `leadbay_*` tools now exempts prompt-name references too (prompts are always exposed). Previously a discovery bullet that pointed the follow-up flow to `leadbay_followup_check_in` would have been silently dropped from the catalog.

**Six new regression eval scenarios**: B23 rendering — `daily-check-in/rendering-table-contract`, `qualify-top-n/rendering-refresh-table`, `research-a-domain/rendering-card-contract`. Routing — `followup-check-in/routing-regression` (calls `pull_followups`, NEVER `pull_leads`), `followup-check-in/cross-mode-pivot` (recognizes the pivot offer to discovery), `followup-check-in/geo-followup` (handles geo without fabricating an `admin_area_id`). Picked up automatically by the existing eval framework via the per-prompt eval files; the new `leadbay_followup_check_in.eval.ts` runs all three.

**Files touched**: 1 new gate snippet, 1 new prompt (`leadbay_followup_check_in`), 5 modified prompts (`leadbay_daily_check_in`, `leadbay_qualify_top_n`, `leadbay_research_a_domain`, `leadbay_import_file`, `leadbay_prospecting_overview`), 1 modified tool description (`leadbay_pull_followups`), 1 server.ts catalog-filter fix, 1 new assembler test, 6 new scenario files, 4 modified/new eval files, 1 new invariants module, touchfile registry updated. No backend schema changes; no tool surface changes; same wire protocol as 0.9.0.

## 0.9.0 — 2026-05-16

**RENDERING + NEXT STEPS blocks in every composite tool description**: agents consuming composite tools today default to prose summaries when they don't know how to present the data. Tool descriptions now carry two new prescriptive blocks the agent reads verbatim — `RENDERING` (a recipe for how to present the response: table columns, glyph palette, link targets, fields to hide) and `NEXT STEPS` (an observation → suggestion table the agent picks 2–3 contextually relevant offers from, never reciting the whole menu). Lands on the seven highest-leverage composites: `leadbay_pull_leads`, `leadbay_research_company`, `leadbay_prepare_outreach`, `leadbay_bulk_qualify_leads`, `leadbay_import_leads`, `leadbay_import_and_qualify`, `leadbay_import_status`, `leadbay_list_mappable_fields`, `leadbay_resolve_import_rows`. The blocks add ~5–7k chars per description, so the audit's per-tool char budget was raised from 3500 → 12000 with a comment explaining the design tradeoff.

**Three new snippet categories in promptforge** — `snippets/rendering/` (response-shape recipes: `score-bar`, `pull-leads-table`, `research-company-card`, `prepare-outreach-brief`, `import-result`, `status-inline`), `snippets/next-steps/` (one observation→suggestion table per composite), and `snippets/linking/` (`contact-linkedin` for the priority chain → real `linkedin_page` → people-search fallback with `°`-flag; `company-socials` for the multi-platform `social_urls` pill row). Each composite's `.md.tmpl` now `{{include:rendering/...}}` + `{{include:next-steps/...}}` instead of inlining the rules.

**New iron-law `outcome-after-outreach`**: when the user reports outreach happened ("I sent it", "she didn't pick up", a forwarded email thread), the agent MUST (a) call `leadbay_report_outreach` with verification AND (b) ask about the outcome and set `epilogue_status` to one of the 4 canonical values. User-facing dialogue uses "outcome" not "epilogue"; "follow-ups" not "Monitor". Included from `prepare_outreach.md.tmpl` and the new prospecting-overview prompt. Closes the loop that was silently de-ranking every future follow-up suggestion.

**New `leadbay_prospecting_overview` prompt → Claude Code skill**: ships at `prompts/leadbay_prospecting_overview.md.tmpl` and auto-emits `SKILL.md` via the existing skills pipeline. Orients the agent to the two-entry-point workflow (discovery via `pull_leads` vs follow-up via the app's Monitor view), natural-language signal routing, the outreach loop, adaptive drafting based on connected outreach tools (Lemlist / Outreach.io / Salesloft / Apollo / HubSpot / Instantly / Attio / Amplemarket / generic), outcome-recording habit, snooze/pushback semantics, and the lens-pinning rule. Auto-triggers on Leadbay-related conversation; stays dormant otherwise.

**Composite output-shape fixes**:

- **B1 / B6 / B7 — contact `linkedin_page` is canonical and never the literal string `"null"`**: `pull_leads`, `research_lead`, `prepare_outreach`, and `get_lead_profile` all propagate `linkedin_page` on `recommended_contact` and every `contacts[]` entry, coercing the legacy `"null"` four-character string (a backend serialization bug) to real JSON null on the way out.
- **B4 — `leadbay_research_lead` outputSchema fix**: `firmographics.size` was declared as `string|null` while the composite returns `{min,max,low,high,label}`; `firmographics.location` was `string|null` while the composite returns `{city,state,country,full,pos}`; `firmographics.tags` items were `string` while the composite returns `{id,display_name,tag,score}`. All three corrected to match the actual `LeadSimplified` shape. Also tightened `social_presence` and `social_urls` declarations to typed objects (was `["object","string","null"]` etc.). The tool was unusable before this fix — every call rejected by MCP schema validation.
- **B8 — `recommended_contact_title` dropped**: this field duplicated `recommended_contact.job_title` everywhere it appeared (`pull_leads`, `research_lead`, `get_lead_profile`). Removed.
- **B12 / B15 — `leadbay_prepare_outreach` expanded `lead` block**: was a two-field stub (`{name, ai_summary, website}`); now includes `score`, `ai_agent_lead_score`, `split_ai_summary`, `location`, `size`, `phone_numbers`, `description`, `short_description`, `social_presence`, `social_urls`. The agent no longer needs a second `research_company` call to render basic context.
- **B13 — self-polling enrichment**: `enrichment.complete: boolean` added. The brief now re-fetches contacts ONCE after triggering enrichment, and exposes `complete: true` when the recommended contact has either email or phone. The agent just re-calls `leadbay_prepare_outreach(leadId)` (no `enrich`) to poll; no separate `leadbay_get_contacts` tool needed.
- **B16 — `additional_contacts_count`**: clearer name. `other_contacts_count` kept as a deprecated alias for one release.
- **B21 — recommended_contact shape standardized**: always emit the post-enrichment field shape (`contact_id`, `first_name`, `last_name`, `job_title`, `email`, `phone_number`, `linkedin_page`, `is_org_contact`) with nulls in un-enriched fields — no more shape-flipping between pre- and post-enrichment.
- **`pull_leads` augmented**: trimmed shape now includes `ai_summary`, `split_ai_summary`, `phone_numbers`, `social_presence`, `social_urls`. Agents can render rich tables without verbose mode.

**Audit budget raised**: tool description per-tool char cap raised from 3500 → 12000. The largest tool descriptions are now `leadbay_research_company` (~10.5k chars) and `leadbay_prepare_outreach` (~10.1k chars). The plan was designed knowing this cost — the new char budget is justified by what the agent now does without prompting (table layout, glyph palette, observation→suggestion menu).

**New composite `leadbay_pull_followups`** — the Monitor view (re-engagement workflow), distinct from `leadbay_pull_leads` (discovery). Wraps `GET /1.5/monitor?personal=&liked=&filtered=&count=&page=` plus `GET/POST /1.5/monitor/filter` (server-persisted FilterItem). Accepts a `set_filter: { criteria: FilterCriterion[] }` parameter that POSTs first, then re-pulls — the same store-then-apply mechanism the Leadbay app uses. The composite excludes leads with active pushback client-side (defense-in-depth — the backend likely already does this) and reports `total_excluded_by_pushback`. Status-badge derived in the rendering rule from existing fields (`epilogue_status` + `last_prospecting_action_at` + `new`) — no new backend field needed. Endpoints verified live via the discover-monitor-activate wiki page; backend handler is `MonitorRoutes.kt:getMonitor()` → `Database.monitor.findAll`.

**Two new granular tools — `leadbay_set_pushback` / `leadbay_remove_pushback`**: snooze a lead (or a bulk set, up to 1000) for 3 / 6 / 12 months. Wraps `POST /leads/pushback` and `POST /leads/remove_pushback` (mirrors the existing `/leads/epilogue` / `/leads/remove_epilogue` pattern). Accepts short labels (`"3"` / `"6"` / `"12"`) or the wire-format enum (`PUSHBACK_3` / `PUSHBACK_6` / `PUSHBACK_12`). User-facing dialogue says "snooze for N months" — never "pushback status". Pull_followups excludes leads with active pushback from its results until expiry. Available behind `LEADBAY_MCP_ADVANCED=1 + LEADBAY_MCP_WRITE=1` (granular write).

## 0.8.0 — 2026-05-15

**Prompts ship as Claude Code skills + initialize advertises the prompt catalog**: the six MCP prompts (`leadbay_daily_check_in`, `leadbay_research_a_domain`, `leadbay_import_file`, `leadbay_log_outreach`, `leadbay_qualify_top_n`, `leadbay_refine_audience`) now also emit as auto-discovered Claude Code skills under `.claude-plugin/plugins/leadbay/skills/<name>/SKILL.md` from the same `.md.tmpl` source. `{{arg:NAME}}` placeholders are rewritten in-place as natural-language extraction instructions because skills have no structured-argument system. The MCP server's `initialize` response now splices a `PROMPT_CATALOG_INSTRUCTIONS` paragraph into the `instructions` payload so UI-blind clients (Cowork is the prototypical case) learn the prompt set; bullets that reference a tool gated off by the current config are suppressed (preserves the iter-12 invariant that the system prompt never names a tool the agent cannot call). Plugin manifest bumped `0.6.2` → `0.6.3`.

**Daily check-in resilience against MCP per-call timeouts and lens shifts**: a real session of `leadbay_daily_check_in` failed in three correlated ways — a blocking `leadbay_bulk_qualify_leads` hit the MCP per-call timeout, the recovery re-pull silently shifted lens and discarded the EU batch, and ten parallel `leadbay_research_lead` calls produced `"Tool permission stream closed"` backpressure that the agent treated as terminal. All three are workflow-contract gaps. New reusable snippet `packages/promptforge/snippets/heuristics/long-running-tools.md` codifies four resilience rules: pin the captured `lensId` to every subsequent call, default `wait_for_completion:false` + `qualify_status` polling for bulk ops, serialize `leadbay_research_lead` fan-out (≤3 parallel), retry transient transport errors instead of replanning. `leadbay_daily_check_in` includes the snippet, adds `PHASE 0 — RESUME CHECK` so "continue from where you left off" does not restart, pins `lensId` in Phase 2, switches Phase 3's top-up to the async pattern with `lensId`, and serializes Phase 4. Three new `failure_modes` entries enforce the rules during evals. Belt-and-suspenders paragraphs added to three composite tool descriptions (`leadbay_pull_leads`, `leadbay_bulk_qualify_leads`, `leadbay_research_lead`) so ad-hoc tool use gets the same hints.

**Tests**: `packages/promptforge/test/skills.test.ts` enforces 1:1 `.md.tmpl` ↔ `SKILL.md` mapping with a byte-equal freshness gate, non-empty trigger-phrasing descriptions, no leftover `{{arg:…}}` in skill bodies, and that `PROMPT_CATALOG_INSTRUCTIONS` names every prompt with the direct-invoke fallback. `packages/mcp/test/server.test.ts` asserts default config's `instructions` mentions all six prompts and that read-only config drops `leadbay_qualify_top_n` (its description references the gated-off `leadbay_bulk_qualify_leads`).

## 0.7.1 — 2026-05-14

**Hotfix**: `packages/mcp/server.json` (the MCP Registry manifest) was still pinned at `0.6.3` and referenced `@leadbay/mcp@0.6` in three places. The 0.7.0 npm publish succeeded but the MCP Registry publish failed on a version-drift check. This release re-publishes 0.7.0's content with `server.json` bumped to `0.7.1` and the npm specifier updated to `@leadbay/mcp@0.7`. No functional change to the published package over 0.7.0.

## 0.7.0 — 2026-05-15

**Compile pipeline for prompts and tool descriptions**: every MCP prompt body and every Tool description is now authored as a `.md.tmpl` source file in the new `@leadbay/promptforge` workspace package and compiled into `prompts.generated.ts` / `tool-descriptions.generated.ts` at build time. Authors edit prose in one place; the generated TS modules are the bundle's source of inlined strings. No wire-format change: every consumer (Claude Desktop, Cursor, Claude Code, OpenClaw) sees the same MCP protocol shape — `tools/list`, `prompts/list`, `prompts/get` are unchanged. Backwards-compat: every tool name, every `inputSchema`, every annotation set, every `outputSchema` is preserved byte-for-byte. The descriptions themselves are rewritten (see below) — that is the visible change.

**PHASES + IRON LAWS + GATES in every prompt**: all 6 prompts (`leadbay_daily_check_in`, `leadbay_research_a_domain`, `leadbay_import_file`, `leadbay_refine_audience`, `leadbay_log_outreach`, `leadbay_qualify_top_n`) restructured into explicit phases, with byproduct gates the agent must emit before progressing (`COLUMN PRESERVATION PLAN`, `DECISION LOG`, `FINAL REPORT` for file import; `STOP — awaiting user decision` for daily check-in). IRON LAW lines codify non-negotiables (no fabrication of leadIds; verification source required before `report_outreach`; top-N triage with motivational framing for `daily_check_in`).

**All 60 tool descriptions rewritten through shared snippets**: 21 composite + 37 granular + 2 file-import companion tools migrated. Each description uses shared snippet partials (`{{include:headers/tool-when-to-use}}`, `{{include:headers/tool-when-not-to-use}}`, `{{include:headers/verification-required-if-write}}` for write tools). 58 of 60 fit under 1500 chars; the two longest (`leadbay_import_leads`, `leadbay_list_mappable_fields`) retain their load-bearing detail at ~3100 chars. Audit test enforces a 3500-char per-tool budget.

**Shared snippet library**: 11 partials live in `packages/promptforge/snippets/` (iron-laws, gates, heuristics, headers). Most reusable today: `heuristics/crm-record-link.md` (extends the previous HubSpot guidance to Salesforce, Pipedrive, Close, Attio with per-CRM `url_template` examples for EXTERNAL_ID custom fields) and `heuristics/consumer-email-domains.md` with the explicit "domain extraction is a key factor of match success" framing.

**Daily check-in prompt overhaul** (per user direction): triage scope widened from top-3 to **top-10**, preferring leads with a fresh `ai_agent_lead_score`; each summary now framed motivationally ("why prospecting this lead today might be a good idea"); auto-top-up via `leadbay_bulk_qualify_leads` when the batch is short; PHASE 4 now researches **every** promising lead and surfaces the recommended contacts; the agent ASKS the user before consuming contact-enrichment quota.

**Import-file prompt overhaul** (per user direction): explicit GOAL section at the top — the job is to maximize how many rows the Leadbay system can ingest and match. Two deliverables named: max-coverage column mapping + the user's original file augmented with a `LEADBAY_ID` column populated for confidently disambiguated rows. WHAT GOOD LOOKS LIKE section teaches the disambiguation bar positively; the "never pick from score alone..." guardrail remains as a hard rule.

**Test framework spine** (`packages/mcp/test/eval/`): full eval harness landed. Drives scripted Claude sessions against the in-process MCP Server, captures L1+L2+L3 Evidence (tool calls, transcript, invariants, judge scores), runs a mission-match judge that reads its rubric from the prompt's frontmatter, enforces an Evidence-pyramid completeness rule, supports atomic partial saves to `.context/evals/<run-id>.json`, computes budget-regression flags, ships a worktree-based drift detector for main-vs-branch comparison, and includes a tool-routing classifier eval with 70+ (intent → expected_tool) fixtures. Gated by `EVAL=1`; default `pnpm test` ignores it. Replay-by-default for backend HTTP (`EVAL_RECORD=1` opt-in) keeps the user's Leadbay quota safe by construction.

**Audit tests** (`packages/mcp/test/audit/`): five new T0 meta-properties enforced on every commit — every prompt has eval coverage, tool descriptions imported (never inline in `server.ts`), per-tool char budget, `leadbay_<verb>_<noun>` naming convention, snippet orphans + dead `{{include:...}}` refs. Snapshot regression test catches accidental prose loss in migrated prompts.

**Agentic file import prep** (carryover entry — work landed in the merged 0.6.4 PR but never got a published changelog entry; rolled forward here): `leadbay_resolve_import_rows` — a read-only resolver that calls the backend `/leads/resolve` endpoint for messy CSV-shaped rows, returns matched/ambiguous/unresolved candidates, can hydrate ambiguous candidates with active-lens profile facts, and emits `records_for_import` plus safe identity-only `mappings_for_import` for `leadbay_import_leads` / `leadbay_import_and_qualify`. Import mappings accept `LEADBAY_ID`, `CRM_ID`, and `SIREN` as resolver fields.

## 0.6.3 — 2026-05-12

**Async import schema fix**: `leadbay_import_leads` now declares both its legacy blocking result shape and its async kickoff shape (`{status: "running", handle_id, importIds, progress}`) in `outputSchema`, so Claude Desktop and other MCP SDK clients accept the fast handle response instead of rejecting `structuredContent`.

**Async qualification schema fix**: `leadbay_bulk_qualify_leads` now also declares its async kickoff shape (`{status: "running", handle_id, qualify_id, ...}`), matching the `wait_for_completion:false` behavior added for short MCP client transport timeouts.

## 0.6.2 — 2026-05-12

**MCPB install fix**: desktop extension bundles now use the current `manifest_version` field and remove unsupported manifest keys (`user_config.*.enum` and an internal note field) so Claude Desktop can preview and install the MCPB.

## 0.6.1 — 2026-05-10

**Distribution**: listed in the official MCP Registry as `io.github.leadbay/leadbay-mcp` (auto-published from CI via GitHub OIDC); installable as a Claude Code plugin via `/plugin marketplace add leadbay/leadclaw` then `/plugin install leadbay@leadbay-leadclaw`; submission packets prepared for the Claude.ai connector directory and Anthropic's curated MCPB extension directory.

**Registry verification**: adds `mcpName` to the npm package metadata so the MCP Registry can verify ownership of `io.github.leadbay/leadbay-mcp` against the published `@leadbay/mcp` package.

## 0.6.0 — 2026-05-08

Massive spec-coverage upgrade. Each tool declares **annotations** (`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`); 17 composites + 12 highest-leverage granulars declare typed `outputSchema` + emit `structuredContent`. New surfaces: `prompts/*` (5 canned slash-commands), `resources/*` (`lead://`, `lens://`, `org://taste-profile`), `notifications/progress` (per-lead streaming on every long-running composite), `notifications/cancelled` → `ToolContext.signal` (bulk-store entries marked `cancelled` so subsequent status polls return `BULK_CANCELLED`), `elicitation/create` (refine_prompt clarification + report_outreach user_confirmed anti-poisoning).

**Hardening**: every `inputSchema` declares `additionalProperties: false`. Runtime conformance test pins `structuredContent` against `outputSchema` for every declarer (drift-catcher). Static-scan audit of every error-hint string asserts each names a recovery action. `report_outreach.verification` rejects extra keys at runtime (closes the SDK's nested-additionalProperties limitation). `score_0_to_10` deprecated alias of `boost_score` removed in 0.7.0.

**Token economy**: pagination payloads carry `has_more` + `next_page`. `research_lead` truncates large payloads with a `truncation_hint`. Per-tool opt-in `response_format: "json" | "markdown"` lets chat-rendering agents pick the cheaper render (research_lead first; pattern reusable). `LEADBAY_DEBUG=1` enables a per-tools/call observability line on stderr.

**DXT → MCPB**: bundle now publishes both `leadbay-X.Y.Z.dxt` (legacy) and `leadbay-X.Y.Z.mcpb` (new Claude Desktop format) for one cycle. Manifest `dxt_version` field stays for backwards-compat with current installers; field rename will follow Anthropic's spec when finalised. The two filenames have identical content; downstream installers can match either glob.

**Versioning + docs**: 0.4.0 / 0.6.0 bumps; README §3a "Spec primitives in action" adds wire-level JSON-RPC transcripts for every primitive; MIGRATION.md 0.5 → 0.6 walkthrough.

## 0.5.0 — 2026-05-04

### `leadbay_import_and_qualify` — new composite

End-to-end import + AI qualification in one call. Wraps `leadbay_import_leads` (chunking, mapping preflight, custom-field validation), then fans out `web_fetch` on every imported leadId, polls until each lead's qualification answers populate, and returns the results. When the wall-clock budget overflows, returns a `qualify_id` UUID handle for resumable retrieval via the new `leadbay_qualify_status` tool.

**Inputs** (mostly mirrors `leadbay_import_leads`):

- `domains` OR `records` — same shape as import_leads.
- `mappings.fields` and `mappings.custom_fields` — same as 0.3.0 import_leads. Custom fields surface as first-class via `leadbay_list_mappable_fields` (also new).
- `dry_run: "preview"` — special mode: uploads the CSV in dry-run and returns the wizard's per-column AI mapping hints + sample rows + custom-field candidates from the org catalog matched against unmapped column names by exact / case-insensitive / fuzzy-substring. NO ai_rescore quota consumed.
- `total_budget_ms` (default 900_000 = 15 min), `per_lead_budget_ms` (default 90_000), `per_phase_budget_ms` (default 300_000).
- `skip_already_qualified` (default `true`) — skips `web_fetch` launch on leads with a non-null `ai_agent_lead_score`. Saves quota.

**Outputs** (full mode):

```
{
  kind: "result",
  qualify_id: "<UUIDv4>" | null,
  import_ids: [...],
  imported: [{ leadId, domain?, name, rowId? }],
  not_imported: [...],
  qualified: [{ lead_id, qualifications: [{ question, score, response, computed_at }], qualification_summary, signals_count, ... }],
  still_running: [{ lead_id }],
  failed: [...],
  quota_exceeded: bool,
  skipped_already_qualified: [...],
  reused?: bool, seconds_since_original?: number,
  cancelled?: bool, budget_exhausted?: bool,
  region, _meta
}
```

`qualify_id` is persisted to `~/.leadbay/bulks.json` (30-day TTL, 5-min idempotency window) — same store as `leadbay_enrich_titles` but with a `kind: "qualify"` discriminator. Re-calling with the same records+mapping within 5 min returns the same handle (`reused: true`).

### `leadbay_qualify_status` — new resumable retrieval

```
leadbay_qualify_status({ qualify_id })
  → { qualify_id, status, lead_ids, qualified, still_running, ... }
```

Refreshes the per-lead state (`/web_fetch` + `/ai_agent_responses`) at call time. No backend mutation. Survives MCP restart.

### `leadbay_list_mappable_fields` — new discovery

```
leadbay_list_mappable_fields()
  → { standard_fields: [{name, description, mapping_value}], custom_fields: [{id, name, type, description, mapping_value}], region, _meta }
```

Lists every CRM field the agent can target in `mappings.fields`. Standard fields come from a static catalog with human descriptions; custom fields come from `GET /crm/custom_fields`. The `mapping_value` field is what the agent passes verbatim (e.g., `"CUSTOM.8"`).

### `leadbay_import_leads` 0.3.0 — `mappings.custom_fields` shorthand

In 0.2.0 the only way to map a custom field was `mappings.fields[col] = "CUSTOM.<id>"` (raw wire format). 0.3.0 adds `mappings.custom_fields[col] = <id>` (numeric) or `<name>` (string), resolved against `/crm/custom_fields` before the wizard sees it. New error codes: `IMPORT_CUSTOM_FIELD_UNKNOWN`, `IMPORT_INVALID_CUSTOM_MAPPING`, `IMPORT_CUSTOM_FIELD_NAME_AMBIGUOUS`, `IMPORT_CUSTOM_FIELD_CATALOG_REQUIRED`, `IMPORT_MAPPING_DUPLICATE_CUSTOM`. Catalog GET is suppressed when the mapping references no custom fields (saves a round trip).

### Bulk store schema widening

`BulkRecord` now has a `kind: "enrich" | "qualify"` discriminator. Old enrich rows (no `kind` field) default to `"enrich"` on read. Existing `leadbay_bulk_enrich_status` callers see no change. Cross-kind id queries are surfaced with the new `BULK_WRONG_KIND` error code that points the caller at the right tool.

### `not_in_lens` partition — terminate the silent infinite-poll

Both `leadbay_import_and_qualify` and `leadbay_qualify_status` now surface a `not_in_lens: string[]` array — lead ids that exist in the org (the wizard imported them) but are NOT admitted to the active lens. The backend's `queueAiRescoreForLead` is a no-op for these leads — they will never appear in `qualified[]`. Surfacing them in a distinct partition means the agent's poll loop terminates.

Discovered by iter-17 live e2e: imported 4 leads (Apple, Stripe, Datadog, GitHub) into a lens whose scoring rules only admitted Datadog. Datadog got `ai_agent_lead_score: -13` + 3/3 qualifications cleanly; Apple and Stripe sat in `still_running[]` indefinitely with no signal to stop polling. Now they land in `not_in_lens` with an actionable agent prompt: "either change the active lens or accept the lead won't be qualified."

`qualify_status` re-checks lens membership at each call — a lead added to the lens after the original `import_and_qualify` automatically migrates from `not_in_lens` back into the regular qualify pipeline on the next status call.

### Aligned with backend `/imports/{id}/leads` (PR #1801)

`leadbay_import_and_qualify` now sources the qualify-phase lead set from `GET /1.5/imports/{importId}/leads` (added backend-side 2026-05-06). This is the spec-prescribed source of truth — distinct lead ids the import touched (matched-existing AND newly-created). Replaces the per-record reconciliation pagination for the qualify input. Falls back gracefully to the per-record set when the endpoint is unavailable (older backend / 400 in_progress race).

Verified live: import 970bd47a-… (apple.com matched, salesforce.com uncrawled) → /leads returned `{lead_ids: [0a788a89-...]}` cleanly; qualify_id 08ad4555-… retrieved end-to-end.

### Monitor-membership disclosure

Both `leadbay_import_leads` and `leadbay_import_and_qualify` now flag in their tool descriptions that imported leads are NOT auto-promoted to the user's Monitor tab. Lens-scoring rules decide — only above-threshold leads get `in_monitor: true`. This was a real surprise discovered in production (journal entry `leadbay-monitor-lens-filter`, captured 2026-05-05). Surfacing it in the description prevents the agent from telling users "I imported your leads, check Monitor" — answer is the CRM-imports list, not Monitor.

### Stable qualification ordering + human_summary

Both `leadbay_import_and_qualify` and `leadbay_qualify_status` now sort `qualifications[]` by the org's `ai_agent_questions` catalog order — the same question appears at the same index across calls so LLM agents can position-index reliably. Catalog comes from `client.resolveTasteProfile()` (cached 10min). Falls back to alphabetical when the catalog is empty.

Each `qualified[]` entry also carries an optional `human_summary` string of the form `answered X/Y — <signal> on '<question>'[, <signal> on '<question>']` where `<signal>` is `strong positive` (score=20), `positive` (10), `neutral` (0), or `negative` (-10). Top-2 by absolute score. Saves the agent from reading every per-question response when it just needs the gist.

## 0.4.0 — 2026-05-04

### `leadbay_import_leads` 0.2.0 — custom field mapping

The MCP tool now drives the same CRM-import wizard the web UI exposes — pass arbitrary CSV-shaped records and tell Leadbay which column maps to which `StandardCrmFieldType`.

**Two modes** (pass exactly one of `domains` / `records`):

- **Mode A (existing, unchanged):** `domains: [{domain, name?}]` — synthesizes a 2-column CSV (LEAD_NAME, LEAD_WEBSITE) and uses the default mapping. Output shape is identical to 0.1.x: `{ leads: [{domain, leadId, name}], not_imported: [{domain, reason}], ... }`.
- **Mode B (new):** `records: [{Col1, Col2, ...}]` plus `mappings: { fields: { Col1: "LEAD_NAME", Col2: "LEAD_WEBSITE", Col3: "LEAD_SECTOR", ... } }`. The tool synthesizes a CSV from the union of record keys (sorted, deterministic) and POSTs the caller-supplied mapping to `/imports/{id}/update_mappings`. Output shape: `{ leads: [{rowId, domain?, leadId, name}], not_imported: [{rowId, domain?, reason}], ... }`. `rowId` round-trips your input row order; `domain` populated only when `LEAD_WEBSITE` was mapped and the value parsed.

Mappings.fields must include `LEAD_NAME` or `LEAD_WEBSITE` — the wizard's resolver needs at least one of those to find a lead. Other CRM fields (`LEAD_SECTOR`, `LEAD_LOCATION`, `LEAD_SIZE`, `EMAIL`, `CRM_ID`, `LEADBAY_ID`, `DEAL_CRM_ID`, `CONTACT_TITLE`, `LEAD_STATUS`, `LEAD_STATUS_DATE`) are passed through verbatim.

**Validation (records mode):** new typed error codes — `IMPORT_INPUT_CONFLICT` (both modes supplied), `IMPORT_MAPPING_REQUIRED` (no mappings.fields), `IMPORT_MAPPING_NO_RESOLVER` (no LEAD_NAME or LEAD_WEBSITE in mapping), `IMPORT_MAPPING_KEY_UNKNOWN` (mapping key absent from records), `IMPORT_RESERVED_COLUMN` (record or mapping key matches `MCP_ROW_ID` case-insensitively), `IMPORT_INVALID_COLUMN_NAME` (column name >128 chars or contains control chars), `IMPORT_INVALID_CELL_TYPE` (cell value is array/object — coerce to string before passing). null/undefined cells coerce to "", numbers/booleans coerce via `String(v)`.

**Security:** user-supplied column names now flow through the same `escapeCsvCell` (RFC 4180 quoting + formula-injection prefix) that data values use. Header injection vectors (`=`, `+`, `-`, `@`, `,`, `"`, newline) are neutered.

**Backward compat:** Mode A output shape unchanged — the new `rowId` field is records-mode only. Existing `domains: [...]` callers see no diff.

## 0.3.0 — 2026-04-29

Behavior-changing release: closes [product#3504](https://github.com/leadbay/product/issues/3504) end-to-end. Default-installed MCP server now matches its own system prompt out of the box, the `login` command never lands a bearer token in scrollback by default, and `claude mcp add` registers Leadbay at user scope so it's visible from any project.

### Coverage — composite write tools default ON

- **`LEADBAY_MCP_WRITE` default is now `"1"` (ON).** The composite write tools (`leadbay_bulk_qualify_leads`, `leadbay_enrich_titles`, `leadbay_refine_prompt`, `leadbay_report_outreach`, `leadbay_adjust_audience`, `leadbay_answer_clarification`, `leadbay_import_leads`) are exposed by default. Set `LEADBAY_MCP_WRITE=0` (or `--no-write` on `install`) to disable them.
- **`SERVER_INSTRUCTIONS` is now dynamic.** The system prompt sent to MCP clients references only the tools actually registered on this instance. Read-only-mode agents receive a different prompt that omits the verification mandate and tells the agent to ask the user to enable writes if they request a config-mutating action.
- **`leadbay-mcp install --include-write` is a no-op (deprecated).** Writes are on by default. Pass `--no-write` for the inverse. The deprecation warning prints **before** the password prompt so it's not buried.
- **`LEADBAY_MCP_WRITE` value-vocabulary expanded.** In 0.2.x only `"1"` was ON; `"true"` / `"yes"` / `"on"` were treated as OFF. In 0.3.0 the parser accepts all of those as ON, and `"0"` / `"false"` / `"no"` / `"off"` as OFF. Unrecognized values default to ON with a one-shot stderr warning. **Existing operators using `=true` / `=yes` / `=on` will see writes flip ON.** See [MIGRATION.md](./MIGRATION.md).

### Login — no token in stdout

- **`leadbay-mcp login` default writes a 0600-mode credentials file.** The path resolves to `$XDG_CONFIG_HOME/leadbay/credentials.json` if set, else `~/Library/Application Support/leadbay/credentials.json` on macOS, `%APPDATA%\leadbay\credentials.json` on Windows, else `~/.config/leadbay/credentials.json`. Existing `~/.leadbay-mcp.json` files (0.2.x) are still honored on this run with a deprecation note pointing at the new path (no automatic file move).
- **`--unsafe-print-token`** restores the previous "print JSON config to stdout" behavior. The deprecated `--print-token` alias still works for one release with a deprecation warning.
- **Collision detection** — if the target credentials file already exists with a different `LEADBAY_TOKEN` or `LEADBAY_REGION`, `login` refuses without `--force` and tells the operator how to keep both files.
- **EACCES / EROFS / ENOENT** errors on the file write print actionable remediation pointing at `--write-config /tmp/...` or `--unsafe-print-token`.

### Scope — visible from any project

- **`leadbay-mcp install` now passes `--scope user` to `claude mcp add`.** This was Ludo's third complaint in #3504: the default `claude mcp add` is project-local, so a freshly-opened conversation from a different directory can't see the server. README §2 (Claude Code), §1 (install), and §4 (troubleshooting table) all reflect the user-scope recommendation.

### Migration

- Read [MIGRATION.md](./MIGRATION.md) for the value-vocabulary flip, the login default, and the install scope change.
- The legacy DXT manifest key (`leadbay_mcp_write`) is unchanged in shape — it now defaults `true` (ON) and feeds the same `LEADBAY_MCP_WRITE` env var. Users who explicitly set the toggle to `false` keep their read-only behavior; users who never touched it (the bug case Ludo hit) now get the new default ON.
- Tests: dropped the `SERVER_INSTRUCTIONS` const re-export. Tests now exercise `buildServerInstructions(exposedSet)` directly across the default/read-only/advanced matrices. New unit suites: `parse-write-env.test.ts`, `login-default.test.ts`, `install-flags.test.ts`.

### Known follow-up (0.4.0)

- `compositeWriteTools` will split into safer-tier (credit-spending: bulk_qualify_leads, enrich_titles, report_outreach, answer_clarification) and config-mutating-tier (refine_prompt, adjust_audience, import_leads), with audit-log + one-click undo on the config-mutating side. Tracked separately.

## 0.2.5 — 2026-04-28

New `leadbay_import_leads` composite write tool.

- **New tool: [`leadbay_import_leads`](https://github.com/leadbay/product/issues/3537)** — accepts a list of `{ domain, name? }` and returns Leadbay `leadId`s for the ones the crawler already knows. Output is naturally chainable into `leadbay_bulk_qualify_leads({ leadIds })` and `leadbay_research_lead`. Gated behind `LEADBAY_MCP_WRITE=1` (MCP) and `exposeWrite=true` (OpenClaw).

  **⚠️ Writes user state.** Internally wraps Leadbay's CRM-import wizard (the only domain-import primitive the backend ships today). Each call:
    - creates a row in the user's CRM-imports list (visible in the web UI)
    - touches onboarding state (`startFileless`, onboarding step → PROCESSING)

  Suitable for occasional automation. **Not** suitable for high-cadence (>5 calls/day) — the right primitive is a clean async-import-with-crawl backend endpoint, tracked as a follow-up issue (`leadbay/backend` — prolonged async import jobs).

  **Surface:**
  - Input: `{ domains: [{domain, name?}], dry_run?: boolean, per_phase_budget_ms?, total_budget_ms? }`.
  - Output: `{ leads: [{domain, leadId, name}], not_imported: [{domain, reason}], importIds, region, _meta }` where `reason ∈ malformed | no_match | uncrawled | ambiguous | internal_error | dry_run`.
  - `dry_run: true` runs preprocess only — skips the lead-CRM linking. The CRM-imports row still appears (the wedge can't fully eliminate it without backend changes), but the heavier side effect of committing matches is skipped.
  - 8 typed error codes (`IMPORT_PREPROCESS_FAILED`, `IMPORT_PROCESSING_FAILED`, `IMPORT_BUDGET_EXHAUSTED`, `IMPORT_NOT_TERMINAL`, `IMPORT_ADMIN_REQUIRED`, `IMPORT_BILLING_REQUIRED`, `IMPORT_PAGINATION_RUNAWAY`, `IMPORT_EMPTY_INPUT`) — every one carries `{ code, message, hint }`. Per-domain `not_imported.reason="internal_error"` covers irreconcilable rows from the wizard.

  **Limitations (v1):** uncrawled domains land in `not_imported` with `reason: "uncrawled"` — the tool does NOT create new Leadbay leads for unknown websites; the caller decides what to do. The backend follow-up will lift this.

  **Implementation notes:** preflight admin check (fails in <500ms instead of after a 30s wizard timeout), MCP_ROW_ID-based reconciliation (resilient to wizard URL canonicalization), client-side chunking at 100 domains per CSV upload, stabilization loop after `processing.finished` to avoid races where some records are still in `MATCHING|IMPORTING`, RFC 4180 quoting + formula-injection (`=`/`+`/`-`/`@`) prefix on every cell, AbortSignal plumbing returns `{cancelled: true, importIds, ...}` so callers can recover. New helper `LeadbayClient.requestRawBinary()` for the CSV upload — mirrors `request()` exactly (auth, semaphore, error mapping, `_lastMeta`, `LEADBAY_MOCK=1` mock-mode parity).

- **README**: new `## Write tools (LEADBAY_MCP_WRITE=1)` section with the import quickstart.

## 0.2.4 — 2026-04-22

Claude Desktop 2026 compatibility + install UX polish. Also publishes the `refine_prompt` `/user_prompt` wire-key fix that landed on `main` in 0.2.3 but never reached npm.

- **Fix [product#3504](https://github.com/leadbay/product/issues/3504)** — `install --target claude-desktop` no longer silently no-ops on Claude Desktop 2026. The app moved to the DXT (Desktop Extension) system; the legacy `claude_desktop_config.json` is UI-prefs-only there and gets overwritten on every prefs save, so a block written to it disappears a few minutes later. `install` now detects DXT (via `Claude Extensions/`, `extensions-installations.json`, or `dxt:*` keys in `config.json`), prints a loud warning pointing at the `.dxt` bundle, and default-skips the legacy write. Pass `--force-legacy` to override.
- **New: shipping a `.dxt` bundle** — drag-drop into Claude Desktop 2026 → Settings → Extensions. Uploaded to each [GitHub Release](https://github.com/leadbay/leadclaw/releases). Dialog asks for token + region + write-toggle; no terminal required. Manifest is DXT 0.2 (`dxt_version: "0.2"`, `user_config.leadbay_token.sensitive: true`). Source for the build lives in `packages/dxt/`.
- **Fix**: `login` 401 errors no longer end with a dangling `:` when the backend returns an empty body. Messages now read `login failed (401) at <url> (wrong email or password?)`. 429/5xx get their own hints too. The core helper `formatLoginError` is exported from `@leadbay/core` so the MCP and ClawHub surfaces stay in sync.
- **README**: new section on `npm install -g` EACCES (sudo / npx / nvm workarounds — common on the official nodejs.org `.pkg`), and a pointer to the `.dxt` install for Claude Desktop 2026.
- **Also shipping** (previously merged but not yet published to npm) — `leadbay_refine_prompt` / `leadbay_set_user_prompt` now send `{ user_prompt }` instead of `{ prompt }` to `POST /user_prompt` ([product#3508](https://github.com/leadbay/product/issues/3508)). Fixes the JSON deserialization 400 Ludo hit during the 0.2.2 install session.

## 0.2.3 — 2026-04-21

Bug fix release.

- **Fix [product#3508](https://github.com/leadbay/product/issues/3508)**: `leadbay_refine_prompt` (and the granular `leadbay_set_user_prompt`) now send the correct `{ user_prompt }` body key to `POST /organizations/{orgId}/user_prompt`. Previous versions sent `{ prompt }`, which the backend's strict kotlinx.serialization rejected with a JSON deserialization error (400). The `dry_run` preview for both tools was printing the wrong shape too, which hid the mismatch from anyone inspecting it. New unit tests pin the wire key so this contract can't silently regress again.

## 0.2.2 — 2026-04-21

Bug fix + contract correction + mental-model docs release.

- **Fix [product#3504](https://github.com/leadbay/product/issues/3504)**: `npx -y @leadbay/mcp` no longer exits silently on Node 25. The `isEntrypoint` check now resolves both sides through `realpathSync`, so the npx shim symlink path matches the real `dist/bin.js`. Previously `main()` never ran under npx and the MCP host saw a dead connection with no diagnostic.
- Replaced stale `app.leadbay.ai` URLs in error strings (NOT_AUTHENTICATED, AUTH_INVALID, BILLING_SUSPENDED, PERMISSION_DENIED) and CLI help text with runnable commands (`leadbay-mcp install`, `leadbay-mcp login`) or "contact support". Recovery hints include `--region <us|fr>` because the CLI refuses without it (anti-cross-region credential-leak guard).
- Renamed misleading `avg_score_0_to_10` field on `pull_leads` / `bulk_qualify_leads` qualification summaries to `avg_qualification_boost`. Per-question AI agent scores are discrete boosts (-10/0/10/20), not 0-10 averages — interface JSDoc now reflects the real contract.
- `SERVER_INSTRUCTIONS` gains three new paragraphs: "How Leadbay works" (inbox + consumption-based pacing), "Two scoring layers" (basic `score` vs AI-qualified top ~10 with `ai_agent_lead_score`), and "Suggested rhythm" (daily check-in + host-agnostic scheduling hint).
- `leadbay_pull_leads`, `leadbay_research_lead`, `leadbay_bulk_qualify_leads`, `leadbay_enrich_titles`, and `leadbay_account_status` descriptions updated to reinforce the same model so the agent sees it at both top level and per-tool.
- New regression test `test/smoke/npx-entrypoint.test.ts` guards the symlink invocation path. New non-regression test asserts the inbox/pace/scoring/daily language stays in `SERVER_INSTRUCTIONS`.
- Live smoke harness extended with composite-level checks + (optional) thinking-model judge that writes a redacted report to `.context/`.

## 0.2.1 — 2026-04-21

Docs-only release.

- Removed the stale "pre-release — not yet on npm" banner that was packed into 0.2.0.
- Removed the §1.1 "install from source" section (covered the pre-publish case; obsolete now that 0.2.0 is live).
- §7 "For maintainers" replaced with a short pointer to the new `RELEASE.md` runbook.
- First release carrying signed sigstore provenance (repo is now public).

## 0.2.0 — 2026-04-20

First public npm release.

- Agent-optimized composite tool surface (pull_leads, research_lead, bulk_qualify_leads, enrich_titles, adjust_audience, refine_prompt, recall_ordered_titles, account_status, report_outreach).
- `leadbay-mcp install` one-shot setup: mints a token and registers the server with Claude Code, Claude Desktop, and Cursor.
- `leadbay-mcp login` lower-level token mint (`--write-config` drops a 0600 JSON).
- `leadbay-mcp doctor` validates token + region + quota.
- Gating: `LEADBAY_MCP_WRITE=1` for mutations, `LEADBAY_MCP_ADVANCED=1` for the granular API surface (both off by default).
- `report_outreach` requires a verification field (`gmail_message_id | calendar_event_id | user_confirmed`) to prevent pipeline poisoning.
- Mock mode via `LEADBAY_MOCK=1` for agent-author dry-running against `.context/leadbay-live-shapes/` fixtures.
- Tag-driven CI publish via `.github/workflows/release.yml` (push `mcp-v<version>` or `v<version>`).
- `--version` output now sourced from `package.json` at build time — no more drift between the tarball version and the binary's self-reported version.
