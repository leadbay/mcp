# MCP server design: emerging practices, September 2026

A survey of how MCP servers are being built, taken on 2026-09-18. It is a reference
for design decisions in this repo, not a rulebook: the field is too young for best
practices, so each entry says who does it, what evidence exists, and how settled it is.

Method. Four research passes over primary sources (the MCP specification, SEPs and
blog; Anthropic, OpenAI, Microsoft, Google and Cursor documentation; builders' own
repositories and posts; papers), about 280 sourced items in total. Host limits in
section 1 were then re-checked against the primary page, and for Claude Code against
the shipped 2.1.247 binary.

Labels used below:

| Label | Meaning |
|---|---|
| Spec | Normative text in the MCP specification or an official extension |
| Host | Shipped behaviour or a documented limit of a host (Claude, ChatGPT, Cursor, VS Code, ...) |
| Policy | A directory review rule (Anthropic Connectors Directory, OpenAI plugin directory) |
| Measured | A published number from the builder's own measurement or a paper |
| Vendor | A recommendation from a platform vendor, without published data |
| Opinion | A practitioner's judgement |
| Proposal | A draft SEP or roadmap item, not released |
| Unverified | Seen only in secondary sources or bug reports |

Dates are publication dates. Pages without a date are marked "read 2026-09-18".

---

## 1. Host facts that constrain every server

