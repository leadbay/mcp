<p align="center">
  <img src="logo.png" alt="Leadbay MCP" width="200">
</p>

<h1 align="center">Leadbay MCP</h1>
<p align="center"><strong>Leadbay MCP connects your AI assistant to your Leadbay account, so you can work your leads by simply asking.</strong></p>
<p align="center">Pull leads, qualify them, draft outreach, and log activity — in plain language. Your assistant acts on your real Leadbay data, with your permissions, just as you would in the app.</p>
<p align="center">Everything is personalized — nothing to configure. Leadbay runs advanced AI on your website and market data to source and score leads against your target profile, so outreach becomes meaningful connection instead of senseless spamming.</p>
<p align="center">Tell your assistant which leads to prospect, connect your channels, and it sources contacts from Leadbay and handles outreach on your behalf. Enjoy the outreach you no longer have to do.
</p>

> **MCP** stands for *Model Context Protocol* — an open standard that lets AI assistants like Claude securely connect to external tools and data. This server is open source and lives at [github.com/leadbay/mcp](https://github.com/leadbay/mcp).

---

## How Leadbay thinks (mental model for your agent)

- **Inbox, not a database.** Each day your user logs back in, a fresh batch of leads is delivered. Batch size is paced by how many leads the user has actually acted on recently — some workflows produce a big stream of smaller prospects, others a narrow stream of bigger ones. Pulling more won't produce more; acting on leads does.
- **Two scoring layers.** Every lead ships with a basic `score` (firmographic — already decent, usually correlates with AI). Roughly the top 10 of each batch are also AI-qualified (targeted web research + qualification questions → `ai_agent_lead_score`). Leads below the top 10 aren't worse — the system is saving resources. The agent can request deeper qualification (`leadbay_bulk_qualify_leads`) or contact enrichment (`leadbay_enrich_titles`) on any lead that looks worth it.
- **Daily rhythm.** The agent works best as a daily check-in: pull fresh leads, skim the auto-qualified top, deepen 1-3 promising ones, propose outreach, then log what actually got sent via `leadbay_report_outreach`. If your host supports scheduling, set up a daily run.

---

# For users

Get Leadbay MCP running inside your AI assistant in a couple of minutes. No coding required.

> **New to Leadbay?** The friendly, screenshot-driven walkthrough — what a lens is, how scoring works, and the full MCP setup for every assistant — lives in the **[Leadbay user guide](https://docs.leadbay.ai/leadbay-mcp/what-is-leadbay-mcp)**. This README is the technical companion.

> **No Leadbay account yet?** [Create one here](https://wow.leadbay.ai/?register=true) first — you'll need it to sign in during setup.

## Connect on the web (no install)

If you use Claude on the web, Claude Desktop, or ChatGPT, the fastest path is a **custom connector** — no terminal, no tokens to copy. Add one URL and sign in with your browser:

- **Name:** `Leadbay`
- **URL:** `https://mcp.leadbay.app/mcp`  (EU accounts: `https://mcp.leadbay.app/fr/mcp`)

In Claude: **Settings → Connectors → + → Add custom connector**, paste the URL, then open the connector and **Connect**. Sign in with Leadbay, click **Approve**, and you're linked. The server handles OAuth in-app; updates are automatic — you never touch a config file.

## Install in Claude Desktop (one-click bundle)

Prefer a bundled desktop extension? Grab the one-click file.

**1. Download the extension**

👉 **[Download the latest Leadbay MCP for Claude (.dxt)](https://github.com/leadbay/mcp/releases/latest)**

On the releases page, click the file ending in **`.dxt`** to download it.

**2. Install it**

Double-click the downloaded `.dxt` file. Claude opens and shows an install dialog — click **Install**, and you're done.

**If the double-click doesn't open Claude**, install it manually:

1. Open Claude and go to your **profile → Settings → Extensions**.
2. Open **Advanced settings**.
3. Choose **Install extension…** and select the `.dxt` file you downloaded.

**3. Sign in**

Claude will prompt you to connect Leadbay. Sign in with your Leadbay account and you're ready — just ask your agent for leads.

## Using a local assistant?

Leadbay MCP also works with Claude Code, Claude Desktop, Cursor, and Codex. The **universal installer** sets everything up for you and lets you sign in with Leadbay.

Requires [Node.js 22+](https://nodejs.org). Then run:

```bash
npx -y -p @leadbay/mcp@latest installer
```

It opens in your browser where you click **Sign in with Leadbay**, then pick which assistants to connect. Works on macOS, Windows, and Linux.

**To uninstall**, run the same installer with `--uninstall`:

```bash
npx -y -p @leadbay/mcp@latest installer --uninstall
```

It opens an uninstall window showing only the assistants that have Leadbay connected — pick the ones to remove and click **Remove selected**. It only removes Leadbay; your other settings and connections are left untouched.

## Ask for your first leads

Open a new conversation and describe the outcome — you never name a tool, just say what you want, the way you'd ask a colleague:

> *Show me today's leads and tell me which two are worth opening first.*

A successful first reply is a **ranked table of prospects**, not a wall of text: each row has a fit score, a one-line why-it-fits, and the best contact to reach. Then keep going:

> *Research the top one — is it a fit for us?*

> *Draft me an outreach email to them.*

> *I just emailed them. Log it as outreach.*

---

# For developers

Everything below is for contributors and anyone running Leadbay MCP from source or wiring it into automation.

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

Every supported way to connect Leadbay MCP:

| Method | Command / action | Platforms | Notes |
|--------|------------------|-----------|-------|
| **Hosted connector (no install)** | Add custom connector → `https://mcp.leadbay.app/mcp` (EU `…/fr/mcp`) | Claude web / Desktop, ChatGPT | Browser OAuth in-app. Nothing to install; auto-updates. |
| **`.dxt` / `.mcpb` bundle** | Download from [Releases](https://github.com/leadbay/mcp/releases/latest), double-click → **Install** | Claude Desktop | One-click desktop extension. |
| **Guided installer (GUI)** | `npx -y -p @leadbay/mcp@latest installer` | macOS, Windows, Linux | Browser wizard: sign in with Leadbay, pick clients. Works for everyone. |
| **Local dev build** | `pnpm --filter @leadbay/mcp installer -- --local` | macOS, Windows, Linux | Registers clients against your local build. OAuth automatic. Build from source first (above). |
| **Claude Code plugin marketplace** | `/plugin marketplace add leadbay/mcp` then `/plugin install leadbay@leadbay-mcp` | Claude Code | Registers the MCP server **and** installs auto-triggering skills. |

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
/plugin marketplace add leadbay/mcp
```

```bash
/plugin install leadbay@leadbay-mcp
```

Claude Code prompts for Leadbay auth/config. Registers the MCP server **and** installs a set of skills that auto-trigger on natural-language asks — including `leadbay_daily_check_in` ("get my leads today"), `leadbay_research_a_domain` ("research acme.com"), `leadbay_followup_check_in`, `leadbay_qualify_top_n`, `leadbay_refine_audience`, `leadbay_log_outreach`, `leadbay_import_file`, `leadbay_plan_tour_in_city`, `leadbay_prospecting_overview`, `leadbay_extend_my_lens`, `leadbay_setup_team_prospecting`, `leadbay_build_campaign`, and `leadbay_work_campaign`. Each `SKILL.md` is generated by `@leadbay/promptforge` from the same source as the MCP prompts, so the two surfaces never drift.

### Uninstall

```bash
npx -y -p @leadbay/mcp@latest installer --uninstall
```

Opens the uninstall wizard — only shows clients that already have Leadbay MCP configured. De-registers Claude Code, strips the JSON stanza from Claude Desktop / Cursor configs, removes the `[mcp_servers.leadbay]` TOML block from Codex, and strips the managed `export LEADBAY_*` block from `~/.zshrc` / `~/.bashrc`. Uninstall is scoped to Leadbay — it never rewrites unrelated client settings or removes other MCP servers.

## Tools

Your assistant calls these on your behalf — you never call them directly. You ask in plain language ("show me today's leads", "research acme.com", "log that I emailed Jane") and the agent picks the right tool. The default surface below is always exposed; the [full per-tool reference](https://docs.leadbay.ai/leadbay-mcp/tools-reference) lives in the user guide.

### Always on — agent memory

A local, per-account memory of your taste signals (preferred sectors, deal size, communication style). It never leaves your machine.

| Tool | Description |
|------|-------------|
| `leadbay_agent_memory_recall` | Read the consolidated top taste signals |
| `leadbay_agent_memory_capture` | Record a new learning after you reveal a preference |
| `leadbay_agent_memory_review` | List entries; gate retractions / org promotion behind confirmation |

### Read-only (always on)

These never modify your account, so they're always safe to allow.

**Discover & follow up**

| Tool | Description |
|------|-------------|
| `leadbay_pull_leads` | Pull today's fresh batch of scored, ranked leads |
| `leadbay_pull_followups` | Pull the leads that need a follow-up action |
| `leadbay_account_status` | Check quota, credits, and account state |
| `leadbay_scan_portfolio_signals` | Scan your existing leads for a web signal in one pass ("which of my leads acquired a company since 2025?") — no quota burn |

**Research a company**

| Tool | Description |
|------|-------------|
| `leadbay_research_lead_by_id` | Deep-dive research card for a known lead — details + AI qualification + contacts in one response |
| `leadbay_research_lead_by_name_fuzzy` | Look up a lead by company name or domain when you don't have its ID |
| `leadbay_account_history` | Full history on one account — current AI signals + all notes + interaction timeline, in one call ("why has this account resurfaced?") |
| `leadbay_prepare_outreach` | Build a personalized outreach brief for a lead |

**Travel & field sales**

| Tool | Description |
|------|-------------|
| `leadbay_followups_map` | Geo-cluster your follow-ups on a map for travel planning |
| `leadbay_tour_plan` | Build a visit itinerary for an upcoming trip to a city |

**Campaigns**

| Tool | Description |
|------|-------------|
| `leadbay_list_campaigns` | List your existing campaigns |
| `leadbay_campaign_progression` | Show a campaign's funnel metrics |
| `leadbay_campaign_call_sheet` | Pull the call sheet for a campaign |

**Lenses, audience & qualification**

| Tool | Description |
|------|-------------|
| `leadbay_list_sectors` | List the real sector taxonomy labels — so you (and the agent) name sectors correctly, no guessing |
| `leadbay_recall_ordered_titles` | Recall the job titles previously enriched by the org (use before `leadbay_enrich_titles`) |
| `leadbay_seed_candidates` | Read-only discovery surface for building a bigger lens |
| `leadbay_get_qualification_questions` | Retrieve the org's AI-agent qualification questions (how leads are scored) |
| `leadbay_get_lead_custom_fields` | Retrieve the custom-field values stored on one lead |
| `leadbay_list_mappable_fields` | List the CRM fields you can map an import onto |

**Imports & jobs**

| Tool | Description |
|------|-------------|
| `leadbay_import_status` | Status of a running import job |
| `leadbay_qualify_status` | Status of a running qualification job |
| `leadbay_bulk_enrich_status` | Status of a running enrichment job |
| `leadbay_resolve_import_rows` | Map imported rows back to their lead IDs |

**Team, billing & product signals**

| Tool | Description |
|------|-------------|
| `leadbay_team_activity` | Manager-facing per-rep leaderboard + activity trend (non-admins are scoped to themselves) |
| `leadbay_create_topup_link` | Generate a Stripe top-up link (you pay in your browser — nothing is charged automatically) |
| `leadbay_open_billing_portal` | Open the billing portal |
| `leadbay_acknowledge_notification` | Clear a terminal bulk-job notification so it stops resurfacing |
| `leadbay_report_friction` | Report when a tool didn't deliver — helps improve the product (no account change) |
| `leadbay_artifact_kit` | Fetch the headless view-models the agent uses to build an interactive HTML artifact |

### Write actions (on by default since 0.3.0; set `LEADBAY_MCP_WRITE=0` to disable)

These take action on your account. Every action is one you could take yourself in the app — there's nothing destructive at the platform level, and deletes are confirm-gated.

**Qualify & enrich**

| Tool | Description |
|------|-------------|
| `leadbay_bulk_qualify_leads` | Trigger AI qualification on a batch of leads |
| `leadbay_enrich_titles` | Enrich contacts by job title |

**Outreach & activity**

| Tool | Description |
|------|-------------|
| `leadbay_report_outreach` | Log an outreach action (call, email, meeting) — required after every contact |
| `leadbay_add_note` | Add a note to a lead |
| `leadbay_like_lead` | Mark a lead as liked — teaches your taste profile |
| `leadbay_dislike_lead` | Mark a lead as disliked — teaches your taste profile |

**Contacts**

| Tool | Description |
|------|-------------|
| `leadbay_add_contact` | Add a person to a company (name + optional LinkedIn / title / email / phone) |
| `leadbay_remove_contact` | Remove a contact you added |
| `leadbay_pin_contact` | Pin a contact as the priority on a company |
| `leadbay_unpin_contact` | Unpin a contact |
| `leadbay_update_contact` | Edit a contact's details (title, email, LinkedIn…) |

**Lenses & audience**

| Tool | Description |
|------|-------------|
| `leadbay_my_lenses` | List, switch, rename/describe, or delete your lenses (delete is confirm-gated) |
| `leadbay_new_lens` | Create a named lens with sector / company-size (and optional location) criteria |
| `leadbay_adjust_audience` | Edit a lens's audience ("stop showing me companies over 50 employees"); pass `lensName` to edit a lens by name |
| `leadbay_extend_lens` | Fill your current lens with more leads on demand (subject to a daily refill quota) |
| `leadbay_refine_prompt` | Refine the qualification prompt that scores your leads |
| `leadbay_answer_clarification` | Answer a clarification question Leadbay asked about your audience |

**Imports & campaigns**

| Tool | Description |
|------|-------------|
| `leadbay_import_leads` | Import a list of company domains |
| `leadbay_import_and_qualify` | Import a list and immediately qualify it |
| `leadbay_create_campaign` | Create a new campaign |
| `leadbay_add_leads_to_campaign` | Add leads to a campaign |
| `leadbay_remove_leads_from_campaign` | Remove leads from a campaign |

**Custom fields & qualification questions**

| Tool | Description |
|------|-------------|
| `leadbay_create_custom_field` | Create a custom CRM field (e.g. to preserve a source-system ID) |
| `leadbay_update_custom_field` | Rename or retype a custom field |
| `leadbay_delete_custom_field` | Delete a custom field (confirm-gated) |
| `leadbay_set_qualification_questions` | Modify the org's AI-agent qualification questions (max 5; removals confirm-gated) |

**Feedback**

| Tool | Description |
|------|-------------|
| `leadbay_send_feedback` | Send a message to the Leadbay team (same inbox as the in-app feedback form) |

### Advanced granular tools (gated by `LEADBAY_MCP_ADVANCED=1`)

Low-level, single-API-call tools for power users and integrations (`leadbay_discover_leads`, `leadbay_get_lead_profile`, `leadbay_get_contacts`, `leadbay_list_lenses`, …). Off by default; enable by setting `LEADBAY_MCP_ADVANCED=1` in the MCP server's env. See [`packages/mcp/README.md`](packages/mcp/README.md#8-advanced) for the full list.

## How it works

The MCP server automatically uses your **active lens** (the last lens you used in Leadbay). Just call `leadbay_pull_leads` and it works — no lens configuration needed.

You can also manage lenses directly from chat: `leadbay_my_lenses` lists them and switches/renames/deletes; `leadbay_new_lens` creates a named one with sector/size criteria; and `leadbay_adjust_audience` edits an existing lens (the active one, or any lens by name via `lensName`). Sector names resolve against the live taxonomy — `leadbay_list_sectors` surfaces the real labels.

`leadbay_research_lead_by_id` bundles multiple API calls (lead details + AI qualification + contacts) into a single response. If some data isn't available yet, it returns partial results instead of failing.

## Configuration

| Env var | Required | Description |
|---------|----------|-------------|
| `LEADBAY_TOKEN` | Yes | Local OAuth bearer credential (set by the installer) |
| `LEADBAY_REGION` | Yes | `us` or `fr` |
| `LEADBAY_MCP_WRITE` | No | Set to `0` to disable write tools (default: on since 0.3.0) |
| `LEADBAY_MCP_ADVANCED` | No | Set to `1` to expose granular tools (default: off) |
| `LEADBAY_BASE_URL` | No | Override API URL (for staging/dev) |

The full environment-variable reference (telemetry, mock mode, logging, timeouts) is in [`packages/mcp/README.md`](packages/mcp/README.md#environment-variables).

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

## Privacy Policy

The Leadbay MCP server accesses your Leadbay account data (leads, contacts,
campaigns, notes) on your behalf through the Leadbay API, using a token you
authorize via OAuth. It does not read your conversation history, Claude memory,
or local files. Data handling is governed by the Leadbay
[privacy policy](https://www.leadbay.ai/privacy-policy) and
[terms of use](https://www.leadbay.ai/terms-of-use).

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
