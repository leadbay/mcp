# Anthropic Connectors Directory — answer sheet

Portal: <https://claude.ai/admin-settings/directory/submissions/new>
(Team/Enterprise org, Owner or a role carrying the **Directory** permission.)

Status dashboard: <https://claude.ai/admin-settings/directory/submissions>.
Escalations: `mcp-review@anthropic.com`.

This is a **re-submission**. The first review rejected the connector
(product#3943) because `leadbay_report_friction` logged conversation content
without the user's knowledge. Fixed in 0.27.0 (PR #171) and locked by
`packages/mcp/test/audit/friction-*.test.ts`. If the reviewer raises it, point
at those five audits.

The portal steps below are in the order the form asks them.

---

## 1. Connection

| Field | Answer |
|---|---|
| Server URL | `https://mcp.leadbay.app/mcp` |
| Transport | Streamable HTTP |
| Same URL for every user? | **Yes.** Region (US / FR) is decided at consent and rides in the token suffix (`auth-http.ts:regionFromToken`), so one URL serves both. `/fr/mcp` exists only as a legacy alias and is not submitted. |

Do **not** submit `/chatgpt/mcp`. That path exists for the OpenAI directory,
which bans selling digital goods; it drops `leadbay_create_topup_link` and
`leadbay_open_billing_portal`. Anthropic's policy bars software that *executes*
financial transactions, which handing the user a Stripe URL does not.

## 2. Tools

Synced automatically from the live server. Expect **60**: 59 composite tools
(30 read + 29 write) plus `leadbay_set_telemetry`, which is registered even when
`LEADBAY_MCP_WRITE=0` so a read-only deployment can still opt out of analytics.
Granular tools stay off (`LEADBAY_MCP_ADVANCED` is unset on hosted).

Every tool carries `annotations.title` and an explicit `readOnlyHint` /
`destructiveHint`. Enforced by `test/annotations-presence.test.ts` and
`test/audit/destructive-hint-on-overwrites.test.ts`. Re-count before submitting:

```bash
curl -s -X POST https://mcp.leadbay.app/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | jq '.result.tools | length'
```

The server is the authority, not the checkout.

## 3. Listing

| Field | Answer |
|---|---|
| Name (≤100) | `Leadbay` |
| Tagline (≤55) | `Work your B2B lead pipeline` |
| Categories (1-5) | Sales, Productivity |
| Documentation URL | `https://docs.leadbay.app/doc/leadbay-mcp/what-is-leadbay-mcp` |
| Privacy policy URL | `https://www.leadbay.ai/privacy-policy` |
| Support contact | `support@leadbay.ai` |
| Icon | `https://leadbay.ai/icon-192.png` (192×192 PNG) |
| Slug | `leadbay` — **permanent once published** |

Description (≤2000; 1515 as written, adapted from `chatgpt-app-submission.json`):

> Leadbay is a B2B prospecting workspace that sources and scores companies
> against a seller's ideal customer profile. This connector links Claude to the
> user's own Leadbay account so they can work that pipeline in plain language
> instead of clicking through the web app.
>
> Typical sessions: pull the day's fresh, AI-scored prospects and skim the best
> ones; research a single company in depth (qualification signals, contacts,
> recent web findings, past notes and activity); draft a personalised outreach
> email or call opener for a named contact; plan which accounts to visit in a
> city before a trip; import a list of companies and have Leadbay qualify them;
> and log what was actually sent so the pipeline stays honest.
>
> It also covers the account admin a seller needs along the way: managing lenses
> (saved audiences), campaigns, contacts, CRM custom fields, and the
> qualification questions every lead is scored against.
>
> Lead and contact data is read and written only in the signed-in user's own
> Leadbay workspace, over an OAuth token the user grants. Two consent-gated
> tools are the exception and send nothing else: "send feedback" delivers a
> message the user wrote to the Leadbay team, and "report a problem" emits one
> product-analytics event carrying the user's own words. Both fire only when the
> user asks or accepts an offer, and neither carries lead or contact data. The
> connector does not send email or messages on the user's behalf — it drafts
> outreach and records the outcome the user reports.

Not an MCP App: the server ships no widgets and never sets
`_meta.ui.resourceUri`, so no carousel screenshots are required. It routes to
Claude's first-party widgets (`places_map_display_v0`, `message_compose_v1`,
`ask_user_input_v0`) when the host exposes them, and falls back to markdown.

No `ui/open-link` capability, so there are no allowed link URIs to declare. Tool
results do surface `https://checkout.stripe.com/...` and `https://leadbay.app/...`
as ordinary markdown links the user clicks.

## 4. Use cases

Primary: daily lead pull and triage; single-company research; outreach drafting;
pre-trip account planning by city; CSV/CRM import plus qualification; logging
outreach outcomes.

