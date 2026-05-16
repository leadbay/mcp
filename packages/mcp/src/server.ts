import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ElicitRequestSchema,
  ElicitResultSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  CompleteRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { listPrompts, getPrompt } from "./prompts.js";
import { PROMPT_CATALOG_HEADER, PROMPT_CATALOG_BULLETS } from "./prompts.generated.js";
import {
  listResources,
  listResourceTemplates,
  readResource,
} from "./resources.js";
import {
  compositeReadTools,
  compositeWriteTools,
  granularReadTools,
  granularWriteTools,
  type BulkTracker,
  type LeadbayClient,
  type Tool,
  type ToolContext,
  type ToolLogger,
} from "@leadbay/core";

// SERVER_INSTRUCTIONS is now BUILT from the actual exposed tool set (see
// buildServerInstructions below). 0.2.x shipped a single static string that
// referenced tools the server may or may not have registered, which caused
// real user incidents (#3504): the agent system prompt told the model to call
// tools that weren't there. Each fragment below is concatenated only when the
// underlying tool is exposed.

const VERIFICATION_MANDATE =
  "After every email, call, message, or meeting with a lead's contact, you MUST call leadbay_report_outreach " +
  "with verification={source, ref} (gmail_message_id from the Gmail send, calendar_event_id from a booking, " +
  "or user_confirmed='<the user's literal confirmation>'). Skipping or fabricating verification poisons the " +
  "human team's pipeline.";

const MENTAL_MODEL_PARAGRAPH =
  "How Leadbay works (mental model): Leadbay is a sales inbox, not a queryable database. Each day the user " +
  "logs back in, a fresh batch of leads is delivered. Batch size is paced by how many leads the user has " +
  "actually acted on recently — some workflows produce a big stream of smaller prospects, others a narrow " +
  "stream of bigger ones. Pulling more won't produce more; the user acting on leads (outreach, skips, saves) does.";

function buildScoringParagraph(has: (name: string) => boolean): string {
  const base =
    "Two scoring layers: every lead has a basic `score` (firmographic — already decent, usually correlates " +
    "with AI). Roughly the top 10 of each batch are also AI-qualified (targeted web research + qualification " +
    "questions → `ai_agent_lead_score`, surfaced as `qualification_summary` on leadbay_pull_leads). Leads past " +
    "the top ~10 are not worse — the system is saving resources.";
  const deepenTools: string[] = [];
  if (has("leadbay_bulk_qualify_leads")) deepenTools.push("leadbay_bulk_qualify_leads for deeper qualification");
  if (has("leadbay_enrich_titles")) deepenTools.push("leadbay_enrich_titles for contacts");
  if (deepenTools.length > 0) {
    return base + ` Call ${deepenTools.join(" or ")} on any lead that looks worth it.`;
  }
  return base;
}

function buildStartHereParagraph(has: (name: string) => boolean): string {
  const base =
    "Start with leadbay_account_status to see the user's state, then leadbay_pull_leads to surface fresh leads. " +
    "Use leadbay_research_lead to dig into one lead deeply (qualification answers, signals, contacts).";
  const compositeNames = ["bulk_qualify_leads", "adjust_audience", "refine_prompt", "enrich_titles"]
    .filter((n) => has(`leadbay_${n}`));
  if (compositeNames.length > 0) {
    return (
      base +
      ` When the user wants more leads, narrower audience, refined criteria, or contact enrichment, use the matching ` +
      `composite tool (${compositeNames.join(" / ")}) — they hide lens permissions, region routing, polling, and selection state from you.`
    );
  }
  return (
    base +
    " When the user asks for refinement, contact enrichment, audience changes, or outreach reporting, tell them: " +
    "those actions require write tools, currently disabled. Re-enable by removing `LEADBAY_MCP_WRITE=0` from your " +
    "MCP client config and restarting the client. Also: do not promise to log outreach — the report_outreach tool " +
    "is not available in this configuration."
  );
}

