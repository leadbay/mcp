# Changelog — @leadbay/mcp

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
