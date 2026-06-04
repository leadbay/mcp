<p align="center">
  <img src="logo.png" alt="LeadMCP" width="200">
</p>

<h1 align="center">LeadMCP</h1>
<p align="center">MCP server that gives your B2B outreach agent superpowers. LeadMCP lets your agent tap into Leadbay's rich knowledge base of companies, turning outreach activity from senseless spamming into meaningful connections.</p>
<p align="center">Ask your agent for new leads, and it will pull highly qualified companies that score well against your target profile and meet your qualification criteria.</p>
<p align="center">Everything is personalized—nothing to configure. Leadbay runs advanced AI agents on your website and leverages deep B2B sales expertise to optimize how leads are sourced for you.</p>
<p align="center">Tell your agent which leads you want it to prospect, connect your communication channels, and it will source contacts from Leadbay and handle outreach on your behalf. Enjoy the outreach you no longer have to do.
</p>

---

## How Leadbay thinks (mental model for your agent)

- **Inbox, not a database.** Each day your user logs back in, a fresh batch of leads is delivered. Batch size is paced by how many leads the user has actually acted on recently — some workflows produce a big stream of smaller prospects, others a narrow stream of bigger ones. Pulling more won't produce more; acting on leads does.
- **Two scoring layers.** Every lead ships with a basic `score` (firmographic — already decent, usually correlates with AI). Roughly the top 10 of each batch are also AI-qualified (targeted web research + qualification questions → `ai_agent_lead_score`). Leads below the top 10 aren't worse — the system is saving resources. The agent can request deeper qualification (`leadbay_bulk_qualify_leads`) or contact enrichment (`leadbay_enrich_titles`) on any lead that looks worth it.
- **Daily rhythm.** The agent works best as a daily check-in: pull fresh leads, skim the auto-qualified top, deepen 1-3 promising ones, propose outreach, then log what actually got sent via `leadbay_report_outreach`. If your host supports scheduling, set up a daily run.

---

# For users

Get LeadMCP running inside your AI assistant in a couple of minutes. No coding required.