function buildRhythmParagraph(has: (name: string) => boolean): string {
  if (has("leadbay_report_outreach")) {
    return (
      "Suggested rhythm: a healthy agent pattern is a daily check-in — pull fresh leads, skim the auto-qualified " +
      "top, deepen 1-3 promising ones, propose outreach to the user, then leadbay_report_outreach on what actually " +
      "got sent. If your host supports scheduling, offer to set up a daily run."
    );
  }
  return (
    "Suggested rhythm: a healthy agent pattern is a daily check-in — pull fresh leads, skim the auto-qualified " +
    "top, deepen 1-3 promising ones, propose outreach to the user. If your host supports scheduling, offer to set up a daily run."
  );
}

// The MCP prompt catalog itself (names, triggers, args) is generated by
// promptforge from the .md.tmpl front-matter and emitted to
// prompts.generated.ts as PROMPT_CATALOG_BULLETS (per-prompt one-liner) +
// PROMPT_CATALOG_HEADER (intro string). Filtering here preserves the
// iter-12 invariant: bullets that name a tool not in the exposed set are
// dropped entirely, so the agent never reads about a tool it can't call.
// A bullet's "own" prompt name is exempt (a prompt name like
// `leadbay_qualify_top_n` matches the regex but isn't a tool reference);
// references to OTHER prompt names (e.g. a discovery bullet pointing the
// follow-up flow to `leadbay_followup_check_in`) are also exempt since
// prompts are always exposed.
const TOOL_REFERENCE_PATTERN = /\bleadbay_[a-z][a-z0-9_]*\b/g;
const PROMPT_NAMES: ReadonlySet<string> = new Set(Object.keys(PROMPT_CATALOG_BULLETS));

function buildPromptsCatalogParagraph(has: (name: string) => boolean): string {
  const safeBullets: string[] = [];
  for (const [promptName, bullet] of Object.entries(PROMPT_CATALOG_BULLETS)) {
    const referencedTools = new Set<string>();
    for (const match of bullet.matchAll(TOOL_REFERENCE_PATTERN)) {
      const name = match[0];
      if (name === promptName) continue; // self-reference
      if (PROMPT_NAMES.has(name)) continue; // cross-prompt reference (always exposed)
      referencedTools.add(name);
    }
    const allExposed = [...referencedTools].every((n) => has(n));
    if (allExposed) safeBullets.push(bullet);
  }
  if (safeBullets.length === 0) return "";
  return [PROMPT_CATALOG_HEADER, "", ...safeBullets].join("\n");
}

const RESOURCES_PARAGRAPH =
  "Read-only resources (`resources/*`): three URI schemes are available — " +
  "`lead://{uuid}/profile` (lead profile by id), " +
  "`lens://{id}/definition` (filter + scoring config), " +
  "`org://taste-profile` (qualification questions + intent tags). " +
  "Capable clients cache these across turns — cheaper than re-running pull_leads / research_lead when the agent " +
  "already has the id. Capable clients can also call `resources/subscribe` (the server stores the subscription; " +
  "Leadbay's backend doesn't push deltas yet so notifications are not currently emitted) and " +
  "`completion/complete` for URI auto-complete on the templates.";

