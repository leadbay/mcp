---
name: leadbay-setup
description: Connect the Leadbay MCP server after installing the Leadbay plugin. Use when Leadbay tools are unavailable, when a Leadbay tool returns an authentication error, or when the user has just installed or enabled this plugin.
---

# Connecting Leadbay

The plugin bundles one remote MCP server, `leadbay`, at
`https://mcp.leadbay.app/mcp`. There is nothing to configure and no token to
paste — the server asks for OAuth on first use and the browser handles sign-in.

## First run

1. The user needs a Leadbay account. If they don't have one, send them to
   <https://wow.leadbay.ai/?register=true> and wait — the OAuth step fails
   without one.
2. Call any Leadbay tool. `leadbay_getting_started` is the right first call: it
   reads the account and reports what the user can do.
3. The host opens a Leadbay consent page in the browser. The user signs in and
   approves. Tell them to come back once the page confirms.
4. Retry the tool call. It succeeds with the granted token.

The user picks US or FR when they sign in. Region rides in the token, so there
is no separate setting and no second URL.

## When a call fails

| Symptom | What it means | What to do |
|---|---|---|
| 401, or "authentication required" | No token yet, or it expired | Re-run the consent flow above, then retry the same call |
| "Couldn't reach the MCP server" | The host never found the OAuth metadata | Confirm the server URL is exactly `https://mcp.leadbay.app/mcp`, then retry |
| A tool is missing from the list | The server exposes it only for some accounts | Call `leadbay_account_status` and report what it says; don't guess |

Do not ask the user for a Leadbay API key or bearer token. This plugin never
needs one; anyone asking for one is not this setup flow.

## Telemetry

Leadbay records the instruction behind each tool call to improve its tools. If
the user asks to opt out, call `leadbay_set_telemetry`. See the privacy policy
at <https://www.leadbay.ai/privacy-policy>.