> **No Leadbay account yet?** [Create one here](https://wow.leadbay.ai/?register=true) first — you'll need it to sign in during setup.

## Install in Claude (recommended)

The fastest way to get started is the one-click Claude extension.

**1. Download the extension**

👉 **[Download the latest LeadMCP for Claude (.dxt)](https://github.com/leadbay/leadclaw/releases/latest)**

On the releases page, click the file ending in **`.dxt`** to download it.

**2. Install it**

Double-click the downloaded `.dxt` file. Claude opens and shows an install dialog — click **Install**, and you're done.

**If the double-click doesn't open Claude**, install it manually:

1. Open Claude and go to your **profile → Settings → Extensions**.
2. Open **Advanced settings**.
3. Choose **Install extension…** and select the `.dxt` file you downloaded.

**3. Sign in**

Claude will prompt you to connect Leadbay. Sign in with your Leadbay account and you're ready — just ask your agent for leads.

## Using another assistant?

LeadMCP also works with Claude Code, Claude Desktop, Cursor, and Codex. The **universal installer** sets everything up for you and lets you sign in with Leadbay.

Requires [Node.js 22+](https://nodejs.org). Then run:

```bash
npx -y -p @leadbay/mcp@latest installer
```

It opens a window where you click **Sign in with Leadbay**, then pick which assistants to connect. Available on macOS and Windows.

**To uninstall**, run the same installer with `--uninstall`:

```bash
npx -y -p @leadbay/mcp@latest installer --uninstall
```

It opens an uninstall window showing only the assistants that have Leadbay connected — pick the ones to remove and click **Remove selected**. It only removes Leadbay; your other settings and connections are left untouched.

---

# For developers

Everything below is for contributors and anyone running LeadMCP from source or wiring it into automation.

## Install a local version with the custom installer

To run your local checkout (instead of the published package), first build it from source:

```bash
pnpm install
pnpm prompts:build
pnpm -r build
```

Then point the installer at your freshly built version with `--local`:

```bash
pnpm --filter @leadbay/mcp installer -- --local
```

`--local` registers the MCP client(s) against the build in your working tree rather than `@leadbay/mcp@latest`. OAuth is handled automatically — you don't need to pass `--oauth`. The installer asks per-target before writing anything.

## All install methods

Every supported way to connect LeadMCP, from one-click to fully manual:

| Method | Command / action | Platforms | Notes |
|--------|------------------|-----------|-------|
| **`.dxt` / `.mcpb` bundle** | Download from [Releases](https://github.com/leadbay/leadclaw/releases/latest), double-click → **Install** | Claude Desktop | One-click. The recommended path for end users. |
| **Guided installer (GUI)** | `npx -y -p @leadbay/mcp@latest installer` | macOS, Windows | Electron wizard: sign in with Leadbay, pick clients. |
| **Headless CLI install** | `npx -y @leadbay/mcp@latest install --oauth` | macOS, Windows, Linux | One-shot: browser OAuth + register every detected client; confirms before each write. The only path on Linux. |
| **Local dev build** | `pnpm --filter @leadbay/mcp installer -- --local` | macOS, Windows, Linux | Registers clients against your local build. OAuth automatic. Build from source first (above). |
| **Claude Code plugin marketplace** | `/plugin marketplace add leadbay/leadclaw` then `/plugin install leadbay@leadbay-leadclaw` | Claude Code | Registers the MCP server **and** installs auto-triggering skills. |
| **Manual config** | Mint a token with `npx -y @leadbay/mcp@latest login --oauth`, then paste the `mcpServers.leadbay` entry into your client config | Any | Lower-level; use when you want to edit the config file yourself. |

### What each installer writes per client

The GUI/CLI installers only touch clients that are actually installed on the machine:

| Client | Installer behavior |
|--------|--------------------|
| Claude Code | Registers/removes `leadbay` with `claude mcp add/remove --scope user` |
| Claude Desktop | Writes/removes only the `mcpServers.leadbay` entry in `claude_desktop_config.json` |
| Cursor | Writes/removes only the `mcpServers.leadbay` entry in Cursor's MCP config |
| Codex | Writes/removes only the `[mcp_servers.leadbay]` block in `~/.codex/config.toml` and the Leadbay-managed shell export block |

### Claude Code plugin marketplace

```bash
/plugin marketplace add leadbay/leadclaw
```

```bash
/plugin install leadbay@leadbay-leadclaw
```

Claude Code prompts for Leadbay auth/config. Registers the MCP server **and** installs skills (`leadbay_research_a_domain`, `leadbay_import_file`, `leadbay_log_outreach`, `leadbay_qualify_top_n`, `leadbay_refine_audience`, and others) that auto-trigger on natural-language asks.

### Uninstall

```bash
npx -y -p @leadbay/mcp@latest installer --uninstall
```

Opens the uninstall wizard — only shows clients that already have Leadbay MCP configured. De-registers Claude Code, strips the JSON stanza from Claude Desktop / Cursor configs, removes the `[mcp_servers.leadbay]` TOML block from Codex, and strips the managed `export LEADBAY_*` block from `~/.zshrc` / `~/.bashrc`. Uninstall is scoped to Leadbay — it never rewrites unrelated client settings or removes other MCP servers.

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
| `leadbay_list_sectors` | List the sector taxonomy (real labels to target — no guessing) |
| `leadbay_recall_ordered_titles` | List job titles previously enriched by the org (use before `leadbay_enrich_titles`) |
| `leadbay_create_topup_link` | Generate a Stripe top-up link (quota recovery) |
| `leadbay_open_billing_portal` | Open the billing portal |

### Write actions (gated by `LEADBAY_MCP_WRITE=1`, default ON since 0.3.0)

| Tool | Description |
|------|-------------|
| `leadbay_bulk_qualify_leads` | Trigger AI qualification on a batch of leads |
| `leadbay_enrich_titles` | Enrich contact job titles |
| `leadbay_my_lenses` | List, switch, rename/describe, or delete your lenses (delete is confirm-gated) |
| `leadbay_new_lens` | Create a new named lens with sectors/sizes (previews & confirms before creating) |
| `leadbay_adjust_audience` | Adjust a lens audience by sector/size — pass `lensName` to edit a lens by name (edit-only, doesn't switch your active lens) |
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

You can also manage lenses directly from chat: `leadbay_my_lenses` lists them and switches/renames/deletes; `leadbay_new_lens` creates a named one with sector/size criteria; and `leadbay_adjust_audience` edits an existing lens (the active one, or any lens by name via `lensName`). Sector names resolve against the live taxonomy — `leadbay_list_sectors` surfaces the real labels.

`leadbay_research_lead_by_id` bundles multiple API calls (lead details + AI qualification + contacts) into a single response. If some data isn't available yet, it returns partial results instead of failing.

## Configuration

| Env var | Required | Description |
|---------|----------|-------------|
| `LEADBAY_TOKEN` | Yes | Local OAuth bearer credential (set by the installer) |
| `LEADBAY_REGION` | Yes | `us` or `fr` |
| `LEADBAY_MCP_WRITE` | No | Set to `0` to disable write tools (default: on) |
| `LEADBAY_MCP_ADVANCED` | No | Set to `1` to expose granular tools (default: off) |
| `LEADBAY_BASE_URL` | No | Override API URL (for staging/dev) |

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

## Building from source

```bash
pnpm install
```

```bash
pnpm prompts:build
```

```bash
pnpm -r build
```

```bash
pnpm -r test
```

```bash
pnpm -r typecheck
```

### Test tiers

- **Unit tests** (`packages/core/test/unit/`) — error-code mapping, tool branches. Use `mockHttp` from `test/harness.ts` to stub `node:https`. No network required.
- **Integration tests** (`packages/core/test/integration/`) — opt-in. Set `LEADBAY_TEST_TOKEN` and run `pnpm test:smoke`.
- **Audit tests** (`packages/mcp/test/audit/`) — assert tool descriptions, routing blocks, and WORKFLOWS.md consistency at build time. Always run on CI.
- **Eval tests** (`packages/mcp/test/eval/`) — LLM-graded scenarios. Gated by `EVAL=1`.

See [`CLAUDE.md`](CLAUDE.md) for the full contributor guide: tool structure, test conventions, build pipeline, and how to add a new tool.

## Publishing

All releases are tag-driven — **never run `npm publish` locally.** GitHub Actions owns publishing.

1. Bump `packages/mcp/package.json#version` + add CHANGELOG entry, land PR.

```bash
git checkout main && git pull
```

```bash
git tag mcp-v0.x.0
```

```bash
git push origin mcp-v0.x.0
```

2. Watch the release workflow: `preflight-npm → publish-mcp`.

For dry runs: Actions → `release` → "Run workflow" → `package: mcp`, `dry_run: true`.

Full runbook (auth setup, failure modes, manual re-runs): [`RELEASE.md`](RELEASE.md).
