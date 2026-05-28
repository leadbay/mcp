<p align="center">
  <img src="logo.png" alt="LeadClaw" width="200">
</p>

<h1 align="center">LeadClaw</h1>
<p align="center">MCP server that gives your B2B outreach agent superpowers. LeadClaw lets your agent tap into Leadbay's rich knowledge base of companies, turning outreach activity from senseless spamming into meaningful connections.</p>
<p align="center">Ask your agent for new leads, and it will pull highly qualified companies that score well against your target profile and meet your qualification criteria.</p>
<p align="center">Everything is personalized—nothing to configure. Leadbay runs advanced AI agents on your website and leverages deep B2B sales expertise to optimize how leads are sourced for you.</p>
<p align="center">Tell your agent which leads you want it to prospect, connect your communication channels, and it will source contacts from Leadbay and handle outreach on your behalf. Enjoy the outreach you no longer have to do.
</p>

---

> **New to Leadbay?** [Create your account here](https://wow.leadbay.ai/?register=true) before installing.

## How Leadbay thinks (mental model for your agent)

- **Inbox, not a database.** Each day your user logs back in, a fresh batch of leads is delivered. Batch size is paced by how many leads the user has actually acted on recently — some workflows produce a big stream of smaller prospects, others a narrow stream of bigger ones. Pulling more won't produce more; acting on leads does.
- **Two scoring layers.** Every lead ships with a basic `score` (firmographic — already decent, usually correlates with AI). Roughly the top 10 of each batch are also AI-qualified (targeted web research + qualification questions → `ai_agent_lead_score`). Leads below the top 10 aren't worse — the system is saving resources. The agent can request deeper qualification (`leadbay_bulk_qualify_leads`) or contact enrichment (`leadbay_enrich_titles`) on any lead that looks worth it.
- **Daily rhythm.** The agent works best as a daily check-in: pull fresh leads, skim the auto-qualified top, deepen 1-3 promising ones, propose outreach, then log what actually got sent via `leadbay_report_outreach`. If your host supports scheduling, set up a daily run.

## Install

> **No Leadbay account yet?** [Register here](https://wow.leadbay.ai/?register=true) first.

All install paths require a **Leadbay token**. Mint one first, then wire it into your client.

---

### Option A — Claude Desktop (easiest)

1. Download `leadbay-mcp-*.dxt` from the [Releases page](https://github.com/leadbay/leadclaw/releases/latest)
2. Double-click it — Claude Desktop opens and asks you to confirm the install
3. Enter your Leadbay email, password, and region (`us` or `fr`) when prompted
4. Restart Claude Desktop, open a new chat, and try: *"Show me today's leads."*

---

### Option B — Cursor / Claude Code / any MCP client

Requires [Node.js 22+](https://nodejs.org).

```bash
npx -y @leadbay/mcp@latest install --email you@yourcompany.com --region us
```

Prompts for your password (hidden, never saved), mints a token, and registers the server into every MCP client it detects (Claude Desktop, Cursor, Claude Code), asking you per-target.

> `--region` is required. Check your Leadbay dashboard URL: `app-us.leadbay.app` → `us`, `app-fr.leadbay.app` → `fr`.

---

### Option C — Claude Code plugin marketplace

```text
/plugin marketplace add leadbay/leadclaw
/plugin install leadbay@leadbay-leadclaw
```

Claude Code prompts for your token and region. Registers the MCP server **and** installs six skills (`leadbay_daily_check_in`, `leadbay_research_a_domain`, `leadbay_import_file`, `leadbay_log_outreach`, `leadbay_qualify_top_n`, `leadbay_refine_audience`) that auto-trigger on natural-language asks.

## Tools

### Read-only (always on)

| Tool | Description |
|------|-------------|
| `leadbay_pull_leads` | Pull today's fresh batch of scored leads |
| `leadbay_pull_followups` | Pull leads that need follow-up action |
| `leadbay_followups_map` | Geo-clustered follow-up map for travel planning |
| `leadbay_tour_plan` | Build a visit plan for an upcoming trip |
| `leadbay_research_lead_by_id` | Deep-dive research card for a single lead |
| `leadbay_research_lead_by_name_fuzzy` | Look up a lead by company name |
| `leadbay_prepare_outreach` | Build a personalized outreach brief for a lead |
| `leadbay_account_status` | Check quota, credits, and account state |
| `leadbay_list_campaigns` | List existing campaigns |
| `leadbay_campaign_progression` | Campaign funnel metrics |
| `leadbay_campaign_call_sheet` | Call sheet for a campaign |
| `leadbay_bulk_enrich_status` | Status of a running enrichment job |
| `leadbay_qualify_status` | Status of a running qualification job |
| `leadbay_import_status` | Status of a running import job |
| `leadbay_resolve_import_rows` | Resolve import rows to lead IDs |
| `leadbay_list_mappable_fields` | List CRM fields available for mapping |
| `leadbay_create_topup_link` | Generate a Stripe top-up link (quota recovery) |
| `leadbay_open_billing_portal` | Open the billing portal |

### Write actions (gated by `LEADBAY_MCP_WRITE=1`, default ON since 0.3.0)

| Tool | Description |
|------|-------------|
| `leadbay_bulk_qualify_leads` | Trigger AI qualification on a batch of leads |
| `leadbay_enrich_titles` | Enrich contact job titles |
| `leadbay_adjust_audience` | Adjust the active lens audience |
| `leadbay_refine_prompt` | Refine the qualification prompt |
| `leadbay_answer_clarification` | Answer a clarification question from Leadbay |
| `leadbay_report_outreach` | Log outreach activity (required after every contact) |
| `leadbay_import_leads` | Import a list of company domains |
| `leadbay_import_and_qualify` | Import + immediately qualify leads |
| `leadbay_add_note` | Add a note to a lead |
| `leadbay_like_lead` | Mark a lead as liked |
| `leadbay_dislike_lead` | Mark a lead as disliked |
| `leadbay_create_campaign` | Create a new campaign |
| `leadbay_add_leads_to_campaign` | Add leads to a campaign |
| `leadbay_remove_leads_from_campaign` | Remove leads from a campaign |
| `leadbay_create_custom_field` | Create a custom CRM field |

### Advanced granular tools (gated by `LEADBAY_MCP_ADVANCED=1`)

Low-level single-API-call tools for power users and integrations. Enabled by setting `LEADBAY_MCP_ADVANCED=1` in the MCP server's env.

## How it works

The MCP server automatically uses your **active lens** (the last lens you used in Leadbay). Just call `leadbay_pull_leads` and it works — no lens configuration needed.

`leadbay_research_lead_by_id` bundles multiple API calls (lead details + AI qualification + contacts) into a single response. If some data isn't available yet, it returns partial results instead of failing.

## Configuration

| Env var | Required | Description |
|---------|----------|-------------|
| `LEADBAY_TOKEN` | Yes | Bearer token (set by the installer) |
| `LEADBAY_REGION` | Yes | `us` or `fr` |
| `LEADBAY_MCP_WRITE` | No | Set to `0` to disable write tools (default: on) |
| `LEADBAY_MCP_ADVANCED` | No | Set to `1` to expose granular tools (default: off) |
| `LEADBAY_API_BASE_URL` | No | Override API URL (for staging/dev) |

## Workflows

The canonical inventory of what the MCP supports — supported / partial / planned / blocked-on-backend — is **[WORKFLOWS.md](WORKFLOWS.md)**. Use it to triage incoming asks: find the row that matches, or add a new one. A small audit asserts every cited tool/prompt and test path is real, so the table can't silently drift.

Quick taste:

```
leadbay_pull_leads → leadbay_research_lead_by_id → leadbay_prepare_outreach   # discover & research
leadbay_pull_followups → leadbay_followups_map → leadbay_prepare_outreach     # travel/geo follow-ups
leadbay_import_leads → leadbay_bulk_qualify_leads                             # import & qualify
```

## Requirements

- Node.js 22+
- A [Leadbay account](https://wow.leadbay.ai/?register=true)

## Development

```bash
pnpm install
pnpm prompts:build   # .md.tmpl → generated TS
pnpm -r build        # compile everything
pnpm -r test         # must be green
pnpm -r typecheck    # must be green
```

### Test tiers

- **Unit tests** (`packages/core/test/unit/`) — error-code mapping, tool branches. Use `mockHttp` from `test/harness.ts` to stub `node:https`. No network required.
- **Integration tests** (`packages/core/test/integration/`) — opt-in. Set `LEADBAY_TEST_TOKEN` and run `pnpm test:smoke`.
- **Audit tests** (`packages/mcp/test/audit/`) — assert tool descriptions, routing blocks, and WORKFLOWS.md consistency at build time. Always run on CI.
- **Eval tests** (`packages/mcp/test/eval/`) — LLM-graded scenarios. Gated by `EVAL=1`.

See [`CLAUDE.md`](CLAUDE.md) for the full contributor guide: tool structure, test conventions, build pipeline, and how to add a new tool.

## Publishing

All releases are tag-driven — **never run `npm publish` locally.** GitHub Actions owns publishing.

```bash
# 1. Bump packages/mcp/package.json#version + add CHANGELOG entry, land PR
git checkout main && git pull
git tag mcp-v0.x.0
git push origin mcp-v0.x.0
# 2. Watch the release workflow: preflight-npm → publish-mcp
```

For dry runs: Actions → `release` → "Run workflow" → `package: mcp`, `dry_run: true`.

Full runbook (token setup, failure modes, manual re-runs): [`RELEASE.md`](RELEASE.md).
