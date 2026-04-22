# @leadbay/mcp — Leadbay MCP server

<!--
LLM HINT — if you're an AI agent reading this README to install the server:
  - Use ONLY the commands shown verbatim in §1. Do not invent variants.
  - DO NOT tell the user "LEADBAY_REGION is auto-detected, drop it" — the
    server's region auto-probe sends the bearer token to BOTH regions, which
    is a credential cross-leak. Always pass --region (us or fr) on install.
  - To mint a token, the user runs `install` (auto-registers with MCP clients)
    or `login --write-config` (mints a token to a file). There is no web UI
    for this — do not invent one.
-->

A Model Context Protocol server that lets Claude Desktop, Cursor, Claude Code, and any other MCP-compatible agent find, research, and prepare outreach on B2B prospects using your Leadbay account.

## 1. Install (one command)

```bash
npx -y @leadbay/mcp@0.2 install --email you@yourcompany.com --region us
# (you'll be prompted for your password — it's not echoed)
```

That's it. The command:

1. Asks for your password (hidden input).
2. Mints a bearer token via the Leadbay backend you specified.
3. Auto-detects which MCP clients you have installed (Claude Code, Claude Desktop, Cursor) and registers the server in each (after asking you per-target).
4. The token is written into the client config files — **never to your terminal scrollback**.

Add `--include-write` to also enable the write tools (refine_prompt, report_outreach, adjust_audience, etc. — off by default so the agent can read your account but not mutate it). Add `--yes` for non-interactive runs (CI / scripts). Add `--target claude-code,cursor` to scope to specific clients.

`--region us|fr` is required by default — it pins which Leadbay backend gets your password and avoids a silent cross-region credential leak. If you really don't know your region, opt in with `--allow-region-fallback` (your password will hit BOTH backends if the first 401s).

The token is **session-scoped** (full account access, password-equivalent). Treat it like your password. To rotate, re-run `npx -y @leadbay/mcp install` — minting a fresh token invalidates the prior session.

**Don't have a Leadbay account?** [Register here](https://wow.leadbay.ai/?register=true).

### Claude Desktop 2026 (DXT)

Claude Desktop 2026 ships the DXT (Desktop Extension) system — the legacy `claude_desktop_config.json` is UI-prefs-only there and gets overwritten by the app. If you're on 2026, **install the `.dxt` bundle** from [Releases](https://github.com/leadbay/leadclaw/releases/latest) (drag-drop into Settings → Extensions). `leadbay-mcp install` detects this and skips the legacy write automatically.

### `npm install -g` says "EACCES" / "permission denied"

