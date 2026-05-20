# Changelog — @leadbay/leadclaw

## 0.2.6 — 2026-05-18

New `leadbay_like_lead` and `leadbay_dislike_lead` write tools — exposed when `exposeWrite: true`. Picks up `@leadbay/core@0.6.1`. Manifest (`openclaw.plugin.json`): both tools added to `contracts.tools`.

## 0.2.5 — 2026-04-28

New `leadbay_import_leads` composite write tool — exposed when `exposeWrite: true`.

- **New tool: [`leadbay_import_leads`](https://github.com/leadbay/product/issues/3537)** — exposed alongside the other composite writes (`bulk_qualify_leads`, `enrich_titles`, `report_outreach`, etc.) when the plugin config has `exposeWrite: true`. Same surface and semantics as the MCP version.

  **⚠️ Writes user state.** Wraps Leadbay's CRM-import wizard. Each call creates a CRM-imports row visible in the user's web UI and touches onboarding state. Suitable for occasional automation, not high-cadence (>5 calls/day). Caller is admin-only.

  Inputs/outputs/error codes documented in `@leadbay/mcp@0.2.5`'s CHANGELOG.

  Manifest (`openclaw.plugin.json`): `leadbay_import_leads` added to `contracts.tools`.

## 0.2.4 — 2026-04-22

Version kept in sync with `@leadbay/mcp@0.2.4`. Picks up `@leadbay/core`'s new `formatLoginError` helper so login failures surface a readable error instead of a dangling colon ([product#3504](https://github.com/leadbay/product/issues/3504)). No OpenClaw-facing contract changes in this release.

## 0.2.3 — 2026-04-21

Bug fix release. Picks up `@leadbay/core@0.2.2` underneath.

- **Fix [product#3508](https://github.com/leadbay/product/issues/3508)**: `leadbay_refine_prompt` (and the granular `leadbay_set_user_prompt`) now send `{ user_prompt }` to `POST /organizations/{orgId}/user_prompt` instead of `{ prompt }`. The backend's `UserPromptPayload` uses `@SerialName("user_prompt")` with strict kotlinx.serialization, so the old key was rejected as a deserialization error (400). The `dry_run` preview was affected the same way. Version kept in sync with `@leadbay/mcp@0.2.3`.

## 0.2.2 — 2026-04-21

Bug fix + contract correction + mental-model docs release. Picks up `@leadbay/core@0.2.1` underneath.

- Renamed misleading `avg_score_0_to_10` field on the `pull_leads` / `bulk_qualify_leads` qualification summaries to `avg_qualification_boost`. Per-question AI agent scores are discrete boosts (-10/0/10/20), not a 0-10 average — interface JSDoc now reflects the real contract.
- Replaced stale `app.leadbay.ai` URLs in client-side error strings with runnable recovery commands. Recovery hints now include `--region <us|fr>` because the CLI refuses without it (anti-cross-region credential-leak guard).
- README: stale `app.leadbay.ai` references swept.
- Plugin manifest description rewritten from "Leadbay lead discovery, qualification, and contact enrichment for AI agents" to a framing that names the inbox model, the two scoring layers, and on-demand deepening.
- Composite tool descriptions (`pull_leads`, `research_lead`, `bulk_qualify_leads`, `enrich_titles`, `account_status`) now teach the agent that Leadbay delivers a fresh batch per user login, paced by recent consumption; that roughly the top 10 are pre-AI-qualified while the rest are resource-saved (not worse); and that contacts are enriched on demand when the agent is ready to reach out.
- Version kept in sync with `@leadbay/mcp@0.2.2`.

## 0.2.1 — 2026-04-21

No functional changes. First release shipping with signed sigstore provenance (repo is now public, which unblocks npm's provenance gate). Version kept in sync with `@leadbay/mcp@0.2.1`.

## 0.2.0 — 2026-04-20

First public release to npm and ClawHub.

- 50-tool surface split across composite (read-only, default), granular (`exposeGranular: true`), and write (`exposeWrite: true`) tiers.
- Composite workflow tools mirror the `@leadbay/mcp` agent-facing surface: pull_leads, research_lead, research_company, prepare_outreach, account_status, recall_ordered_titles, bulk_qualify_leads, enrich_titles.
- Write tools follow a verification-first contract — `report_outreach` requires `gmail_message_id | calendar_event_id | user_confirmed`.
- Config schema + ui hints: `region` (us/fr, required-ish), `token`, `baseUrl`, `exposeGranular`, `exposeWrite`.
- Tag-driven CI publish via `.github/workflows/release.yml` (push `leadclaw-v<version>` to ship to npm, then ClawHub).
- Version drift guard: CI fails if `package.json` and `openclaw.plugin.json` disagree.