// iter-29: protocol-level primitives don't strictly need user-facing
// guidance text (a capable client handles them via SDK), but a brilliant
// human ships it because (a) some MCP hosts surface server-instructions to
// the agent verbatim and (b) the agent's mental model improves when it
// understands the *why* of the cancel/progress/elicit shapes rather than
// only the *what*.
//
// Tool-specific examples are conditional on the exposed set — we only
// reference tools the agent can actually call (preserves the iter-12
// invariant that buildServerInstructions never names unavailable tools).
function buildProtocolPrimitivesParagraph(has: (name: string) => boolean): string {
  const longRunners = [
    "bulk_qualify_leads",
    "import_and_qualify",
    "enrich_titles",
    "bulk_enrich_status",
    "qualify_status",
  ].filter((n) => has(`leadbay_${n}`));
  const elicitTools = [
    "refine_prompt clarifications",
    "report_outreach.user_confirmed",
  ].filter((label) => {
    if (label.startsWith("refine_prompt")) return has("leadbay_refine_prompt");
    if (label.startsWith("report_outreach")) return has("leadbay_report_outreach");
    return false;
  });

  const parts: string[] = ["Protocol primitives the server supports:"];

  if (longRunners.length > 0) {
    parts.push(
      "(1) `notifications/progress` — when you pass `_meta.progressToken` on a tools/call, long-running " +
        "composites stream per-unit-of-work progress with `progress`, `total`, and human-readable `message` " +
        `(e.g. 'Qualified Acme Corp (3/10)'). Pass a progressToken on ${longRunners
          .map((n) => `leadbay_${n}`)
          .join(", ")}.`
    );
  } else {
    parts.push(
      "(1) `notifications/progress` — when you pass `_meta.progressToken` on a tools/call, long-running " +
        "composites stream per-unit-of-work progress (none of the long-runners are currently exposed in " +
        "this configuration)."
    );
  }

  if (longRunners.length > 0) {
    parts.push(
      "(2) `notifications/cancelled` — when the user clicks Cancel in the host UI, the polling loop exits " +
        "within ≤2 seconds AND the bulk-store entry transitions to 'cancelled'; subsequent status polls " +
        "return `BULK_CANCELLED` so the agent stops polling."
    );
  } else {
    parts.push(
      "(2) `notifications/cancelled` — supported (no long-runners exposed in this configuration)."
    );
  }

  if (elicitTools.length > 0) {
    parts.push(
      `(3) \`elicitation/create\` — for ${elicitTools.join(
        " and "
      )} the SERVER asks the user via the client UI. The agent doesn't author the prompt or fabricate the response — the user types directly. The response carries \`confirmed_via: 'elicit' | 'agent_supplied' | 'non_user_confirmed'\` so the audit trail records which path was actually taken.`
    );
  }

  return parts.join(" ");
}

export function buildServerInstructions(exposed: Set<string>): string {
  const has = (name: string) => exposed.has(name);
  const parts: string[] = [];
  // Verification mandate stays first when report_outreach is exposed (UC test
  // asserts "report_outreach" appears in the first 200 chars of the default).
  if (has("leadbay_report_outreach")) {
    parts.push(VERIFICATION_MANDATE);
  }
  parts.push(MENTAL_MODEL_PARAGRAPH);
  parts.push(buildScoringParagraph(has));
  parts.push(buildStartHereParagraph(has));
  parts.push(buildRhythmParagraph(has));
  const promptsCatalog = buildPromptsCatalogParagraph(has);
  if (promptsCatalog) parts.push(promptsCatalog);
  parts.push(RESOURCES_PARAGRAPH);
  parts.push(buildProtocolPrimitivesParagraph(has));
  return parts.join("\n\n");
}

interface BuildServerOptions {
  includeAdvanced?: boolean;
  includeWrite?: boolean;
  logger?: ToolLogger;
  bulkTracker?: BulkTracker;
  // Server version reported on `initialize`. The CLI passes the build-time
  // package.json#version (via tsup's __LEADBAY_MCP_VERSION__ define) so this
  // stays in lock-step with the published package. Tests omit it and fall
  // back to the placeholder.
  version?: string;
  // Test-only escape hatch: extra tools to register alongside the
  // production catalog. Lets unit tests exercise signal/progress
  // wiring without depending on long-running real composites.
  // Production code does not pass this.
  extraTools?: Tool[];
}