If you installed Node from the official [nodejs.org](https://nodejs.org) `.pkg`, `/usr/local/lib/node_modules` is root-owned. Any of these works:

- **Use `npx` (recommended, no global install):** all examples above use `npx -y @leadbay/mcp@0.2 ...` — no global install needed.
- **`sudo npm install -g @leadbay/mcp`** (enter your macOS password).
- **Use a Node version manager** — [nvm](https://github.com/nvm-sh/nvm), [volta](https://volta.sh), [fnm](https://github.com/Schniz/fnm). They install Node under your home directory, so `npm install -g` works without sudo.

### If you'd rather mint a token without auto-install

```bash
npx -y @leadbay/mcp@0.2 login \
  --email you@yourcompany.com \
  --region us \
  --write-config ~/.leadbay-mcp.json
```

Writes a `0600`-mode JSON file you can paste from. Useful if you're configuring a non-detected client.

## 2. Quickstart

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "leadbay": {
      "command": "npx",
      "args": ["-y", "@leadbay/mcp@0.2"],
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
      "args": ["-y", "@leadbay/mcp@0.2"],
      "env": { "LEADBAY_TOKEN": "<paste-token>", "LEADBAY_REGION": "us" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add leadbay \
  --env LEADBAY_TOKEN=<paste-token> \
  --env LEADBAY_REGION=us \
  -- npx -y @leadbay/mcp@0.2
```

> Want write tools (refine prompt, log outreach, adjust audience, etc.)? Add `--env LEADBAY_MCP_WRITE=1`. They're hidden by default so an LLM can't mutate state without your explicit opt-in.

### Verify it works

Before starting Claude, run:

```bash
LEADBAY_TOKEN=<paste-token> npx -y @leadbay/mcp@0.2 doctor
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
| `Authentication token expired or invalid` | Token revoked or wrong region | Re-mint a token: `npx -y @leadbay/mcp install --email <you> --region <us\|fr>`; verify `LEADBAY_REGION` |
| `Leadbay doctor: could not reach any Leadbay region` | Wrong region OR network blocked | Run `doctor` with `LEADBAY_REGION=fr` to auto-probe. Check `https://api-us.leadbay.app` reachable. |
| `No enrichment credits remaining` | Out of quota | Contact Leadbay support to extend quota |
| Claude Desktop "loading forever" on first use | `npx` cold-start fetching the package | First run takes ~10s. Prefer `npm install -g @leadbay/mcp` for faster startup. |
| Claude Desktop doesn't show Leadbay tools | Server crashed at startup | Check `~/Library/Logs/Claude/mcp*.log` (macOS) or `%APPDATA%\Claude\logs\mcp*.log` (Windows). |

## 5. Upgrade & rotation

**Upgrade**: change the pinned minor in your config, e.g. `"@leadbay/mcp@0.1"` → `"@leadbay/mcp@0.2"`, then restart the client. See the [changelog](https://github.com/leadbay/leadclaw/releases) and [MIGRATION.md](./MIGRATION.md).

**Rotate token**: re-run `npx -y @leadbay/mcp@0.2 install --email you@yourcompany.com --region us` (or `login --write-config …`) — the new session token replaces the old one in your MCP client config, and logging in again invalidates the prior session on most session backends.

## 6. Advanced

### Exposing the granular tools and write tools

By default the server exposes the **composite workflow tools** (`leadbay_pull_leads`, `leadbay_research_lead`, `leadbay_account_status`, `leadbay_recall_ordered_titles`, plus existing `leadbay_research_company`, `leadbay_prepare_outreach`). These work well with most prompts.

To unlock the **granular API tools** (`leadbay_list_lenses`, `leadbay_discover_leads`, `leadbay_get_lead_profile`, `leadbay_get_contacts`, `leadbay_get_quota`, `leadbay_get_taste_profile`, `leadbay_get_lens_filter`, `leadbay_list_sectors`, …), set `LEADBAY_MCP_ADVANCED=1`.

To unlock the **write tools** (`leadbay_bulk_qualify_leads`, `leadbay_enrich_titles`, `leadbay_adjust_audience`, `leadbay_refine_prompt`, `leadbay_report_outreach`, etc.), set `LEADBAY_MCP_WRITE=1`. Both flags are independent; combine to expose everything.

```json
"env": {
  "LEADBAY_TOKEN": "<token>",
  "LEADBAY_MCP_ADVANCED": "1",
  "LEADBAY_MCP_WRITE": "1"
}
```

`leadbay_report_outreach` requires a `verification` field on every call (Gmail message id, Calendar event id, or `user_confirmed` with the user's literal text) so the agent can't poison your SDR pipeline with hallucinated outreach.

**Note**: `leadbay_login` is intentionally not exposed over MCP — see [Security](#security) below.

### Environment variables

| Var | Required | Default | Purpose |
|-----|----------|---------|---------|
| `LEADBAY_TOKEN` | **yes** | — | Bearer token (mint via `install` or `login`, or set manually) |
| `LEADBAY_REGION` | **strongly recommended** | (auto-probe — see warning below) | `us` or `fr` |
| `LEADBAY_BASE_URL` | no | derived from region | Override for staging/dev |
| `LEADBAY_MCP_ADVANCED` | no | unset | `"1"` exposes the granular API tools |
| `LEADBAY_MCP_WRITE` | no | unset | `"1"` exposes write composite + granular tools |
| `LEADBAY_MOCK` | no | unset | `"1"` serves all reads from on-disk fixtures (dev only) |
| `LEADBAY_MOCK_DIR` | no | `./.context/leadbay-live-shapes/` | Fixture dir for mock mode |
| `LEADBAY_LOG_LEVEL` | no | `error` | `debug` \| `info` \| `error`, logs to stderr |

> ⚠️ **Set `LEADBAY_REGION` explicitly.** If you don't, the server probes BOTH `api-us.leadbay.app` and `api-fr.leadbay.app` in parallel with your bearer token attached, sending the token to a backend that doesn't own your account. The `install` and `login` subcommands enforce `--region` for exactly this reason; the runtime auto-probe is a backwards-compat fallback, not a recommended setting.
| `LEADBAY_TIMEOUT_MS` | no | (client default) | Per-request timeout override |

### Security

- Tokens live only in your MCP client's config file — they never traverse the network except to `api-{region}.leadbay.app`.
- The `leadbay_login` tool from the OpenClaw adapter is **not** registered on MCP: exposing a credential-taking tool to an LLM is a prompt-injection risk. Use the token path above.
- The `leadbay_add_note` and `leadbay_enrich_contacts` tools are write actions flagged `optional: true`. If your client supports per-tool opt-in, leave them disabled until you need them.

### Privacy

Contact data fetched through this server stays local to your MCP client session. No analytics or telemetry is sent by `@leadbay/mcp`. Requests to Leadbay are subject to the [Leadbay privacy policy](https://leadbay.ai/privacy).

## 7. For maintainers — publishing

Releases are tag-driven via `.github/workflows/release.yml`. Bump `packages/mcp/package.json#version`, update `packages/mcp/CHANGELOG.md`, land on `main`, then:

```bash
git tag mcp-v0.3.0 && git push origin mcp-v0.3.0
```

See [`RELEASE.md`](../../RELEASE.md) for the full runbook.

## License

MIT. See [LICENSE](./LICENSE).