Prerequisites: a Leadbay account (<https://wow.leadbay.ai/?register=true>).
Plan limits and AI-credit quotas apply; a free account can complete every
read-side journey.

Reads **and** writes. Writes are confined to the signed-in user's own workspace:
notes, lead status, campaigns, contacts, custom fields, lenses, outreach records.

## 5. Company

| Field | Answer |
|---|---|
| Company | Leadbay |
| Website | `https://leadbay.ai` |
| Primary contact | Milan Stankovic — `milstan@leadbay.ai` |

## 6. Authentication

**`oauth_dcr`** — OAuth 2.0 with Dynamic Client Registration (RFC 7591).
Switch this answer to **`oauth_cimd`** if the Stargate CIMD change lands first.

| Piece | Value |
|---|---|
| Protected-resource metadata | `https://mcp.leadbay.app/.well-known/oauth-protected-resource/mcp` (RFC 9728) |
| 401 challenge | `WWW-Authenticate: Bearer realm="mcp", resource_metadata="…"` on every unauthenticated request |
| Authorization server | `https://stargate.leadbay.app` |
| Authorization endpoint | `https://leadbay.app/oauth/authorize` |
| Token endpoint | `https://stargate.leadbay.app/1.0/oauth/token` |
| Registration endpoint | `https://stargate.leadbay.app/1.0/oauth/register` |
| PKCE | `code_challenge_methods_supported: ["S256"]` |
| Client auth | `client_secret_post`, `none` (public client) |
| Bearer transport | header only; no token ever in a query string |

Scopes: none requested. The token grants access to the authenticated user's own
Leadbay account and nothing else.

Redirect URI to register for the hosted Claude surfaces:
`https://claude.ai/api/mcp/auth_callback`. Claude Code uses an RFC 8252 loopback
redirect on an ephemeral port, so `http://localhost/callback` and
`http://127.0.0.1/callback` must match port-agnostically.

Known gaps, both in `leadbay/backend` + stargate, tracked separately:

1. Stargate does not advertise `client_id_metadata_document_supported`, so Claude
   falls back to DCR and registers a fresh client per connection. Registration is
   rate-limited to ~10 per IP per hour and **all** Anthropic traffic originates
   from `160.79.104.0/21`. Advertise CIMD (or allowlist the range) before the
   listing goes live.
2. `grant_types_supported` lists only `authorization_code`, and there is no
   `scopes_supported` / `offline_access`. Confirm whether the token endpoint
   returns a `refresh_token`; without one, users face a full re-consent at expiry.

## 7. Data handling

The connector calls Leadbay's **own first-party API** (`api-us.leadbay.app` /
`api-fr.leadbay.app`). Nothing is proxied from a partner. No personal health
data. No sponsored content, no advertising, no paid placement.

What leaves the user's machine, and why:

| Data | Destination | Trigger |
|---|---|---|
| Tool arguments and results (leads, contacts, campaigns, notes) | Leadbay API | The tool call itself |
| `_triggered_by` — the one instruction the call is executing, capped at 500 chars, secrets replaced with `[REDACTED]` | PostHog, as `last_prompt` | Every composite call, unless telemetry is off |
| Message the user wrote | Leadbay team inbox | `leadbay_send_feedback`, user-initiated only |
| The user's own words about a problem | PostHog, one event | `leadbay_report_friction`, user-initiated or offered-and-accepted only |

`_triggered_by` is the call's input provenance, not a transcript: one
instruction, never surrounding turns, never a summary of the conversation.
Bounded at `packages/mcp/src/server.ts:585` and locked by
`test/audit/triggered-by-single-message.test.ts`. It is tied to the user's
Leadbay account, so we describe it as identified, not anonymous. Telemetry is
opt-out — `leadbay_set_telemetry`, or `LEADBAY_TELEMETRY_ENABLED=0`. Documented
in the repo README's Privacy Policy section and on the public privacy policy.

The connector never queries Claude's memory, chat history, conversation
summaries, or the user's files.

## 8. Test & launch

Reviewer account: **production, not staging** — the connector points at prod.
Fill in before submitting:

- Sign-up/login URL: `https://app.leadbay.app`
- Email: `TODO`
- Password: `TODO`
- Region shown at consent: `TODO (US or FR)`

The account must be fully populated: at least one lens with scored leads,
contacts on those leads, one campaign, prior outreach records and notes, so
every tool returns real data rather than an empty list.

Reviewer walk-through:

1. Add the connector, complete the Leadbay consent screen.
2. "Show me today's leads." → `leadbay_pull_leads`
3. "Research the top one." → `leadbay_research_lead_by_id`
4. "Draft an intro email to their head of sales." → `leadbay_prepare_outreach`
5. "Log that I sent it." → `leadbay_report_outreach`
6. "What's my quota?" → `leadbay_account_status`

Before submitting, exercise every tool through the MCP Inspector and add the
server once as a custom connector in Claude — the portal asks you to confirm
both.

## 9. Compliance — the seven acknowledgments

| Acknowledgment | Our position |
|---|---|
| Directory guidelines | Met; see the rest of this sheet. |
| First-party API usage | Yes — Leadbay's own API, nothing proxied. |
| Financial transactions | We never move money. `leadbay_create_topup_link` returns a Stripe checkout URL the user opens and completes themselves; nothing is charged by generating it. `leadbay_open_billing_portal` returns a Stripe portal URL. |
| AI media generation | None. No image, video or audio generation. |
| Prompt injection | Tool descriptions describe the tool. None instructs Claude to call unrequested software, pulls behaviour from external sources, hides instructions, or promotes a purchase — the top-up prose was rewritten to state the two options factually rather than push one. |
| Conversation data collection | See §7. One instruction per call, capped, secret-stripped, opt-out, disclosed. |
| Public documentation | `https://docs.leadbay.app/doc/leadbay-mcp/what-is-leadbay-mcp`, live today. |

## After publishing

The slug cannot change. Updates to the server take effect immediately — the
listing does not need re-approval for a tool change, but the tool list the
reviewer saw is what was approved, so material additions are worth flagging.
Server health and usage metrics appear in the submissions dashboard.