function formatErrorForLLM(err: any): string {
  // LeadbayError shape: { error: true, code, message, hint, _meta? }
  if (err && typeof err === "object" && err.error === true) {
    const parts = [`${err.message}.`, err.hint];
    if (err._meta?.region) {
      parts.push(`(region=${err._meta.region}, endpoint=${err._meta.endpoint || "?"})`);
    }
    if (err._meta?.retry_after) {
      parts.push(`Retry after ${err._meta.retry_after}s.`);
    }
    return parts.filter(Boolean).join(" ").trim();
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function toolsListPayload(tools: Tool[]) {
  return tools.map((t) => {
    const out: Record<string, unknown> = {
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    };
    if (t.annotations) out.annotations = t.annotations;
    if (t.outputSchema) out.outputSchema = t.outputSchema;
    return out;
  });
}

export function buildServer(
  client: LeadbayClient,
  opts: BuildServerOptions = {}
): Server {
  const exposedTools: Tool[] = [];
  // Read composites — ALWAYS exposed.
  exposedTools.push(...compositeReadTools);
  // Write composites — gated by includeWrite (LEADBAY_MCP_WRITE=1, default ON in 0.3.0).
  if (opts.includeWrite) {
    exposedTools.push(...compositeWriteTools);
  }
  // Granular tools — gated by includeAdvanced (LEADBAY_MCP_ADVANCED=1).
  // Within advanced, write granulars are further gated by includeWrite.
  if (opts.includeAdvanced) {
    exposedTools.push(...granularReadTools);
    if (opts.includeWrite) {
      exposedTools.push(...granularWriteTools);
    }
  }
  // Test-only injection point.
  if (opts.extraTools) {
    exposedTools.push(...opts.extraTools);
  }

  // UC-3: leadbay_login is NEVER registered on MCP (prompt-injection vector).
  // It remains available only in the OpenClaw adapter.

  // Dedup by name (some tools may be referenced in multiple catalogues).
  const toolByName = new Map<string, Tool>();
  for (const t of exposedTools) {
    if (!toolByName.has(t.name) && t.name !== "leadbay_login") {
      toolByName.set(t.name, t);
    }
  }

  // Build instructions from the ACTUAL exposed name set so the agent system
  // prompt only references tools it can call.
  const exposedNames = new Set(toolByName.keys());
  const server = new Server(
    { name: "leadbay", version: opts.version ?? "0.0.0-dev" },
    {
      capabilities: {
        tools: {},
        prompts: {},
        // iter-28: advertise subscribe + listChanged on resources, plus
        // completions provider for URI auto-complete.
        resources: { subscribe: true, listChanged: true },
        completions: {},
      },
      instructions: buildServerInstructions(exposedNames),
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolsListPayload([...toolByName.values()]),
  }));

  // Prompts: pull-based slash commands the user can invoke directly.
  // See packages/mcp/src/prompts.ts for the catalog.
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: listPrompts(),
  }));
  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    return getPrompt(req.params.name, (req.params.arguments ?? {}) as Record<string, string | undefined>);
  });

  // Resources: URI-addressable read-only payloads (lead://, lens://, org://).
  // See packages/mcp/src/resources.ts.
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: listResources(),
  }));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: listResourceTemplates(),
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    return readResource(req.params.uri, client);
  });

  // iter-28: resources/subscribe + resources/unsubscribe.
  // The Leadbay backend has no push-update channel for lead profiles or
  // lenses, so the server's contract is "we accept the subscription and
  // *may* emit notifications/resources/updated when we know the
  // underlying state has changed." Today we never emit (no push); the
  // capability advertisement still lets clients build cache strategies
  // around it without needing a fallback. When the backend gains a
  // change-feed, this is the wire-up point.
  const subscribers = new Set<string>();
  server.setRequestHandler(SubscribeRequestSchema, async (req) => {
    subscribers.add(req.params.uri);
    opts.logger?.info?.(`resources.subscribe uri=${req.params.uri} subs=${subscribers.size}`);
    return {};
  });
  server.setRequestHandler(UnsubscribeRequestSchema, async (req) => {
    subscribers.delete(req.params.uri);
    opts.logger?.info?.(`resources.unsubscribe uri=${req.params.uri} subs=${subscribers.size}`);
    return {};
  });

  // iter-28: completion provider for resource templates (URI auto-complete).
  // When the agent is composing a `lead://{uuid}/profile` URI in a client UI,
  // the client can call completion/complete with the partial value; we offer
  // matching UUIDs from the user's last-active lens (best-effort, capped).
  server.setRequestHandler(CompleteRequestSchema, async (req) => {
    const ref = req.params.ref;
    const argName = req.params.argument?.name;
    const argValue = String(req.params.argument?.value ?? "");
    // Only resource templates supported (no prompt completions yet).
    if (ref.type !== "ref/resource") {
      return { completion: { values: [], total: 0, hasMore: false } };
    }
    try {
      // For lead URIs: surface up to 20 lead UUIDs from the active lens'
      // wishlist matching the partial value. Cheap fan-out.
      if (ref.uri === "lead://{uuid}/profile" && argName === "uuid") {
        const lensId = await client.resolveDefaultLens();
        const wish: any = await client.request<any>(
          "GET",
          `/lenses/${lensId}/leads/wishlist?count=50&page=0`
        );
        const ids = ((wish?.items ?? []) as Array<{ id: string }>)
          .map((i) => i.id)
          .filter((id) => id.toLowerCase().startsWith(argValue.toLowerCase()))
          .slice(0, 20);
        return {
          completion: { values: ids, total: ids.length, hasMore: false },
        };
      }
      // For lens URIs: surface lens ids matching the partial value.
      if (ref.uri === "lens://{id}/definition" && argName === "id") {
        const lenses: any = await client.request<any>("GET", "/lenses");
        const ids = ((lenses ?? []) as Array<{ id: number }>)
          .map((l) => String(l.id))
          .filter((id) => id.startsWith(argValue))
          .slice(0, 20);
        return {
          completion: { values: ids, total: ids.length, hasMore: false },
        };
      }
    } catch (err: any) {
      opts.logger?.warn?.(
        `completion provider error: ${err?.message ?? err?.code ?? err}`
      );
    }
    return { completion: { values: [], total: 0, hasMore: false } };
  });

  // iter-26: per-tool-call observability hook. Off by default; enabled via
  // LEADBAY_DEBUG=1 (or "true"). Emits one stderr line per CallTool with
  // tool name + duration + success flag + result-bytes. stderr keeps the
  // stdio JSON-RPC stream (stdout) clean; cost when disabled is one truthy
  // env var read per call.
  const DEBUG_RAW = process.env.LEADBAY_DEBUG ?? "";
  const DEBUG_ON = DEBUG_RAW === "1" || DEBUG_RAW.toLowerCase() === "true";

  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const debugStart = DEBUG_ON ? Date.now() : 0;
    const name = req.params.name;
    const tool = toolByName.get(name);
    if (!tool) {
      return {
        content: [
          {
            type: "text",
            text: `Unknown Leadbay tool: ${name}. Available: ${[...toolByName.keys()].join(", ")}.`,
          },
        ],
        isError: true,
      };
    }

    const args = (req.params.arguments ?? {}) as any;
    // MCP 2025-11-25 §Progress: when the client passes a progressToken
    // in _meta, capable composites can stream notifications/progress
    // updates back. Cheap default: progress is undefined when the client
    // didn't request it. Errors swallowed (log to stderr) so a flaky
    // transport never bubbles up as a tool failure.
    const progressToken = (req.params as any)?._meta?.progressToken;
    const progress: ToolContext["progress"] = progressToken !== undefined
      ? (params) => {
          extra
            .sendNotification({
              method: "notifications/progress",
              params: {
                progressToken,
                progress: params.progress,
                ...(params.total !== undefined ? { total: params.total } : {}),
                ...(params.message !== undefined ? { message: params.message } : {}),
              },
            })
            .catch((err: any) => {
              opts.logger?.warn?.(
                `progress emit failed: ${err?.message ?? err?.code ?? String(err)}`
              );
            });
        }
      : undefined;
    // MCP 2025-11-25 §Elicitation: composites that need a one-off user
    // answer (refine_prompt's clarification, report_outreach's
    // user_confirmed) can call ctx.elicit instead of returning a
    // "please call answer_X" telephone payload. Calls extra.sendRequest
    // with the spec form-based ElicitRequestSchema. Errors propagate
    // (composite null-checks ctx.elicit before calling, and any
    // capability-mismatch reject is surfaced).
    const elicit: ToolContext["elicit"] = async (params) => {
      const result = await extra.sendRequest(
        {
          method: "elicitation/create",
          params: {
            message: params.message,
            requestedSchema: params.requestedSchema as any,
          },
        },
        ElicitResultSchema
      );
      return {
        action: result.action,
        content: result.content as Record<string, unknown> | undefined,
      };
    };
    try {
      // MCP 2025-11-25 §Cancellation: extra.signal is aborted by the SDK
      // when the client sends `notifications/cancelled`. Plumbing it to
      // ToolContext.signal lets long-running composites (bulk_qualify_leads,
      // enrich_titles, import_and_qualify) actually stop polling when the
      // user clicks Cancel in Claude Desktop / Cursor.
      const result = await tool.execute(client, args, {
        logger: opts.logger,
        bulkTracker: opts.bulkTracker,
        signal: extra.signal,
        progress,
        elicit,
      });
      // Leadbay tools may return error envelopes ({ error: true, code, ... })
      // rather than throwing. Surface those as MCP isError so the LLM doesn't
      // treat them as success.
      if (
        result &&
        typeof result === "object" &&
        (result as any).error === true
      ) {
        return {
          content: [
            { type: "text", text: formatErrorForLLM(result) },
          ],
          isError: true,
        };
      }

      // iter-25: MarkdownEnvelope from response_format='markdown' — the
      // composite-side opt-in for chat-rendering agents. The text content
      // becomes the rendered markdown; structuredContent stays as the
      // typed payload so capable clients still get type-safe access.
      const isMarkdownEnvelope =
        result &&
        typeof result === "object" &&
        (result as any).__markdown_envelope === true &&
        typeof (result as any).markdown === "string";
      if (isMarkdownEnvelope) {
        const env = result as { markdown: string; structured: Record<string, unknown> };
        const out: Record<string, unknown> = {
          content: [{ type: "text", text: env.markdown }],
        };
        // Emit the structured payload via structuredContent if the tool
        // declared outputSchema (so capable clients still see the typed
        // shape they expect).
        if (
          tool.outputSchema &&
          env.structured !== null &&
          typeof env.structured === "object" &&
          !Array.isArray(env.structured)
        ) {
          out.structuredContent = env.structured;
        }
        if (DEBUG_ON) {
          const dur = Date.now() - debugStart;
          const bytes = env.markdown.length;
          process.stderr.write(
            `[leadbay-mcp debug] tool=${name} dur=${dur}ms ok=true bytes=${bytes} format=markdown\n`
          );
        }
        return out;
      }

      const response: Record<string, unknown> = {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
      };
      // MCP 2025-11-25 §Tools: when the tool declares outputSchema, send a
      // matching `structuredContent` block alongside the text so capable
      // clients can consume the typed payload without re-parsing. Only emit
      // for plain-object results (the spec requires structuredContent to be
      // an object). Arrays and primitives stay text-only.
      if (
        tool.outputSchema &&
        result !== null &&
        typeof result === "object" &&
        !Array.isArray(result)
      ) {
        response.structuredContent = result;
      }
      if (DEBUG_ON) {
        const dur = Date.now() - debugStart;
        const text = (response.content as any)[0]?.text ?? "";
        const bytes = typeof text === "string" ? text.length : 0;
        process.stderr.write(
          `[leadbay-mcp debug] tool=${name} dur=${dur}ms ok=true bytes=${bytes}\n`
        );
      }
      return response;
    } catch (err: any) {
      if (DEBUG_ON) {
        const dur = Date.now() - debugStart;
        const code = err?.code ?? err?.name ?? "Error";
        process.stderr.write(
          `[leadbay-mcp debug] tool=${name} dur=${dur}ms ok=false code=${code}\n`
        );
      }
      return {
        content: [
          { type: "text", text: formatErrorForLLM(err) },
        ],
        isError: true,
      };
    }
  });

  return server;
}