| Host | Fact | Label | Source |
|---|---|---|---|
| Claude Code | Each MCP tool description and the server `instructions` are cut at 2,048 characters, followed by `… [truncated]`. | Host | [code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp) (read 2026-09-18); changelog v2.1.84, 2026-03-25 |
| Claude Code | MCP tools are deferred behind tool search by default. At session start the model sees tool names and the first 2,048 characters of instructions. Auto-deferral triggers when tool definitions exceed 10% of the context window. | Host | same page; v2.1.7, 2026-01-13 |
| Claude Code | Tool output warns at 10,000 tokens and is capped at 25,000 (`MAX_MCP_OUTPUT_TOKENS`). A tool can raise its own limit with `_meta["anthropic/maxResultSizeChars"]`, up to 500,000 characters; larger results go to a file. | Host | same page; v2.1.91, 2026-04-02 |
| Claude Code | Per-tool `_meta` keys it reads: `anthropic/searchHint`, `anthropic/alwaysLoad`, `anthropic/maxResultSizeChars`, `anthropic/requiresUserInteraction`. | Host | same page; binary 2.1.247 |
| Claude Code | Calls still running after 2 minutes move to a background task. Idle timeout is 5 minutes for HTTP servers, reset by progress notifications. | Host | same page; v2.1.212, 2026-07-16 |
| claude.ai, Desktop | Tool results are capped at about 150,000 characters. Tool calls time out after 240 seconds. Resource subscriptions and sampling are not supported. | Host | [claude.com/docs/connectors/building](https://claude.com/docs/connectors/building/index.md) (read 2026-09-18) |
| claude.ai, Desktop | How long descriptions and instructions are handled is not documented. | Unverified | none |
| claude.ai | Tool access modes "Auto", "Always available" and "On demand". Anthropic suggests "On demand" or "Auto" above 30 tools. | Host | [support.claude.com 13730515](https://support.claude.com/en/articles/13730515-manage-claude-s-tool-access) |
| claude.ai | With Dynamic Client Registration, Claude registers a new client on every fresh connection; Anthropic recommends Client ID Metadata Documents for high-traffic servers. A protected tool must answer HTTP 401 with `WWW-Authenticate` (not `isError`) for Claude to show a Connect card. | Host | [authentication](https://claude.com/docs/connectors/building/authentication.md), [lazy authentication](https://claude.com/docs/connectors/building/lazy-authentication.md) |
| claude.ai | Reported: MRTR `input_required` results shown as errors and never retried; tool lists stale for hours after a deploy; description changes reset "always allow". | Unverified | anthropics/claude-ai-mcp #1027, #1044, #1032 (2026-09) |
| ChatGPT | Reads server instructions since 2026-05-26. "Keep the most important details in the first 512 characters." | Host | [plugins changelog](https://developers.openai.com/plugins/changelog), [build guide](https://developers.openai.com/apps-sdk/build/mcp-server) |
| ChatGPT | `structuredContent` and `content` reach the model; `_meta` reaches only the widget. `readOnlyHint`, `destructiveHint` and `openWorldHint` are required. | Host | [Apps SDK reference](https://developers.openai.com/apps-sdk/reference) |
| ChatGPT | Fully compatible with MCP Apps since 2026-02-22. CIMD client IDs since 2026-08-21. | Host | plugins changelog |
| OpenAI API | "Aim for fewer than 20 functions available at the start of a turn." Keep each deferred namespace under 10 functions. | Vendor | [function calling](https://developers.openai.com/api/docs/guides/function-calling), [tool search](https://developers.openai.com/api/docs/guides/tools-tool-search) |
| Anthropic API | Tool search returns 5 tools by default. "Claude's ability to pick the right tool degrades once you exceed 30–50 available tools." | Host, Vendor | [tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) |
| Cursor | Defers MCP tool descriptions to files and loads them on demand; 46.9% fewer agent tokens in runs using MCP tools. | Measured | [Cursor, 2026-01-06](https://cursor.com/blog/dynamic-context-discovery) |
| VS Code | At most 128 tools per request; above a threshold, tools are grouped into "virtual tools". Read-only tools run without confirmation. | Host | [chat tools](https://code.visualstudio.com/docs/chat/chat-tools), [MCP guide](https://code.visualstudio.com/api/extension-guides/ai/mcp) |
| Gemini CLI | Appends server instructions to the system prompt. Tool names become `mcp_{server}_{tool}`, 63 characters max. Strips `$schema` and `additionalProperties`. | Host | [gemini-cli MCP docs](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md) |

What this means in one line: descriptions and instructions are now search documents
first, and only a prefix of them is guaranteed to reach a model.

---

## 2. Where the protocol went: spec 2026-07-28

Source: [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog),
[release post](https://blog.modelcontextprotocol.io/posts/2026-07-28/) (Soria Parra, Delimarsky, 2026-07-28).

| Change | What it asks of a server | Label |
|---|---|---|
| No `initialize` handshake, no sessions, no `Mcp-Session-Id`. Every request carries its version and client capabilities. `server/discover` is mandatory. (SEP-2575, SEP-2567) | Any request may land on any instance. Cross-call state goes in explicit handles passed as tool arguments. | Spec |
| Multi Round-Trip Requests replace server-initiated `elicitation/create`, `sampling` and `roots`: the server returns `resultType: "input_required"` and the client retries with the answers. `requestState` must be integrity-protected when it affects authorization or business logic. (SEP-2322) | Mid-call user input no longer needs a held-open stream. | Spec |
| `tools/list` must not vary per connection (it may vary by the caller's authorization), should be deterministically ordered, and carries `ttlMs` and `cacheScope`. (SEP-2549) | Tool sets keyed on URL path or token remain valid; per-session tool changes do not. | Spec |
| Tasks moved to an official extension, `io.modelcontextprotocol/tasks`: server-decided, poll-based, durable handles. No major chat host lists support yet. (SEP-2663) | Launch-then-poll through ordinary tools stays the portable pattern. | Spec, Host |
| Deprecated: Dynamic Client Registration (in favour of Client ID Metadata Documents), Sampling, Roots, Logging, HTTP+SSE. Minimum 12-month window. | New servers should offer CIMD and not adopt the deprecated features. | Spec |
| Tier-1 SDKs support 2026-07-28 and still answer the legacy handshake. TypeScript SDK split into `@modelcontextprotocol/server` and `/client`. | Serve both protocol generations during the transition. | Spec |
| Official extensions: MCP Apps (UI, 2026-01-26), Skills over MCP (SEP-2640, Final 2026-09-13), Enterprise-Managed Authorization. | Procedure and UI now have standard carriers outside tool descriptions. | Spec |
| Roadmap (2026-08-22): "progressive discovery" first among improved primitives; webhooks and channels instead of polling; standardised tool-result handling. | Expect a standard small-entry-point catalog pattern. | Proposal |

Governance: MCP moved to the Linux Foundation's Agentic AI Foundation on 2025-12-09.

---

## 3. Practices, by area

### 3.1 Tool surface

| Practice | Evidence | Label |
|---|---|---|
| Design tools around user outcomes, not API endpoints. | Anthropic, [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents), 2025-09-11. Block, [playbook](https://engineering.block.xyz/blog/blocks-playbook-for-designing-mcp-servers), 2025-06-16, from 60+ servers. Lowin (FastMCP), [Stop converting REST APIs to MCP](https://jlowin.dev/blog/stop-converting-rest-apis-to-mcp), 2025-07-10. Notion rewrote its 1:1 server around markdown pages, 2025-07-15. | Vendor, Opinion |
| Keep the default surface small. | Sentry: "Target ~20 publicly visible tools. Never exceed 25", 9 visible today ([adding-tools.md](https://github.com/getsentry/sentry-mcp/blob/main/docs/contributing/adding-tools.md)). Schmid: 5 to 15 per server ([2026-01-21](https://www.philschmid.de/mcp-best-practices)). Anthropic `mcp-server-dev` skill: 1 to 15 ideal, above 30 switch to search plus execute. GitHub Copilot cut built-in tools 40 to 13: +2 to 5 points success, −400 ms ([2025-11-19](https://github.blog/ai-and-ml/github-copilot/how-were-making-github-copilot-smarter-with-fewer-tools/)). GitHub merging Projects tools saved about 23,000 tokens, 50% ([2026-01-28](https://github.blog/changelog/2026-01-28-github-mcp-server-new-projects-tools-oauth-scope-filtering-and-new-features/)). | Measured, Vendor |
| Put the long tail behind search and execute. | Sentry 14 native tools to 8 plus a 19-tool catalog ([Cramer, 2026-06-11](https://cra.mr/a-bigger-toolbox-for-mcp)). Stripe covers about 150 API methods with read/write meta-tools ([docs](https://docs.stripe.com/mcp)). PostHog serves 974 tools through one `exec` tool. Speakeasy: −96% input tokens at 2 to 3x more calls and about +50% latency ([2025-11-18](https://www.speakeasy.com/blog/how-we-reduced-token-usage-by-100x-dynamic-toolsets-v2)). | Measured |
| Code mode for very wide APIs: the model writes code against a typed API in a sandbox. | Cloudflare covers 2,500+ endpoints in about 1,000 tokens instead of 1.17M ([2026-02-20](https://blog.cloudflare.com/code-mode-mcp/)). Anthropic example: 150,000 to 2,000 tokens ([2025-11-04](https://www.anthropic.com/engineering/code-execution-with-mcp)). Stainless measured completeness 98% for SDK code mode versus 70% for dynamic toolsets on 31 tasks (vendor-run, [2026-03-02](https://www.stainless.com/blog/sdk-code-mode/)). | Measured |
| An LLM inside a tool, only for a narrow job (for example natural language to a query). | Sentry embeds one in its search tools. Wrapping the whole server in one agent tool cut tokens 95% but raised latency 110% and Sentry reverted ([2025-10-29](https://cra.mr/subagents-with-mcp/)). Context7 moved reranking server-side: −65% tokens, −38% latency, −30% calls ([2026-01-07](https://upstash.com/blog/new-context7)). | Measured |
| Server-side dynamic toolsets are giving way to host-side tool search. | GitHub deleted `--dynamic-toolsets` on 2026-05-20: "Dynamic mode was local-only… It carried real complexity" ([PR #2512](https://github.com/github/github-mcp-server/pull/2512)). | Host, Opinion |
| Surface variants by URL path or token scope, not by session. | Linear `/mcp/readonly`. GitHub `/readonly`, `/insiders`, OAuth-scope filtering. PostHog pins its tool mode per submitted URL because OpenAI caches the roster per plugin. | Host |
| Consolidating operations into one `method`-switch tool costs per-operation permissions. | GitHub re-added granular issue and PR tools as opt-in on 2026-04-14: "impossible to selectively enable individual operations" ([PR #2306](https://github.com/github/github-mcp-server/pull/2306)). | Opinion, Contested |
| One risk level per tool; never mix reads and writes. | Block playbook. Anthropic directory rejects a catch-all tool with a `method` parameter ([review criteria](https://claude.com/docs/connectors/building/review-criteria.md)). | Policy |
| Keep old tool names working after a rename. | GitHub `DeprecatedToolAliases` ([tool-renaming.md](https://github.com/github/github-mcp-server/blob/main/docs/tool-renaming.md)). SEP-1575 (tool semver) closed as dormant 2026-06-26. | Host, Opinion |

### 3.2 Descriptions and instructions (the prompt layer)

| Practice | Evidence | Label |
|---|---|---|
| "Describe what the tool does. Do not tell Claude how to behave." Descriptions are rejected if they direct Claude to call tools the user did not request, interfere with other tools, or pull behavioural instructions from elsewhere. | [Anthropic pre-submission checklist](https://claude.com/docs/connectors/building/review-criteria.md) (read 2026-09-18). Anthropic's `mcp-server-dev` skill: "always do X / you must call Y first" in a description is "treated as prompt injection at review" (2026-04-17). OpenAI: descriptions "must not favor or disparage other plugins" ([guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines)). | Policy |
| Cross-tool sequencing belongs in server instructions, briefly; do not repeat tool descriptions there. | MCP blog, [Server Instructions](https://blog.modelcontextprotocol.io/posts/2025-11-03-using-server-instructions/) (Hungerford, 2025-11-03): in GitHub's 40-session test, instructions took success from 60% to 85%. OpenAI: first 512 characters matter. GitHub's instructions are assembled per enabled toolset, about 1.7k characters. | Measured (small n), Vendor |
| Purpose first; write descriptions as search documents with the words users use. | Anthropic tool search docs: "Use keywords in descriptions that match how users describe tasks", consistent name prefixes. OpenAI: start with "Use this when…" and state disallowed cases ([optimize metadata](https://developers.openai.com/apps-sdk/guides/optimize-metadata)). | Vendor |
| Measure description size in CI against a per-tool budget. | Sentry comments a per-tool token table on every PR and flags any tool over 1,000 tokens; its 24-tool server was 14,068 tokens ([token-cost-tracking.md](https://github.com/getsentry/sentry-mcp/blob/main/docs/operations/token-cost-tracking.md)). mcp-surface-lint warns above 1,500 characters per description and 10,000 tokens per `tools/list`. | Measured, Opinion |
| Complete descriptions help, at a cost. | 856 tools studied: 97% had a defect; completing six parts raised task success 5.85 points but steps rose 67% and 16.7% of cases got worse; removing examples made no significant difference ([arXiv 2602.14878](https://arxiv.org/abs/2602.14878), 2026). | Measured |
| Tone down emphatic wording for current models. | Anthropic: "dial back any aggressive language… 'If in doubt, use [tool]' will cause overtriggering" ([prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)). Assertive cues gave an identical tool 7x the calls on GPT-4.1 ([arXiv 2505.18135](https://arxiv.org/abs/2505.18135), EMNLP 2025). | Vendor, Measured |
| Examples for complex parameters as structured `input_examples`, not prose. | Accuracy on complex parameters 72% to 90% ([Anthropic advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use), 2025-11-24). | Measured |
| Keep routing examples outside the description as a golden prompt set with direct, indirect and negative prompts; track precision and recall; change one field at a time. | [OpenAI optimize metadata](https://developers.openai.com/apps-sdk/guides/optimize-metadata). | Vendor |
| Serve long guidance on demand instead of inline. | PostHog `learn visualizations` and `learn urls`; HubSpot `tool_guidance`; Datadog `search_datadog_docs`. | Host (their servers) |
| Procedure lives in skills, shipped beside the server. | Anthropic: "Build a remote MCP server with OAuth first… Then create a plugin with skills" ([what to build](https://claude.com/docs/connectors/building/what-to-build.md)). OpenAI plugins bundle skills and MCP; ChatGPT imports skills from a server at submission. Skills over MCP is a Final extension. Stripe, Apollo, Figma and Notion ship skills. | Vendor, Spec |
| Always-present context can beat an on-demand skill, if the host delivers it. | Vercel: an 8 KB AGENTS.md scored 100% versus 53% for an available skill, unused in 56% of cases (2026-01-27). | Measured (vendor) |
| Automated rewriting of descriptions from routing failures. | One rewrite fed false positives and negatives: F1 79.2 versus 79.4 hand-tuned, 32x faster ([arXiv 2606.30775](https://arxiv.org/abs/2606.30775), 2026-06-29). GEPA MCP adapter; Trace-Free+ ([2602.20426](https://arxiv.org/abs/2602.20426)). | Measured |
| Snapshot the emitted tool definitions and review diffs. | GitHub `toolsnaps` fails CI on any schema or description change ([testing.md](https://github.com/github/github-mcp-server/blob/main/docs/testing.md)). mcpward, ToolDiff and Specmatic do the same black-box. | Host (their servers) |
| Per-deployment description overrides from one binary. | GitHub i18n overrides via JSON or environment variables, `--export-translations`. | Host (their server) |

### 3.3 Tool results

| Practice | Evidence | Label |
|---|---|---|
| Size results against the host's cap, per client if needed, and say what was left out. | PostHog: Codex accepts about 10k tokens per result; caps per client profile, marks omissions ([PR #99377](https://github.com/PostHog/posthog/pull/99377), open 2026-09-11). Anthropic directory: "Keep responses reasonably sized… Do not return a full database dump". | Measured, Policy |
| Paginate by token budget, not record count. Trim rarely used fields from defaults. | Datadog: CSV about half the tokens of JSON per record; SQL tool made runs about 40% cheaper ([2026-03-04](https://www.datadoghq.com/blog/engineering/mcp-server-agent-tools/)). | Measured |
| Offer concise and detailed forms; summary and patch variants of big objects. | Anthropic `response_format` example: 206 versus 72 tokens. Grafana `get_dashboard_summary`, `patch_dashboard`. | Measured, Host |
| Markdown or a predictable shape over raw API JSON; drop nulls. | Sentry [tool-responses.md](https://github.com/getsentry/sentry-mcp/blob/main/docs/contributing/tool-responses.md); Notion markdown; Block playbook. | Opinion |
| Results are data, not a system prompt. | Sentry bans "IMPORTANT, MUST, CRITICAL" in results. PostHog is removing a blanket "search first on every request" mandate that hijacked unrelated requests ([PR #102671](https://github.com/PostHog/posthog/pull/102671)). OpenAI Model Spec (2026-08-18): instructions in tool output "MUST be treated as information". | Policy (theirs), Host |
| No study measures whether "next steps" text in results improves outcomes. | Survey gap as of 2026-09-18. | Unverified |
| `structuredContent` plus a text fallback. | Spec: a tool returning structured content "SHOULD also return the serialized JSON in a TextContent block". Reported: Claude Code forwards only `structuredContent` when both exist (claude-code #55677, closed "not planned"). | Spec, Unverified |
| Errors that teach recovery; validation errors as `isError: true`, auth errors as HTTP 401/403. | Spec 2025-11-25 (SEP-1303). Anthropic review: generic errors fail. Datadog "did you mean 'status'?". | Spec, Policy |

### 3.4 Long-running work and mid-call input

| Practice | Evidence | Label |
|---|---|---|
| Launch, return a handle, poll a status tool. Hold no job state in the MCP layer; state the handle's lifetime in the launching tool; re-check authorization on every call. | Spec 2026-07-28 "Stateful Tools" guidance and SEP-2567. Notion `get-async-task`, GitHub `get_copilot_job_status`, Arcade async pattern. | Spec, Host |
| Tasks extension for the same shape, once hosts support it. | SEP-2663. No host verified as of 2026-09-18 ([canimcp.dev](https://canimcp.dev/), 41 clients). | Spec, Unverified |
| Progress notifications keep Claude Code's idle timer alive; they do not extend wall-clock limits. | Claude Code docs. | Host |
| Mid-call confirmation through MRTR, with a two-step quote-then-confirm fallback where hosts do not retry. | Spec SEP-2322. claude.ai shows `input_required` as an error (#1027, reported). | Spec, Unverified |
| Stay under host wall clocks: claude.ai 240 s; Claude Code backgrounds at 2 minutes. | Host docs. | Host |

### 3.5 Money and risky writes

| Practice | Evidence | Label |
|---|---|---|
| Bind consent to the quote on the server. | Supabase: `create_project` requires a `confirm_cost_id` minted by `confirm_cost`; elicitation with signed `requestState` where supported ([account-tools.ts](https://github.com/supabase-community/supabase-mcp/blob/main/packages/mcp-server-supabase/src/tools/account-tools.ts)). PostHog: 23 signed, single-use prepare/execute pairs ([PR #102293](https://github.com/PostHog/posthog/pull/102293)). Neon: prepare then complete a migration. | Host (their servers) |
| Approve out of band, in the vendor's own UI. | Stripe returns an approval URL for refunds and payouts; approvals expire after 24 hours ([docs](https://docs.stripe.com/mcp)). | Host (their server) |
| Host approval plus warnings, or admin credit caps. | Apollo: approval-required setting plus credit warnings in skills. Clay: per-rep credit limits. | Host (their servers) |
| Annotations are risk vocabulary, not enforcement. | MCP blog, [Tool Annotations as Risk Vocabulary](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/), 2026-03-16. Claude Code `anthropic/requiresUserInteraction` forces a prompt per call. | Spec, Host |

### 3.6 Auth, hosting, tenancy

| Practice | Evidence | Label |
|---|---|---|
| Remote first, with OAuth; local stdio for development. | Notion is sunsetting its local server. Sentry and Neon moved remote. MCP docs: prefer remote Streamable HTTP for anything wrapping a cloud API; MCPB when the server must touch the machine. | Host, Vendor |
| Stateless request handlers; application state in the backend, referenced by handles. | Spec 2026-07-28. Cloudflare deprecated `McpAgent` for `createMcpHandler` ([2026-08-06](https://blog.cloudflare.com/mcp-v2/)). Sentry ran the stateless spec in production before release. | Spec, Host |
| Client ID Metadata Documents instead of Dynamic Client Registration. | Spec deprecation (PR #2858). Claude and ChatGPT support CIMD; Claude picks it when the AS advertises `client_id_metadata_document_supported: true` and `none` auth. | Spec, Host |
| Tenant isolation is the failure mode with a public incident. | Asana exposed data across organisations, June 2025; about 1,000 customers notified. | Unverified (press) |
| Client allowlists and per-connection consent. | Vercel (only reviewed clients), Atlassian and Asana admin allowlists. | Host |

### 3.7 Verification

| Practice | Evidence | Label |
|---|---|---|
| Evals are the objective function for description changes. | PostHog: a description change "improves the MCP only if these scores say so": task success, tool-selection accuracy, schema failures, tokens per task; tasks sampled from real usage ([evals README](https://github.com/PostHog/posthog/blob/master/services/mcp/evals/README.md)). | Host (their server) |
| Grade outcomes, not paths; report pass^k across repeated trials. | Anthropic, [Demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents), 2026-01-09. MCP-Atlas: 63.3% of failures are reasoning failures ([2602.00933](https://arxiv.org/abs/2602.00933)). MCPMark: over half of failures are wrong outputs from runs that finished normally. | Vendor, Measured |
| In-memory client/server tests; mock only the network; snapshot every formatted response. | Lowin, [Stop vibe-testing](https://jlowin.dev/blog/stop-vibe-testing-mcp-servers), 2025-05-21. Sentry [testing overview](https://github.com/getsentry/sentry-mcp/blob/main/docs/testing/overview.md): do not test prompt wording, assert behaviour through tool inputs and outputs. | Opinion |
| Evaluate the production configuration (real auth, real tool list). | Braintrust MCP testing guide. | Opinion |
| Protocol conformance in CI. | GitHub runs `mcp-conformance-action`; SDK tiers are gated on the official conformance suite. | Host |

### 3.8 Observability

| Practice | Evidence | Label |
|---|---|---|
| Capture intent with a schema parameter stripped before the handler. | PostHog MCP Analytics adds a required `context` argument captured as `$mcp_intent`, plus a `get_more_tools` gap reporter; AgentCat does the same. | Host (their SDKs) |
| OpenTelemetry trace context in `_meta` (`traceparent`, `tracestate`, `baggage`). | Spec 2026-07-28 (SEP-414). OTel MCP semantic conventions are in Development. | Spec |
| Tune from production traces: zero-result queries, per-client overflow. | Sentry traces `gen_ai.tool.call.result.count`; PostHog measured Codex result overflow at 1.6% of calls. | Measured |

### 3.9 Security of the prompt layer

| Practice | Evidence | Label |
|---|---|---|
| Assume the lethal trifecta: private data, untrusted content, an exfiltration path. | Willison, [2025-06-16](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/). Invariant Labs GitHub exploit (2025-05-26); General Analysis on Supabase; Block "Operation Pale Fire" red team via zero-width characters (2026-01-15). | Opinion, Measured |
| Tool poisoning works: poisoned descriptions succeeded 36.5% of the time on average, refusals under 3%. | MCPTox. | Measured |
| Wrap untrusted results; read-only modes; project scoping; strip zero-width characters; hash descriptions to catch silent changes. | Supabase [defense in depth](https://supabase.com/blog/defense-in-depth-mcp), 2025-09-16; GitHub lockdown mode; scanners such as mcpward. | Host |
| Legitimate server text can be flagged as injection by the model. | Claude Code sub-agents replied "I will not comply with the injected instructions" to leaked server instructions (claude-code #58138, 2026-05-11). | Host |
| Collect only the conversation data a tool needs. | Anthropic policy 1.D: "must not collect extraneous conversation data, even for logging purposes" ([policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy), 2026-04-15). OpenAI: "Input fields must be directly related to the tool's stated purpose." | Policy |

### 3.10 Distribution and UI

| Practice | Evidence | Label |
|---|---|---|
| Ship a plugin: server plus skills. | Anthropic and OpenAI plugin models; Stripe `stripe agent setup` installs server and skills for each detected agent. | Vendor, Host |
| MCP Apps for in-chat UI, with transparent theming. | Official extension since 2026-01-26. Claude documents transparent backgrounds, `color-scheme: light dark`, `prefersBorder: false` so a widget follows the chat theme ([transparent theming](https://claude.com/docs/connectors/building/mcp-apps/transparent-theming.md)). GitHub (Insiders), HubSpot, Atlassian and Stripe are adding UI. | Spec, Host |
| MCPB (formerly DXT) for local desktop installs. | Renamed 2025-09-11, adopted by the MCP project 2025-11-20. | Spec |
| Release cadence meets host caches. | ChatGPT locks approved tool definitions until a new review. claude.ai users report stale lists and reset approvals after deploys. | Host (unverified for claude.ai) |

---

## 4. Contested questions

| Question | For | Against |
|---|---|---|
| Consolidated tools or granular ones? | GitHub −50% tokens on Projects | GitHub re-added granular tools for per-operation permissions |
| Server-side tool discovery or host tool search? | Sentry and Stripe keep search/execute | GitHub removed its dynamic toolsets; Cursor and Claude Code defer on the host |
| MCP or CLI plus skills? | Playwright now recommends CLI plus skills for coding agents | Checkly measured 48-50k versus 45-48k tokens once deferral is on; chat hosts have no shell |
| Always-loaded context or on-demand skills? | Vercel 100% versus 53% | Host caps (2 KB in Claude Code) decide whether the always-loaded text arrives |
| Guidance text in tool results? | Common practice; Anthropic recommends steering error text | No outcome study; models are trained to treat result text as information |
| MCP Apps or host-native widgets? | GitHub, HubSpot, Atlassian, Stripe adding UI | No builder has published measurements either way |
| Longer, more complete descriptions? | +5.85 points task success | +67% steps, 16.7% of cases worse; host prefixes cut the rest |

---

## 5. Open questions worth probing

- What claude.ai web and Desktop do with a tool description longer than 2,048 characters. Undocumented; the only host that could be read (Claude Code) cuts it.
- Whether Claude Code passes the text block to the model when `structuredContent` is present.
- Which hosts deliver elicitation, over which transport, and whether claude.ai retries MRTR `input_required`.
- Whether any host implements the Tasks extension yet.
- Whether "next steps" guidance in results changes outcomes; measurable with an A/B replay.

---

## Sources

Specification and maintainers: [versioning](https://modelcontextprotocol.io/specification/versioning);
changelogs [2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/changelog),
[2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/changelog),
[2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog);
[tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools);
[MRTR](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr);
[caching](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching);
[deprecated](https://modelcontextprotocol.io/specification/2026-07-28/deprecated);
[extensions](https://modelcontextprotocol.io/docs/extensions/overview);
[client matrix](https://modelcontextprotocol.io/extensions/client-matrix);
[Tasks](https://modelcontextprotocol.io/extensions/tasks/overview);
[Skills](https://modelcontextprotocol.io/extensions/skills/overview);
[MCP blog index](https://blog.modelcontextprotocol.io/posts/);
[roadmap](https://blog.modelcontextprotocol.io/posts/mcp-roadmap/).

Anthropic: [writing tools](https://www.anthropic.com/engineering/writing-tools-for-agents),
[context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents),
[skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills),
[code execution](https://www.anthropic.com/engineering/code-execution-with-mcp),
[advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use),
[evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents),
[Claude Code MCP](https://code.claude.com/docs/en/mcp),
[connector docs](https://claude.com/docs/connectors/building/index.md),
[review criteria](https://claude.com/docs/connectors/building/review-criteria.md),
[directory policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy),
[tool search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool),
[define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools),
[mcp-server-dev plugin](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/mcp-server-dev).

OpenAI: [plugins changelog](https://developers.openai.com/plugins/changelog),
[build MCP server](https://developers.openai.com/apps-sdk/build/mcp-server),
[reference](https://developers.openai.com/apps-sdk/reference),
[submission guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines),
[optimize metadata](https://developers.openai.com/apps-sdk/guides/optimize-metadata),
[function calling](https://developers.openai.com/api/docs/guides/function-calling).

Builders: [GitHub MCP server](https://github.com/github/github-mcp-server),
[Sentry MCP](https://github.com/getsentry/sentry-mcp), [cra.mr](https://cra.mr/),
[Cloudflare blog](https://blog.cloudflare.com/),
[Stripe MCP](https://docs.stripe.com/mcp),
[Notion](https://www.notion.com/blog/notions-hosted-mcp-server-an-inside-look),
[Block](https://engineering.block.xyz/blog/blocks-playbook-for-designing-mcp-servers),
[Supabase MCP](https://github.com/supabase-community/supabase-mcp),
[PostHog MCP](https://github.com/PostHog/posthog/tree/master/services/mcp),
[Datadog](https://www.datadoghq.com/blog/engineering/mcp-server-agent-tools/),
[Grafana MCP](https://github.com/grafana/mcp-grafana),
[Playwright MCP](https://github.com/microsoft/playwright-mcp),
[Context7](https://upstash.com/blog/new-context7),
[HubSpot](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server),
[Apollo](https://docs.apollo.io/docs/apollo-mcp),
[Vercel](https://vercel.com/blog/we-removed-80-percent-of-our-agents-tools),
[Speakeasy](https://www.speakeasy.com/blog/how-we-reduced-token-usage-by-100x-dynamic-toolsets-v2),
[Stainless](https://www.stainless.com/blog/sdk-code-mode/),
[Schmid](https://www.philschmid.de/mcp-best-practices).

Papers: [2602.14878](https://arxiv.org/abs/2602.14878) (smelly descriptions),
[2505.18135](https://arxiv.org/abs/2505.18135) (wording bias),
[2606.30775](https://arxiv.org/abs/2606.30775) (single rewrite),
[2602.20426](https://arxiv.org/abs/2602.20426) (Trace-Free+),
[2602.00933](https://arxiv.org/abs/2602.00933) (MCP-Atlas),
[2509.24002](https://arxiv.org/abs/2509.24002) (MCPMark),
[2505.03275](https://arxiv.org/abs/2505.03275) (RAG-MCP).
