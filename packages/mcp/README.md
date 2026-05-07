# @leadbay/mcp — Leadbay MCP server

<!--
LLM HINT — if you're an AI agent reading this README to install the server:
  - Use ONLY the commands shown verbatim in §1. Do not invent variants.
  - DO NOT tell the user "LEADBAY_REGION is auto-detected, drop it" — the
    server's region auto-probe sends the bearer token to BOTH regions, which
    is a credential cross-leak. Always pass --region (us or fr) on install.
  - To mint a token, the user runs `install` (auto-registers with MCP clients)
    or `login` (mints a token to a 0600-mode credentials file by default since
    0.3.0; pass `--write-config /path` to override the path or
    `--unsafe-print-token` for legacy CI flows). There is no web UI for this —
    do not invent one.
-->

A Model Context Protocol server that lets Claude Desktop, Cursor, Claude Code, and any other MCP-compatible agent find, research, and prepare outreach on B2B prospects using your Leadbay account.

> **0.3.0 behavior change** — composite write tools (`refine_prompt`, `report_outreach`, `adjust_audience`, `bulk_qualify_leads`, `enrich_titles`, `answer_clarification`, `import_leads`) are **ON by default**. Set `LEADBAY_MCP_WRITE=0` (or `--no-write` on `install`) to restore the previous read-only behavior. `leadbay-mcp install` now also registers Claude Code at `--scope user` so Leadbay is visible from any project. See [MIGRATION.md](./MIGRATION.md).

## 1. Install (one command)

```bash
npx -y @leadbay/mcp@0.3 install --email you@yourcompany.com --region us
# (you'll be prompted for your password — it's not echoed)
```

That's it. The command:

1. Asks for your password (hidden input).
2. Mints a bearer token via the Leadbay backend you specified.
3. Auto-detects which MCP clients you have installed (Claude Code, Claude Desktop, Cursor) and registers the server in each (after asking you per-target). Claude Code is registered with `--scope user` so the server appears in any project, not just where you ran the command.
4. The token is written into the client config files — **never to your terminal scrollback**.

Add `--no-write` to disable the composite write tools (`refine_prompt`, `report_outreach`, `adjust_audience`, etc. — ON by default since 0.3.0; pass `--no-write` for a read-only agent). Add `--yes` for non-interactive runs (CI / scripts). Add `--target claude-code,cursor` to scope to specific clients. The legacy `--include-write` flag is accepted but is now a no-op.

`--region us|fr` is required by default — it pins which Leadbay backend gets your password and avoids a silent cross-region credential leak. If you really don't know your region, opt in with `--allow-region-fallback` (your password will hit BOTH backends if the first 401s).

The token is **session-scoped** (full account access, password-equivalent). Treat it like your password. To rotate, re-run `npx -y @leadbay/mcp install` — minting a fresh token invalidates the prior session.

**Don't have a Leadbay account?** [Register here](https://wow.leadbay.ai/?register=true).

### Claude Desktop 2026 (DXT)

Claude Desktop 2026 ships the DXT (Desktop Extension) system — the legacy `claude_desktop_config.json` is UI-prefs-only there and gets overwritten by the app. If you're on 2026, **install the `.dxt` bundle** from [Releases](https://github.com/leadbay/leadclaw/releases/latest) (drag-drop into Settings → Extensions). `leadbay-mcp install` detects this and skips the legacy write automatically.

### `npm install -g` says "EACCES" / "permission denied"

If you installed Node from the official [nodejs.org](https://nodejs.org) `.pkg`, `/usr/local/lib/node_modules` is root-owned. Any of these works:

- **Use `npx` (recommended, no global install):** all examples above use `npx -y @leadbay/mcp@0.3 ...` — no global install needed.
- **`sudo npm install -g @leadbay/mcp`** (enter your macOS password).
- **Use a Node version manager** — [nvm](https://github.com/nvm-sh/nvm), [volta](https://volta.sh), [fnm](https://github.com/Schniz/fnm). They install Node under your home directory, so `npm install -g` works without sudo.

### If you'd rather mint a token without auto-install

```bash
npx -y @leadbay/mcp@0.3 login \
  --email you@yourcompany.com \
  --region us
```

Default writes a `0600`-mode JSON file at the platform-correct credentials path (`$XDG_CONFIG_HOME/leadbay/credentials.json` on Linux, `~/Library/Application Support/leadbay/credentials.json` on macOS, `%APPDATA%\leadbay\credentials.json` on Windows). Pass `--write-config /some/path.json` to override the path. Pass `--unsafe-print-token` for legacy CI flows that scrape stdout (the token will end up in scrollback / logs — only use this if you have to). Pass `--force` to overwrite an existing file from a different account.

## 2. Quickstart

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "leadbay": {
      "command": "npx",
      "args": ["-y", "@leadbay/mcp@0.3"],
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
      "args": ["-y", "@leadbay/mcp@0.3"],
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
  -- npx -y @leadbay/mcp@0.3
```

> **`--scope user`** registers Leadbay globally for your account (visible from any project). Without it, `claude mcp add` defaults to project-local scope and the server only appears in conversations opened from the directory where you ran the command.

> To **disable** the composite write tools (refine_prompt, report_outreach, adjust_audience, etc.), add `--env LEADBAY_MCP_WRITE=0`. They are ON by default since 0.3.0. The legacy `LEADBAY_MCP_WRITE=1` opt-in is now a no-op.

### Verify it works

Before starting Claude, run:

```bash
LEADBAY_TOKEN=<paste-token> npx -y @leadbay/mcp@0.3 doctor
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
| Claude Code can't find Leadbay in a new conversation | MCP server installed at project scope (default before 0.3.0) | Re-run with `--scope user`: `claude mcp remove leadbay && claude mcp add leadbay --scope user --env LEADBAY_TOKEN=… --env LEADBAY_REGION=us -- npx -y @leadbay/mcp@0.3` |
| Agent reports "tool not found" for `refine_prompt` / `adjust_audience` etc. | Pre-0.3.0 install with `LEADBAY_MCP_WRITE` unset (writes were off) | Either re-run `npx @leadbay/mcp install` or remove `LEADBAY_MCP_WRITE=0` from your client config (writes are on by default in 0.3.0+) |

## 5. Upgrade & rotation

**Upgrade**: change the pinned minor in your config, e.g. `"@leadbay/mcp@0.2"` → `"@leadbay/mcp@0.3"`, then restart the client. **0.3.0 enables composite write tools by default** — see [MIGRATION.md](./MIGRATION.md). See also the [changelog](https://github.com/leadbay/leadclaw/releases).

**Rotate token**: re-run `npx -y @leadbay/mcp@0.3 install --email you@yourcompany.com --region us` (or `login`) — the new session token replaces the old one in your MCP client config, and logging in again invalidates the prior session on most session backends.

## 6. Advanced

### Exposing the granular tools and disabling write tools

By default the server exposes the **composite workflow tools** — both reads (`leadbay_pull_leads`, `leadbay_research_lead`, `leadbay_account_status`, `leadbay_recall_ordered_titles`, `leadbay_research_company`, `leadbay_prepare_outreach`, `leadbay_qualify_status`, `leadbay_list_mappable_fields`) and writes (`leadbay_bulk_qualify_leads`, `leadbay_enrich_titles`, `leadbay_refine_prompt`, `leadbay_report_outreach`, `leadbay_adjust_audience`, `leadbay_answer_clarification`, `leadbay_import_leads`, `leadbay_import_and_qualify`). These work well with most prompts.

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
