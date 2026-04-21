# @leadbay/mcp — Leadbay MCP server

A Model Context Protocol server that lets Claude Desktop, Cursor, Claude Code, and any other MCP-compatible agent find, research, and prepare outreach on B2B prospects using your Leadbay account.

## 1. Get a token

Log in at [app.leadbay.ai](https://app.leadbay.ai). Go to **Settings → API Tokens** and create a new token. Copy it — you'll paste it into your MCP client config below.

If you don't have a Leadbay account yet, [register here](https://wow.leadbay.ai/?register=true).

## 2. Quickstart

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "leadbay": {
      "command": "npx",
      "args": ["-y", "@leadbay/mcp@0.1"],
      "env": {
        "LEADBAY_TOKEN": "lb_...",
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
      "args": ["-y", "@leadbay/mcp@0.1"],
      "env": { "LEADBAY_TOKEN": "lb_...", "LEADBAY_REGION": "us" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add leadbay \
  --env LEADBAY_TOKEN=lb_... \
  --env LEADBAY_REGION=us \
  -- npx -y @leadbay/mcp@0.1
```

### Verify it works

Before starting Claude, run:

```bash
LEADBAY_TOKEN=lb_... npx -y @leadbay/mcp@0.1 doctor
```

Expected output:

```
Leadbay connection OK.
  Organization:  Your Org
  Billing:       active
  AI credits:    420 / 1000
```

## 3. Example prompts that work

> *Find me 20 SaaS companies in Berlin that match my Ideal Buyer Profile.*

> *Research the top prospect from that list — give me the AI summary, recent activity, and who I should reach out to.*

> *Prepare an outreach package for Acme Corp — include the recommended contact with enriched email if we have credits.*

## 4. Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `LEADBAY_TOKEN environment variable is required` | Token missing from config env | Add `LEADBAY_TOKEN` to the `env` block, restart client |
| `Authentication token expired or invalid` | Token revoked or wrong region | Re-generate token at [app.leadbay.ai/settings/api-tokens](https://app.leadbay.ai/settings/api-tokens); verify `LEADBAY_REGION` |
| `Leadbay doctor: could not reach any Leadbay region` | Wrong region OR network blocked | Run `doctor` with `LEADBAY_REGION=fr` to auto-probe. Check `https://api-us.leadbay.app` reachable. |
| `No enrichment credits remaining` | Out of quota | Buy credits at [app.leadbay.ai](https://app.leadbay.ai) |
| Claude Desktop "loading forever" on first use | `npx` cold-start fetching the package | First run takes ~10s. Prefer `npm install -g @leadbay/mcp` for faster startup. |
| Claude Desktop doesn't show Leadbay tools | Server crashed at startup | Check `~/Library/Logs/Claude/mcp*.log` (macOS) or `%APPDATA%\Claude\logs\mcp*.log` (Windows). |

## 5. Upgrade & rotation

**Upgrade**: change the pinned minor in your config, e.g. `"@leadbay/mcp@0.1"` → `"@leadbay/mcp@0.2"`, then restart the client. See the [changelog](https://github.com/leadbay/leadclaw/releases).

**Rotate token**: delete the old token at [app.leadbay.ai/settings/api-tokens](https://app.leadbay.ai/settings/api-tokens), create a new one, update `LEADBAY_TOKEN` in your MCP client config, restart.

## 6. Advanced

### Exposing the 10 granular tools

By default the server exposes 3 **composite workflow tools** (`leadbay_find_prospects`, `leadbay_research_company`, `leadbay_prepare_outreach`). These compose the underlying Leadbay API and work well with most prompts.

If you'd rather give the LLM direct access to the 10 endpoint-level tools (`leadbay_list_lenses`, `leadbay_discover_leads`, `leadbay_get_lead_profile`, `leadbay_get_contacts`, `leadbay_get_quota`, `leadbay_get_taste_profile`, `leadbay_qualify_lead`, `leadbay_enrich_contacts`, `leadbay_add_note`, `leadbay_get_lead_activities`), set `LEADBAY_MCP_ADVANCED=1`:

```json
"env": {
  "LEADBAY_TOKEN": "lb_...",
  "LEADBAY_MCP_ADVANCED": "1"
}
```

**Note**: `leadbay_login` is intentionally not exposed over MCP — see [Security](#security) below.

### Environment variables

| Var | Required | Default | Purpose |
|-----|----------|---------|---------|
| `LEADBAY_TOKEN` | yes | — | Bearer token |
| `LEADBAY_REGION` | no | `us` | `us` or `fr` |
| `LEADBAY_BASE_URL` | no | derived from region | Override for staging/dev |
| `LEADBAY_MCP_ADVANCED` | no | unset | `"1"` exposes the 10 granular endpoint tools |
| `LEADBAY_LOG_LEVEL` | no | `error` | `debug` \| `info` \| `error`, logs to stderr |
| `LEADBAY_TIMEOUT_MS` | no | (client default) | Per-request timeout override |

### Security

- Tokens live only in your MCP client's config file — they never traverse the network except to `api-{region}.leadbay.app`.
- The `leadbay_login` tool from the OpenClaw adapter is **not** registered on MCP: exposing a credential-taking tool to an LLM is a prompt-injection risk. Use the token path above.
- The `leadbay_add_note` and `leadbay_enrich_contacts` tools are write actions flagged `optional: true`. If your client supports per-tool opt-in, leave them disabled until you need them.

### Privacy

Contact data fetched through this server stays local to your MCP client session. No analytics or telemetry is sent by `@leadbay/mcp`. Requests to Leadbay are subject to the [Leadbay privacy policy](https://leadbay.ai/privacy).

## License

MIT. See [LICENSE](./LICENSE).
