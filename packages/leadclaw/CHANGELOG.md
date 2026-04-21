# Changelog — @leadbay/leadclaw

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
