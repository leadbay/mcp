# Changelog — @leadbay/mcp

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
