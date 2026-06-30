# Claude.ai Connector Directory Submission

Submission URL: `https://claude.ai/settings/plugins/submit`

## Basic fields

Name: Leadbay

Publisher: Leadbay

Support email: support@leadbay.ai

Website: https://leadbay.ai

GitHub: https://github.com/leadbay/mcp/tree/main/packages/mcp

npm: https://www.npmjs.com/package/@leadbay/mcp

MCP Registry name: `io.github.leadbay/leadbay-mcp`

Package: `@leadbay/mcp@0.6.2`

Install command: `npx -y @leadbay/mcp@0.6`

Token mint command: `npx -y @leadbay/mcp@0.6 login --email <you> --region <us|fr>`

License: MIT

Pricing: Requires a Leadbay account. Leadbay plan limits and AI-credit quotas apply.

## Descriptions

Short description:

Leadbay lets Claude find, research, qualify, and prepare outreach for B2B prospects using your Leadbay account.

Medium description:

Leadbay MCP connects Claude to your Leadbay account for AI lead discovery, qualification, research, and outreach prep. Claude can check account status and quotas, pull fresh leads, research companies and contacts, prepare outreach-ready email and LinkedIn drafts, and log outreach when write tools are enabled.

Long description:

Leadbay MCP gives Claude access to the same B2B prospecting workflow teams use inside Leadbay. With a Leadbay bearer token, Claude can inspect account status, retrieve daily lead batches, research a domain or lead, summarize qualification signals, prepare outreach packages, and help operators keep CRM and outreach state current. The server exposes high-level composite tools for common sales workflows plus advanced granular tools for deeper automation. Version 0.6.2 includes MCP annotations, typed outputs, prompts, resources, progress notifications, cancellation support, and elicitation for safer agent workflows. Composite write tools are enabled by default and can be disabled with `LEADBAY_MCP_WRITE=0`.

## Authentication

Authentication type: Bearer token.

OAuth scopes requested: None.

OAuth justification: Not applicable. Users mint a Leadbay bearer token locally with the CLI and paste or provide it to Claude through secure connector configuration.

Secret handling: `LEADBAY_TOKEN` is required and should be stored as a secret. The CLI writes credentials to a 0600-mode local file by default and does not print tokens unless the user explicitly passes `--unsafe-print-token`.

Required environment variables:

- `LEADBAY_TOKEN`: Leadbay bearer token.
- `LEADBAY_REGION`: `us` or `fr`.

Optional environment variables:

- `LEADBAY_MCP_WRITE`: set to `0` to hide composite write tools.
- `LEADBAY_MCP_ADVANCED`: set to `1` to expose granular API tools.

## Data handling

Leadbay MCP sends tool requests to the Leadbay backend region selected by `LEADBAY_REGION`. It can return lead, company, contact, qualification, quota, CRM-import, and outreach-prep data associated with the authenticated Leadbay account. The MCP server does not train models and does not persist a separate copy of Leadbay account data beyond local credentials and resumable bulk-operation metadata used by the CLI/server.

## Tool summary

Primary workflows:

- Account status and quota checks.
- Daily lead pull and lead list retrieval.
- Company/domain research.
- Lead qualification and qualification status.
- Outreach package preparation.
- Optional write workflows for prompt refinement, audience adjustment, outreach logging, import, and enrichment.

## Screenshots

Replace these placeholders with public image URLs before submitting:

1. Install and configuration: TODO
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
