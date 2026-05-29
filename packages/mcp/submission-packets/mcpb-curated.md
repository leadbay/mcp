# Anthropic Curated MCPB Extension Directory Submission

Submission URL: `https://forms.gle/tyiAZvch1kDADKoP9`

## Package fields

Package name: Leadbay

Package identifier: `leadbay`

Version: `0.16.0`

Publisher: Leadbay

Support email: support@leadbay.ai

Website: https://leadbay.ai

GitHub: https://github.com/leadbay/leadclaw

Package source: https://github.com/leadbay/leadclaw/tree/main/packages/dxt

License: MIT

Runtime: Node.js >= 22

Bundle format: MCPB, emitted from `manifest_version: 0.3`.

MCPB release URL:

`https://github.com/leadbay/leadclaw/releases/download/mcp-v0.16.0/leadbay-0.16.0.mcpb`

SHA-256:

TODO after release.

Compute after release:

```bash
gh release download mcp-v0.16.0 --pattern 'leadbay-0.16.0.mcpb'
openssl dgst -sha256 leadbay-0.16.0.mcpb
```

## Descriptions

Short description:

Leadbay lets Claude find, research, qualify, and prepare outreach for B2B prospects using your Leadbay account.

Long description:

Leadbay MCP connects Claude Desktop to Leadbay for B2B lead discovery, qualification, research, and outreach prep. On first launch, the extension opens Leadbay in the user's browser for OAuth consent and auto-detects the user's region through stargate. Claude can check account status, pull fresh leads, research companies and contacts, prepare outreach-ready email and LinkedIn drafts, and optionally log or update Leadbay state when write tools are enabled. Version 0.13.0 includes MCP annotations, typed outputs, prompts, resources, progress notifications, cancellation support, elicitation, and local agent memory for safer agent workflows.

## Manifest notes

Manifest file: `packages/dxt/manifest.template.json`

Validated fields:

- `manifest_version: 0.3`
- `name: leadbay`
- `version: 0.16.0` rendered during build.
- `server.type: node`
- `compatibility.runtimes.node: >=22`
- `server.mcp_config.env.LEADBAY_OAUTH_BOOTSTRAP: "1"` enables browser OAuth on first launch.
- No token, region, or backend URL user-config fields are exposed.
- `user_config.leadbay_mcp_write` defaults to `true`.

## Authentication

Authentication type: OAuth 2.0 Authorization Code + PKCE.

The bundled server performs Dynamic Client Registration, opens `https://leadbay.app/oauth/authorize`, receives the authorization code on a loopback redirect, exchanges it for an opaque Leadbay OAuth token, and persists the token in the user's local Leadbay credentials file.

No OAuth scopes are requested by the extension yet; any granted token has the same account access as the user's Leadbay session.

## Security and privacy

The MCPB bundle contains the server code and static assets. OAuth tokens are minted locally through the user's browser session and stored in the user's local Leadbay credentials file. Leadbay MCP sends requests only to the regional Leadbay backend inferred by stargate or stored with the credential. Composite write tools are enabled by default and can be disabled in extension settings.

## Screenshots

Replace these placeholders with public image URLs before submitting:

1. MCPB install and configuration: TODO
2. Daily check-in prompt: TODO
3. Research a domain: TODO
4. Prepare outreach: TODO
5. Account status: TODO

Suggested local capture paths:

- `packages/mcp/submission-packets/screenshots/01-install.png`
- `packages/mcp/submission-packets/screenshots/02-daily-check-in.png`
- `packages/mcp/submission-packets/screenshots/03-research-domain.png`
- `packages/mcp/submission-packets/screenshots/04-prepare-outreach.png`
- `packages/mcp/submission-packets/screenshots/05-account-status.png`
