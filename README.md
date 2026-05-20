<p align="center">
  <img src="logo.png" alt="LeadClaw" width="200">
</p>

<h1 align="center">LeadClaw</h1>
<p align="center">OpenClaw plugin that gives your B2B outreach agent superpowers. LeadClaw lets your agent tap into Leadbay’s rich knowledge base of companies, turning outreach activity from senseless spamming into meaningful connections.</p>
<p align="center">Ask your agent for new leads, and it will pull highly qualified companies that score well against your target profile and meet your qualification criteria.</p>
<p align="center">Everything is personalized—nothing to configure. Leadbay runs advanced AI agents on your website and leverages deep B2B sales expertise to optimize how leads are sourced for you.</p>
<p align="center">Tell your agent which leads you want it to prospect, connect your communication channels, and it will source contacts from Leadbay and handle outreach on your behalf. Enjoy the outreach you no longer have to do.
</p>

---

> **New to Leadbay?** [Create your account here](https://wow.leadbay.ai/?register=true) before installing the plugin.

## How Leadbay thinks (mental model for your agent)

- **Inbox, not a database.** Each day your user logs back in, a fresh batch of leads is delivered. Batch size is paced by how many leads the user has actually acted on recently — some workflows produce a big stream of smaller prospects, others a narrow stream of bigger ones. Pulling more won't produce more; acting on leads does.
- **Two scoring layers.** Every lead ships with a basic `score` (firmographic — already decent, usually correlates with AI). Roughly the top 10 of each batch are also AI-qualified (targeted web research + qualification questions → `ai_agent_lead_score`). Leads below the top 10 aren't worse — the system is saving resources. The agent can request deeper qualification (`leadbay_bulk_qualify_leads`) or contact enrichment (`leadbay_enrich_titles`) on any lead that looks worth it.
- **Daily rhythm.** The agent works best as a daily check-in: pull fresh leads, skim the auto-qualified top, deepen 1-3 promising ones, propose outreach, then log what actually got sent via `leadbay_report_outreach`. If your host supports scheduling, set up a daily run.

## Install

Leadbay ships in three shapes depending on which host runs your agent. Pick one — they are independent installs.

### Via OpenClaw

```bash
openclaw plugins install @leadbay/openclaw-leadclaw
openclaw config set plugins.entries.leadclaw.region "us"   # or "fr"
```

Start a conversation — the agent will ask for your Leadbay email and password when needed. The plugin logs you in and discards your credentials (only the session token is kept in memory).

### Via MCP (Claude Desktop, Cursor, Cowork, any MCP client)

```bash
npx -y @leadbay/mcp@0.10 install --email you@yourcompany.com --region us
```

The installer auto-detects which MCP clients you have (Claude Desktop, Cursor, Claude Code), prompts you per-target, and writes the token into each client's config. Add `--no-write` to disable the composite write tools. Full per-client setup, env vars, troubleshooting, and a tour of the MCP primitives is in [`packages/mcp/README.md`](packages/mcp/README.md).

### Via the Claude Code plugin marketplace

```text
/plugin marketplace add leadbay/leadclaw
/plugin install leadbay@leadbay-leadclaw
```

This single install registers the MCP server **and** drops six auto-discovered skills (`leadbay_daily_check_in`, `leadbay_research_a_domain`, `leadbay_import_file`, `leadbay_log_outreach`, `leadbay_qualify_top_n`, `leadbay_refine_audience`) that auto-trigger on natural-language asks. Claude Code prompts for your Leadbay token + region through the plugin's `userConfig` — no separate `leadbay-mcp install` step needed.

### Don't have a Leadbay account?

[Register here](https://wow.leadbay.ai/?register=true) before installing.

## Tools

### Authentication

| Tool | Description |
|------|-------------|
| `leadbay_login` | Log in with your Leadbay email and password |

### Read-only (enabled by default)

| Tool | Description |
|------|-------------|
| `leadbay_list_lenses` | List available lenses (saved search configs) |
| `leadbay_discover_leads` | Get AI-recommended leads from your active lens |
| `leadbay_get_lead_profile` | Full lead profile with AI scores, qualification Q&A, and contacts |
| `leadbay_get_lead_activities` | Activity feed for a lead (notes, enrichments, status changes) |
| `leadbay_get_taste_profile` | Your ideal buyer profile, purchase-intent tags, and AI qualification questions |
| `leadbay_get_contacts` | Get contacts for a lead (with enriched emails/phones if available) |
| `leadbay_get_quota` | Check your enrichment credit balance |

### Write actions (must be explicitly enabled)

| Tool | Description |
|------|-------------|
| `leadbay_qualify_lead` | Trigger AI qualification on a lead (~60s async) |
| `leadbay_enrich_contacts` | Order email/phone enrichment for a contact (~60s async) |
| `leadbay_add_note` | Add a note to a lead (visible to your team) |
| `leadbay_import_leads` | Map a list of company domains to Leadbay `leadId`s, chainable into `leadbay_bulk_qualify_leads`. Wraps the CSV-import wizard; **mutates user state** (creates a CRM-imports row). Suitable for occasional automation, not high-cadence. Admin-only. |

## How it works

The plugin automatically uses your **active lens** (the last lens you used in Leadbay). Just call `leadbay_discover_leads` and it works — no lens configuration needed.

For lead profiles, `leadbay_get_lead_profile` bundles three API calls (lead details + AI qualification + contacts) into a single response. If some data isn't available yet, it returns partial results instead of failing.

## Example workflows

**Discover and research leads:**
```
leadbay_discover_leads → leadbay_get_lead_profile (for interesting leads)
```

**Get contact information:**
```
leadbay_get_quota → leadbay_get_contacts → leadbay_enrich_contacts → (wait ~60s) → leadbay_get_contacts
```

**Qualify leads without AI scores:**
```
leadbay_discover_leads → leadbay_qualify_lead (for unscored leads) → (wait ~60s) → leadbay_get_lead_profile
```

## Configuration

| Key | Required | Description |
|-----|----------|-------------|
| `leadbay.region` | Yes | `us` or `fr` |
| `leadbay.baseUrl` | No | Override API URL (for staging/dev) |

## Requirements

- Node.js 22+
- A [Leadbay account](https://wow.leadbay.ai/?register=true)

## Development

```bash
npm install        # installs deps + vitest
npm test           # runs contract + unit + sanity tests (no network, no secrets)
npm run test:coverage   # coverage report via v8
npm run build      # emits dist/
```

### Test tiers

- **Contract tests** (`test/contract.test.ts`) — assert that registered tools match `openclaw.plugin.json` exactly, schemas are valid, write tools are marked `optional: true`. This catches manifest drift at CI.
- **Unit tests** (`test/unit/**`) — error-code mapping, caching, tool branches. Use `mockHttp` from `test/harness.ts` to stub `node:https`. No network required.
- **Live smoke tests** (`test/smoke/**`) — opt-in. Set `LEADBAY_TEST_TOKEN` (and optionally `LEADBAY_TEST_BASE_URL`) and run:
  ```bash
  LEADBAY_TEST_TOKEN=u.xxx npm run test:smoke
  ```
  Without the env var, these tests cleanly skip. Use a **dedicated test tenant** with a **read-only token** — smoke only hits read endpoints (`/users/me`, `/lenses`, taste profile).

### CI recommendation

- Run `npm test` on every PR — no secrets needed.
- Run `npm run test:smoke` on main merges or nightly, with the `LEADBAY_TEST_TOKEN` secret.

## Publishing

Publication-ready checks:

```bash
npm run build            # emits dist/
npm test                 # contract + unit must be green
npm publish --access public --dry-run   # validate npm package
```

### ClawHub (primary)

```bash
clawhub package publish leadbay/leadclaw --dry-run
clawhub package publish leadbay/leadclaw
```

### npm (fallback)

```bash
npm publish --access public
```

The `prepublishOnly` script wires both `build` and `test` into every publish, so a broken diff never ships.
