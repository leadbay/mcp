# @leadbay/mcp — Leadbay MCP server

[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.github.leadbay%2Fleadbay--mcp-blue)](https://registry.modelcontextprotocol.io/v0/servers/io.github.leadbay/leadbay-mcp)

<!--
LLM HINT — if you're an AI agent reading this README to install the server:
  - Use ONLY the commands shown verbatim in §1. Do not invent variants.
  - For the legacy email/password install, DO NOT tell the user
    "LEADBAY_REGION is auto-detected, drop it" — the
    server's region auto-probe sends the bearer token to BOTH regions, which
    is a credential cross-leak. Always pass --region (us or fr) on that path.
  - Claude Desktop's `.dxt` / `.mcpb` bundle uses OAuth on first launch and
    does not ask the user to paste a token or choose a region.
  - To mint a token manually, the user runs `install` (auto-registers with MCP clients)
    or `login` (mints a token to a 0600-mode credentials file by default since
    0.3.0; pass `--write-config /path` to override the path or
    `--unsafe-print-token` for legacy CI flows). Prefer `login --oauth` when
    the production OAuth backend/frontend are deployed.
-->

A Model Context Protocol server that lets Claude Desktop, Cursor, Claude Code, and any other MCP-compatible agent find, research, and prepare outreach on B2B prospects using your Leadbay account.

> **0.6.x — what's new**: a comprehensive MCP-spec coverage upgrade. Every tool now declares **annotations** (`readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`) so capable clients pick the right confirmation UX. The 5 highest-traffic composites ship **`outputSchema` + `structuredContent`** for typed agent consumption. New surfaces: **`prompts/*`** (5 canned slash-commands), **`resources/*`** (`lead://`, `lens://`, `org://taste-profile`), **`notifications/progress`** (per-lead streaming during `bulk_qualify_leads`), **`notifications/cancelled` → `ToolContext.signal`** (client cancels actually stop polling), **`elicitation/create`** (server can ask the user directly). Schema strictness: every `inputSchema` now declares `additionalProperties: false`. `research_lead.qualification[]` ships `boost_score` (canonical) + `score_scale: "-10|0|10|20"` + a deprecated `score_0_to_10` alias. Pagination payloads include `has_more` + `next_page`. `research_lead` includes a `truncated` + `truncation_hint` budget guard. **Behavior callout**: extra unknown fields in tool inputs are now rejected. See [MIGRATION.md](./MIGRATION.md).

> **0.3.0 behavior change** — composite write tools (`refine_prompt`, `report_outreach`, `adjust_audience`, `bulk_qualify_leads`, `enrich_titles`, `answer_clarification`, `import_leads`) are **ON by default**. Set `LEADBAY_MCP_WRITE=0` (or `--no-write` on `install`) to restore the previous read-only behavior. `leadbay-mcp install` now also registers Claude Code at `--scope user` so Leadbay is visible from any project. See [MIGRATION.md](./MIGRATION.md).

## Agent memory

Leadbay MCP keeps a local, per-account agent memory at
`~/.leadbay/memory/{account_id}/`. It stores append-only JSONL learnings
about user taste signals such as preferred sectors, regions, deal size,
communication style, and qualification rules.

The memory tools are always exposed:

- `leadbay_agent_memory_recall` reads the consolidated top signals.
- `leadbay_agent_memory_capture` appends a new learning after the user reveals
  a material preference.
- `leadbay_agent_memory_review` lists entries and gates retractions or org
  promotion through user confirmation.

The main leads-touching tools (`leadbay_account_status`,
`leadbay_pull_leads`, `leadbay_pull_followups`,
`leadbay_prepare_outreach`, `leadbay_research_lead_by_id`) also attach
`_meta.agent_memory.summary` automatically. Set `LEADBAY_AGENT_MEMORY=off`
to suppress this ambient metadata.

## 1. Install

For Linux, use the command-based installer; no desktop package is published:

```bash
npx -y @leadbay/mcp@latest installer
```

It downloads the npm package, opens the installer app, asks for email/region/password, detects installed MCP clients, then installs the selected ones. macOS and Windows releases also publish double-clickable desktop installers.

From a repo checkout, run the same native installer with:

```bash
pnpm --filter @leadbay/mcp installer:gui
```

For terminal-only installs (works on macOS, Windows, and Linux):

```bash
npx -y @leadbay/mcp@latest install --email you@yourcompany.com --region us
# (you'll be prompted for your password — it's not echoed)
```

To uninstall (GUI wizard, Linux only for now):

```bash
npx -y @leadbay/mcp@latest installer --uninstall
```

Only shows clients that already have Leadbay MCP configured. On macOS / Windows, use the desktop installer app or remove entries manually until the GUI uninstaller is ported.

These commands:

1. Ask for your password (hidden input).
2. Mint a bearer token via the Leadbay backend you specified.
3. Auto-detect which MCP clients you have installed (Claude Code, Claude Desktop, Cursor, Codex) and register the server in each (after asking you per-target). Claude Code is registered with `--scope user` so the server appears in any project, not just where you ran the command.
4. Write the token into the client config files — **never to your terminal scrollback**.

Add `--no-write` to disable the composite write tools (`refine_prompt`, `report_outreach`, `adjust_audience`, etc. — ON by default since 0.3.0; pass `--no-write` for a read-only agent). Add `--yes` for non-interactive runs (CI / scripts). Add `--target claude-code,cursor` to scope to specific clients. The legacy `--include-write` flag is accepted but is now a no-op.

`--region us|fr` is required by default — it pins which Leadbay backend gets your password and avoids a silent cross-region credential leak. If you really don't know your region, opt in with `--allow-region-fallback` (your password will hit BOTH backends if the first 401s).

The token is **session-scoped** (full account access, password-equivalent). Treat it like your password. To rotate, re-run `npx -y @leadbay/mcp install` — minting a fresh token invalidates the prior session.

**Don't have a Leadbay account?** [Register here](https://wow.leadbay.ai/?register=true).

### Install via the Claude Code plugin marketplace

```text
/plugin marketplace add leadbay/leadclaw
/plugin install leadbay@leadbay-leadclaw
```

Claude Code prompts for your token and region through the plugin's `userConfig`. This is equivalent to the npm/CLI install above; users who already ran `leadbay-mcp login` can reuse that token.

The plugin install gives you **two surfaces in one shot**:

1. **The MCP server** — registered via the plugin's `mcpServers.leadbay` block (boots `@leadbay/mcp` over stdio). This exposes the `leadbay_*` tools to the agent.
2. **Six auto-discovered Claude Code skills** under `skills/` — `leadbay_daily_check_in`, `leadbay_research_a_domain`, `leadbay_import_file`, `leadbay_log_outreach`, `leadbay_qualify_top_n`, `leadbay_refine_audience`. These auto-trigger on natural-language matches against each skill's description ("get me leadbay leads today", "research acme.com", etc.) and dispatch to the MCP tools above by name. Each `SKILL.md` is generated by `@leadbay/promptforge` from the same `.md.tmpl` source as the MCP prompt, so the two surfaces never drift.

You can verify the skills installed by running `/skill list` after install. To uninstall everything, `/plugin uninstall leadbay@leadbay-leadclaw` removes the MCP server registration **and** the skills together.

### Claude Desktop 2026 (DXT)

Claude Desktop 2026 ships the DXT (Desktop Extension) system — the legacy `claude_desktop_config.json` is UI-prefs-only there and gets overwritten by the app. If you're on 2026, **install the `.dxt` / `.mcpb` bundle** from [Releases](https://github.com/leadbay/leadclaw/releases/latest) (drag-drop into Settings → Extensions). On first launch, the extension opens Leadbay in your browser for OAuth consent, auto-detects your region through stargate, then persists the resulting token locally. The extension settings only ask whether write tools should be enabled.

`leadbay-mcp install` detects Claude Desktop 2026 and skips the legacy config write automatically.

### `npm install -g` says "EACCES" / "permission denied"

If you installed Node from the official [nodejs.org](https://nodejs.org) `.pkg`, `/usr/local/lib/node_modules` is root-owned. Any of these works:

- **Use `npx` (recommended, no global install):** all examples above use `npx -y @leadbay/mcp@0.16 ...` — no global install needed.
- **`sudo npm install -g @leadbay/mcp`** (enter your macOS password).
- **Use a Node version manager** — [nvm](https://github.com/nvm-sh/nvm), [volta](https://volta.sh), [fnm](https://github.com/Schniz/fnm). They install Node under your home directory, so `npm install -g` works without sudo.

### If you'd rather mint a token without auto-install

```bash
npx -y @leadbay/mcp@0.16 login \
  --email you@yourcompany.com \
  --region us
```

Default writes a `0600`-mode JSON file at the platform-correct credentials path (`$XDG_CONFIG_HOME/leadbay/credentials.json` on Linux, `~/Library/Application Support/leadbay/credentials.json` on macOS, `%APPDATA%\leadbay\credentials.json` on Windows). Pass `--write-config /some/path.json` to override the path. Pass `--unsafe-print-token` for legacy CI flows that scrape stdout (the token will end up in scrollback / logs — only use this if you have to). Pass `--force` to overwrite an existing file from a different account.

## 2. Updating the hosted MCP

The hosted MCP at `https://leadbay-mcp-prod.fly.dev/mcp` can be updated in two ways.

### Deploy from this repo

Use this when you want Fly to run the exact code in the current checkout or after merging to `main`:

```bash
fly deploy --app leadbay-mcp-prod
curl https://leadbay-mcp-prod.fly.dev/healthz
```

This is the current production path. Fly builds the repo `Dockerfile`, bundles `packages/mcp`, and starts `node dist/http-server.js`.

### Deploy from a published npm package

Use this when you want the remote MCP to run a package that has already been published to npm. Prefer pinning an exact version so production deploys are reproducible:

```dockerfile
FROM node:22-slim

WORKDIR /app
RUN npm install -g @leadbay/mcp@0.15.0

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["leadbay-mcp-http"]
```

Then point Fly at that Dockerfile and deploy:

```toml
[build]
  dockerfile = 'Dockerfile.npm'
```

```bash
fly deploy --app leadbay-mcp-prod
curl https://leadbay-mcp-prod.fly.dev/healthz
```

Avoid `@latest` for production unless you intentionally want Fly deploys to pick up whatever version npm currently marks as latest:

```dockerfile
RUN npm install -g @leadbay/mcp@latest
```

That is convenient for quick tests, but less safe for production because the deployed version is no longer visible from a repo diff.

## 3. Quickstart

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "leadbay": {
      "command": "npx",
      "args": ["-y", "@leadbay/mcp@0.16"],
      "env": {
        "LEADBAY_TOKEN": "<paste-token-from-step-1>",
        "LEADBAY_REGION": "us"
      }
    }
  }
}
```

Restart Claude Desktop.

### Cursor

In Cursor settings, add the MCP server:

```json
{
  "mcp.servers": {
    "leadbay": {
      "command": "npx",
      "args": ["-y", "@leadbay/mcp@0.16"],
      "env": { "LEADBAY_TOKEN": "<paste-token>", "LEADBAY_REGION": "us" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add leadbay --scope user \
  --env LEADBAY_TOKEN=<paste-token> \
  --env LEADBAY_REGION=us \
  -- npx -y @leadbay/mcp@0.16
```

> **`--scope user`** registers Leadbay globally for your account (visible from any project). Without it, `claude mcp add` defaults to project-local scope and the server only appears in conversations opened from the directory where you ran the command.

> To **disable** the composite write tools (refine_prompt, report_outreach, adjust_audience, etc.), add `--env LEADBAY_MCP_WRITE=0`. They are ON by default since 0.3.0. The legacy `LEADBAY_MCP_WRITE=1` opt-in is now a no-op.

### Verify it works

Before starting Claude, run:

```bash
LEADBAY_TOKEN=<paste-token> npx -y @leadbay/mcp@0.16 doctor
```

Expected output:

```
Leadbay connection OK.
  Organization:  Your Org
  Billing:       active
  AI credits:    420 / 1000
```

## 4. Example prompts that work

> *Find me 20 SaaS companies in Berlin that match my Ideal Buyer Profile.*

> *Research the top prospect from that list — give me the AI summary, recent activity, and who I should reach out to.*

> *Prepare an outreach package for Acme Corp — include the recommended contact with enriched email if we have credits.*

## 3a. Spec primitives in action

> If you're building or auditing an MCP integration, this section shows what each spec primitive looks like on the wire when calling `@leadbay/mcp`. Every example is the actual JSON-RPC frame your client sends or receives — copy verbatim into a debugger.

### `tools/list` — annotations + outputSchema

Every tool advertises read/write/idempotent/openWorld posture and (for the top declarers) a typed return schema.

Request:

```json
{ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }
```

Response (excerpt):

```json
{
  "tools": [
    {
      "name": "leadbay_account_status",
      "description": "Show the user's account state — admin rights, language, last-active lens, current quota …",
      "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
      "annotations": {
        "title": "Show Leadbay account + quota state",
        "readOnlyHint": true, "destructiveHint": false,
        "idempotentHint": true, "openWorldHint": true
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "user": { "type": "object", "properties": { "email": {}, "name": {}, "admin": {}, "manager": {}, "language": {} } },
          "organization": { "type": "object", "properties": { "id": {}, "name": {}, "ai_agent_enabled": {}, "computing_intelligence": {}, "plan": {} } },
          "last_requested_lens": {},
          "quota": {},
          "_meta": { "type": "object", "properties": { "region": {} } }
        },
        "required": ["user", "organization"]
      }
    }
  ]
}
```

Capable clients use the annotations to decide auto-approve vs prompt; the `outputSchema` lets them dispatch on shape rather than re-parse the text.

### `tools/call` with `structuredContent`

When the tool declares `outputSchema`, the response carries a typed `structuredContent` block alongside `text` content:

Request:

```json
{ "jsonrpc": "2.0", "id": 2, "method": "tools/call",
  "params": { "name": "leadbay_account_status", "arguments": {} } }
```

Response:

```json
{
  "content": [
    { "type": "text", "text": "{\"user\":{...},\"organization\":{...}, ...}" }
  ],
  "structuredContent": {
    "user":  { "email": "you@example.com", "name": "You", "admin": true, "manager": false, "language": "en" },
    "organization": { "id": "org-1", "name": "Your Co", "ai_agent_enabled": true, "computing_intelligence": false, "plan": "PRO" },
    "last_requested_lens": 42,
    "quota": { "plan": "PRO", "windows": [...] },
    "_meta": { "region": "us" }
  }
}
```

### `prompts/list` and `prompts/get` — slash commands

Request:

```json
{ "jsonrpc": "2.0", "id": 3, "method": "prompts/list" }
```

Response (excerpt):

```json
{
  "prompts": [
    { "name": "daily-check-in", "description": "Pull fresh leads, surface auto-qualified top, deepen 1-3 promising ones.", "arguments": [] },
    { "name": "research-a-domain", "description": "Import a domain → resolve to leadId → research_lead.",
      "arguments": [{ "name": "domain", "description": "Company domain (e.g., acme.com)", "required": true }] },
    { "name": "log-outreach", "description": "Gather verification → report_outreach.",
      "arguments": [{ "name": "lead_id", "required": true }, { "name": "what", "required": true }] }
  ]
}
```

Then `prompts/get` materialises the chosen workflow as a structured `messages` array the agent unfurls:

```json
{ "jsonrpc": "2.0", "id": 4, "method": "prompts/get",
  "params": { "name": "research-a-domain", "arguments": { "domain": "acme.com" } } }
```

**Clients without a `prompts/list` UI** (Cowork is the prototypical case): the catalog still reaches the agent. The server's `initialize` response includes a `serverInfo.instructions` string that names every prompt, its trigger phrasing, and its required arguments — so the agent can match the user's natural-language ask and invoke `prompts/get` directly without the user clicking through a slash menu. No client action is needed beyond the standard MCP `initialize` handshake.

### `resources/list` and `resources/read` — URI-addressable read-only data

Three URI schemes are advertised: `lead://{uuid}/profile`, `lens://{id}/definition`, `org://taste-profile`. Capable clients cache them across turns.

Request:

```json
{ "jsonrpc": "2.0", "id": 5, "method": "resources/templates/list" }
```

Response (excerpt):

```json
{
  "resourceTemplates": [
    { "uriTemplate": "lead://{uuid}/profile", "name": "Lead profile", "description": "Lead profile by Leadbay UUID — basics + qualifications + contacts.", "mimeType": "application/json" },
    { "uriTemplate": "lens://{id}/definition", "name": "Lens definition", "description": "Filter + scoring config for a lens.", "mimeType": "application/json" }
  ]
}
```

Read a specific lead:

```json
{ "jsonrpc": "2.0", "id": 6, "method": "resources/read",
  "params": { "uri": "lead://0xabcd-…/profile" } }
```

Response wraps the JSON in a `text` content block with the URI's mime type so clients can render or cache it.

### `notifications/progress` — streaming during long ops

When the agent calls a long-running tool with a `progressToken` in `_meta`, the server streams progress notifications back. Long-runners that emit: `bulk_qualify_leads`, `import_and_qualify`, `enrich_titles`, `bulk_enrich_status`, `qualify_status`.

Request:

```json
{ "jsonrpc": "2.0", "id": 7, "method": "tools/call",
  "params": {
    "name": "leadbay_bulk_qualify_leads",
    "arguments": { "leadIds": ["lead-1", "lead-2", "lead-3"] },
    "_meta": { "progressToken": "bq-1" }
  } }
```

While the call runs, notifications arrive:

```json
{ "jsonrpc": "2.0", "method": "notifications/progress",
  "params": { "progressToken": "bq-1", "progress": 1, "total": 3, "message": "Qualified Acme Corp (1/3)" } }
{ "jsonrpc": "2.0", "method": "notifications/progress",
  "params": { "progressToken": "bq-1", "progress": 2, "total": 3, "message": "Qualified Globex (2/3)" } }
{ "jsonrpc": "2.0", "method": "notifications/progress",
  "params": { "progressToken": "bq-1", "progress": 3, "total": 3, "message": "Qualified Initech (3/3)" } }
```

Then the final `tools/call` response.

### `notifications/cancelled` — actually cancelling

Send the cancellation by id; the server's `ToolContext.signal` aborts the polling loop within ≤2 seconds, the bulk-store entry is marked `cancelled`, and the next `bulk_enrich_status` returns `BULK_CANCELLED` so the agent stops polling.

```json
{ "jsonrpc": "2.0", "method": "notifications/cancelled",
  "params": { "requestId": 7, "reason": "user clicked cancel" } }
```

### `elicitation/create` — server asks the user

Used by `refine_prompt` (clarification flow) and `report_outreach` (anti-poisoning user-confirmation). The server sends an `elicitation/create` request to the client; the client renders a form; the user types; the response feeds back into the tool call. The agent never sees the prompt.

Server emits (mid-`tools/call`):

```json
{ "jsonrpc": "2.0", "id": 99, "method": "elicitation/create",
  "params": {
    "message": "An AI agent wants to log outreach on lead-1: 'Called Acme'. The agent claims you confirmed this. Type your literal confirmation to proceed; cancel to reject.",
    "requestedSchema": {
      "type": "object",
      "properties": { "confirmation": { "type": "string", "title": "Your confirmation" } },
      "required": ["confirmation"]
    }
  } }
```

Client returns:

```json
{ "jsonrpc": "2.0", "id": 99, "result": { "action": "accept", "content": { "confirmation": "yes I called Acme today" } } }
```

The user's literal text replaces `verification.ref` in the outreach record, and the response carries `confirmed_via: "elicit"` for the SDR audit trail.

## 5. Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `LEADBAY_TOKEN environment variable is required` | Token missing from config env | Add `LEADBAY_TOKEN` to the `env` block, restart client |
| `Authentication token expired or invalid` | Token revoked or wrong region | Re-mint a token: `npx -y @leadbay/mcp install --email <you> --region <us\|fr>`; verify `LEADBAY_REGION` |
| `Leadbay doctor: could not reach any Leadbay region` | Wrong region OR network blocked | Run `doctor` with `LEADBAY_REGION=fr` to auto-probe. Check `https://api-us.leadbay.app` reachable. |
| `No enrichment credits remaining` | Out of quota | Contact Leadbay support to extend quota |
| Claude Desktop "loading forever" on first use | `npx` cold-start fetching the package | First run takes ~10s. Prefer `npm install -g @leadbay/mcp` for faster startup. |
| Claude Desktop doesn't show Leadbay tools | Server crashed at startup | Check `~/Library/Logs/Claude/mcp*.log` (macOS) or `%APPDATA%\Claude\logs\mcp*.log` (Windows). |
| Claude Code can't find Leadbay in a new conversation | MCP server installed at project scope (default before 0.3.0) | Re-run with `--scope user`: `claude mcp remove leadbay && claude mcp add leadbay --scope user --env LEADBAY_TOKEN=… --env LEADBAY_REGION=us -- npx -y @leadbay/mcp@0.16` |
| Agent reports "tool not found" for `refine_prompt` / `adjust_audience` etc. | Pre-0.3.0 install with `LEADBAY_MCP_WRITE` unset (writes were off) | Either re-run `npx @leadbay/mcp install` or remove `LEADBAY_MCP_WRITE=0` from your client config (writes are on by default in 0.3.0+) |

## 6. Upgrade & rotation

**Upgrade**: change the pinned minor in your config, e.g. `"@leadbay/mcp@0.2"` → `"@leadbay/mcp@0.16"`, then restart the client. **0.3.0 enables composite write tools by default** — see [MIGRATION.md](./MIGRATION.md). See also the [changelog](https://github.com/leadbay/leadclaw/releases).

**Rotate token**: re-run `npx -y @leadbay/mcp@0.16 install --email you@yourcompany.com --region us` (or `login`) — the new session token replaces the old one in your MCP client config, and logging in again invalidates the prior session on most session backends.

## 7. Advanced

### OAuth login (preview)

Browser-based login is available as an alternative to email/password:

```bash
npx -y @leadbay/mcp login --oauth
```

The CLI:

1. Probes `stargate.leadbay.app/1.0/user_info` to auto-detect your region
   from GeoIP (override with `--region us|fr` if you're behind a VPN or
   travelling outside your home region).
2. Opens your browser to `leadbay.app/oauth/authorize`.
3. After you click **Allow**, redirects to a one-shot loopback URL on
   `http://127.0.0.1:<random-port>/callback`.
4. Exchanges the authorization code for a token using PKCE (S256), then writes
   the same credentials file that the email/password flow produces.

The CLI registers a fresh OAuth client per machine (RFC 7591 Dynamic Client
Registration), so no shared secret lives in the binary. The resulting token is
long-lived and interchangeable with the legacy bearer token. Manual MCP config
can still pass it as `LEADBAY_TOKEN`; the Claude Desktop bundle performs the
OAuth flow itself and persists the token without asking you to paste it.

For testing against staging before the production backend deploy lands:

```bash
npx -y @leadbay/mcp login --oauth --staging
```

`--staging` switches the backend (`staging.api.leadbay.app` /
`api-{us,fr}-staging.leadbay.app`), the consent UI (`staging.leadbay.app`),
and the stargate region probe (`staging.stargate.leadbay.app`). It also
persists `LEADBAY_BASE_URL` in the credentials file so subsequent runs don't
snap back to prod.

### Exposing the granular tools and disabling write tools

By default the server exposes the **composite workflow tools** — both reads (`leadbay_pull_leads`, `leadbay_research_lead_by_id`, `leadbay_account_status`, `leadbay_recall_ordered_titles`, `leadbay_research_lead_by_name_fuzzy`, `leadbay_prepare_outreach`, `leadbay_qualify_status`, `leadbay_list_mappable_fields`) and writes (`leadbay_bulk_qualify_leads`, `leadbay_enrich_titles`, `leadbay_refine_prompt`, `leadbay_report_outreach`, `leadbay_adjust_audience`, `leadbay_answer_clarification`, `leadbay_import_leads`, `leadbay_import_and_qualify`). These work well with most prompts.

To **disable the write tools** (run a strictly read-only agent), set `LEADBAY_MCP_WRITE=0`. The server's system prompt will adapt to omit references to those tools.

To unlock the **granular API tools** (`leadbay_list_lenses`, `leadbay_discover_leads`, `leadbay_get_lead_profile`, `leadbay_get_contacts`, `leadbay_get_quota`, `leadbay_get_taste_profile`, `leadbay_get_lens_filter`, `leadbay_list_sectors`, …), set `LEADBAY_MCP_ADVANCED=1`.

```json
"env": {
  "LEADBAY_TOKEN": "<token>",
  "LEADBAY_MCP_ADVANCED": "1",
  "LEADBAY_MCP_WRITE": "0"
}
```

`leadbay_report_outreach` requires a `verification` field on every call (Gmail message id, Calendar event id, or `user_confirmed` with the user's literal text) so the agent can't poison your SDR pipeline with hallucinated outreach.

**Note**: `leadbay_login` is intentionally not exposed over MCP — see [Security](#security) below.

### Importing domains from external systems → leadIds

`leadbay_import_leads` is a **write tool** (exposed by default since 0.3.0; set `LEADBAY_MCP_WRITE=0` to hide it) for the case where you have a list of company domains from another system (CRM, analytics, email correspondents, etc.) and want stable Leadbay `leadId`s to chain into qualification:

```bash
# 1. Set up
export LEADBAY_TOKEN="<your-token>"
export LEADBAY_REGION="us"
# LEADBAY_MCP_WRITE defaults to "1" (ON) since 0.3.0 — no need to set it.

# 2. Wire in your MCP client per §2 above. Then ask the agent:
#    "Import these domains: apple.com, microsoft.com, salesforce.com.
#     Then qualify the matched leads."
#
#    The agent calls leadbay_import_leads({ domains: [...] }), gets back
#    { leads: [{domain, leadId, name}], not_imported: [{domain, reason}], importIds, _meta },
#    then chains leads.map(l => l.leadId) into leadbay_bulk_qualify_leads.
```

**⚠️ Writes user state.** Internally wraps Leadbay's CRM-import wizard (the only domain-import primitive the backend ships today). Each call:

- creates a row in your CRM-imports list (visible in the web UI)
- touches onboarding state (`startFileless`, onboarding step → `PROCESSING`)

Suitable for **occasional automation**. **Not** suitable for high-cadence (>5 calls/day) — the right primitive is a clean async-import-with-crawl backend endpoint, tracked as a follow-up in `leadbay/backend`.

**Limitation:** the wedge maps domains to leads the crawler already knows. Uncrawled domains land in `not_imported` with `reason: "uncrawled"` — the tool does **not** create new leads for unknown websites; the caller decides what to do (skip, queue for the backend follow-up, etc.).

### Importing + qualifying in one verb (0.5.0)

`leadbay_import_and_qualify` collapses import → AI qualification into a single composite call. Returns per-lead qualification answers + ai_agent_lead_score inline when budget allows; otherwise returns a `qualify_id` UUID handle the agent can pass to `leadbay_qualify_status` later (handle persists 30 days, survives MCP restart). See [MIGRATION.md](./MIGRATION.md#migration-leadbay-mcp-04x--050) for the full worked example (discover → preview → import → qualify_status), JSON shapes, error-code reference, per-tool prereqs, and `not_in_lens` partition semantics.

Companion tool: `leadbay_list_mappable_fields` returns the union of standard CRM fields and this org's custom fields (with `mapping_value` ready for `mappings.fields` paste-in). Optional `for_records` param runs the wizard's preprocess on a sample to attach mapping hints + custom-field name-match candidates in a single call.



**Requires:** `LEADBAY_MCP_WRITE` not set to `0` (it's ON by default since 0.3.0; or `exposeWrite: true` in OpenClaw); admin role on your Leadbay account; active billing.

Use `dry_run: true` to validate domain formatting and wizard reachability without committing the lead-CRM linking. (The CRM-imports row still appears — only a backend change can remove that.)

### Environment variables

| Var | Required | Default | Purpose |
|-----|----------|---------|---------|
| `LEADBAY_TOKEN` | **yes** | — | Bearer token (mint via `install` or `login`, or set manually) |
| `LEADBAY_REGION` | **strongly recommended** | (auto-probe — see warning below) | `us` or `fr` |
| `LEADBAY_BASE_URL` | no | derived from region | Override for staging/dev |
| `LEADBAY_MCP_ADVANCED` | no | unset | `"1"` exposes the granular API tools |
| `LEADBAY_MCP_WRITE` | no | `"1"` (ON) | Default ON since 0.3.0. Set to `"0"` / `"false"` / `"no"` / `"off"` to hide the composite write tools (refine_prompt, report_outreach, adjust_audience, etc.) and the system prompt that mentions them. Note: 0.2.x treated `"true"` / `"yes"` / `"on"` as OFF; 0.3.0+ treats them as ON. |
| `LEADBAY_MOCK` | no | unset | `"1"` serves all reads from on-disk fixtures (dev only) |
| `LEADBAY_MOCK_DIR` | no | `./.context/leadbay-live-shapes/` | Fixture dir for mock mode |
| `LEADBAY_LOG_LEVEL` | no | `error` | `debug` \| `info` \| `error`, logs to stderr |

> ⚠️ **Set `LEADBAY_REGION` explicitly.** If you don't, the server probes BOTH `api-us.leadbay.app` and `api-fr.leadbay.app` in parallel with your bearer token attached, sending the token to a backend that doesn't own your account. The `install` and `login` subcommands enforce `--region` for exactly this reason; the runtime auto-probe is a backwards-compat fallback, not a recommended setting.
| `LEADBAY_TIMEOUT_MS` | no | (client default) | Per-request timeout override |

### Security

- Tokens live only in your MCP client's config file — they never traverse the network except to `api-{region}.leadbay.app`.
- The `leadbay_login` tool from the OpenClaw adapter is **not** registered on MCP: exposing a credential-taking tool to an LLM is a prompt-injection risk. Use the token path above.
- The `leadbay_add_note` and `leadbay_enrich_contacts` tools are write actions flagged `optional: true`. If your client supports per-tool opt-in, leave them disabled until you need them.

### Privacy & telemetry

`@leadbay/mcp` sends product usage events to PostHog and reports unexpected errors to Sentry — same posture as the Leadbay web app. PostHog measures product usage (which tools fire, durations, error rates); Sentry catches crashes we'd otherwise never see.

**These events are NOT anonymous.** Each event is tied to your Leadbay account email (`distinctId = me.email`) so your MCP activity consolidates with your web-app activity under the same identity in our analytics — that's the same identity model the web app already uses. If you'd rather not have your MCP usage attributed to you, opt out (see below).

**What we send to PostHog** (per tool call):

| Event | When | Properties |
|---|---|---|
| `mcp tool called` | Every tool invocation | `tool`, `ok`, `duration_ms`, `format`, `bytes`, `error_code` (if failed) |
| `mcp quota hit` | When the API returns `QUOTA_EXCEEDED` (HTTP 429/402) | `tool`, `retry_after_s`, `endpoint` |
| `mcp topup link created` | When `leadbay_create_topup_link` returns a checkout URL | `tool` (the URL itself is **never** captured) |

After your first authenticated call, your PostHog `distinctId` is set to your Leadbay account email so MCP events consolidate with web-app events for the same person. Events also carry `$groups.organization` so org-level rollups work.

**What we never send**: tool argument bodies, response bodies, lead emails / phones, Stripe URLs, lens descriptions, qualification answers.

**Errors to Sentry**: only unexpected throws (TypeError, network failures, parse bugs). Expected business outcomes — quota walls, missing resources, auth expiry, billing suspension — stay in PostHog only.

**Opt out** — `leadbay-mcp install` writes `LEADBAY_TELEMETRY_ENABLED=true` into your MCP client's env block by default. Most clients (Claude Desktop, Cursor) render env-var booleans as a toggle in their settings UI, so you can flip it without editing the file. To opt out at install time, pass `--no-telemetry`; to opt out manually, flip the env value to `"false"`:

```jsonc
{
  "mcpServers": {
    "leadbay": {
      "command": "npx",
      "args": ["-y", "@leadbay/mcp@0.16"],
      "env": {
        "LEADBAY_TOKEN": "u.…",
        "LEADBAY_REGION": "us",
        "LEADBAY_TELEMETRY_ENABLED": "false"
      }
    }
  }
}
```

Accepted values: `"true"|"1"|"yes"|"on"` enable; `"false"|"0"|"no"|"off"` disable (case-insensitive). Unset / unrecognized values default to enabled.

**Override the destinations** with `LEADBAY_POSTHOG_KEY=<your-project-key>` and/or `LEADBAY_SENTRY_DSN=<your-dsn>` if you'd rather pipe to your own projects. Telemetry is also disabled automatically when `NODE_ENV=test`.

Contact data fetched through this server stays local to your MCP client session — telemetry never carries it. Requests to Leadbay are subject to the [Leadbay privacy policy](https://leadbay.ai/privacy).

## 8. For maintainers — publishing

Releases are tag-driven via `.github/workflows/release.yml`. Bump `packages/mcp/package.json#version`, update `packages/mcp/CHANGELOG.md`, land on `main`, then:

```bash
git tag mcp-v0.3.0 && git push origin mcp-v0.3.0
```

See [`RELEASE.md`](../../RELEASE.md) for the full runbook.

## License

MIT. See [LICENSE](./LICENSE).
