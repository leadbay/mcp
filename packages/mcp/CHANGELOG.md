# Changelog — @leadbay/mcp

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
