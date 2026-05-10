# Anthropic Curated MCPB Extension Directory Submission

Submission URL: `https://forms.gle/tyiAZvch1kDADKoP9`

## Package fields

Package name: Leadbay

Package identifier: `leadbay`

Version: `0.6.1`

Publisher: Leadbay

Support email: support@leadbay.ai

Website: https://leadbay.ai

GitHub: https://github.com/leadbay/leadclaw

Package source: https://github.com/leadbay/leadclaw/tree/main/packages/dxt

License: MIT

Runtime: Node.js >= 22

Bundle format: MCPB, emitted from the DXT-compatible manifest with `dxt_version: 0.2`.

MCPB release URL:

`https://github.com/leadbay/leadclaw/releases/download/mcp-v0.6.1/leadbay-0.6.1.mcpb`

SHA-256:

`TODO: fill after CI publishes the GitHub Release asset`

Compute after release:

```bash
gh release download mcp-v0.6.1 --pattern 'leadbay-0.6.1.mcpb'
openssl dgst -sha256 leadbay-0.6.1.mcpb
```

## Descriptions

Short description:

Leadbay lets Claude find, research, qualify, and prepare outreach for B2B prospects using your Leadbay account.

Long description:

Leadbay MCP connects Claude Desktop to Leadbay for B2B lead discovery, qualification, research, and outreach prep. Users provide a Leadbay bearer token and region during extension setup. Claude can check account status, pull fresh leads, research companies and contacts, prepare outreach-ready email and LinkedIn drafts, and optionally log or update Leadbay state when write tools are enabled. Version 0.6.1 includes MCP annotations, typed outputs, prompts, resources, progress notifications, cancellation support, and elicitation for safer agent workflows.

## Manifest notes

Manifest file: `packages/dxt/manifest.template.json`

Validated fields:

- `dxt_version: 0.2` retained for current Claude Desktop compatibility.
- `name: leadbay`
- `version: 0.6.1` rendered during build.
- `server.type: node`
- `compatibility.runtimes.node: >=22`
- `user_config.leadbay_token` marked sensitive and required.
- `user_config.leadbay_region` defaults to `fr`.
- `user_config.leadbay_mcp_write` defaults to `true`.

## Authentication

Authentication type: Bearer token.

Token mint command: `npx -y @leadbay/mcp@0.6 login --email <you> --region <us|fr>`

The extension prompts for the bearer token and Leadbay region on install. No OAuth scopes are requested by the extension.

## Security and privacy

The MCPB bundle contains the server code and static assets. User secrets are provided through Claude Desktop extension configuration. Leadbay MCP sends requests only to the Leadbay backend region selected by the user. Composite write tools are enabled by default and can be disabled in extension settings.

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
