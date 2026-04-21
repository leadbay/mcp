# Changelog — @leadbay/mcp

## 0.2.2 — 2026-04-21

Docs-only release. Teach the agent the Leadbay mental model — agents were calling `pull_leads` like a generic query rather than as a daily inbox, missing that leads past the top ~10 still exist and can be deepened on demand.

- `SERVER_INSTRUCTIONS` gains three new paragraphs: "How Leadbay works" (inbox + consumption-based pacing), "Two scoring layers" (basic `score` vs AI-qualified top ~10 with `ai_agent_lead_score`), and "Suggested rhythm" (daily check-in + host-agnostic scheduling hint).
- `leadbay_pull_leads`, `leadbay_research_lead`, `leadbay_bulk_qualify_leads`, `leadbay_enrich_titles`, and `leadbay_account_status` descriptions updated to reinforce the same model so the agent sees it at both top level and per-tool.
- New non-regression test asserts the inbox/pace/scoring/daily language stays in `SERVER_INSTRUCTIONS`.
- No schema changes, no tool-shape changes — wire-compatible with 0.2.1.

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
