import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { listPrompts, getPrompt } from "./prompts.js";
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
  return parts.join("\n\n");
}

interface BuildServerOptions {
  includeAdvanced?: boolean;
  includeWrite?: boolean;
  logger?: ToolLogger;
  bulkTracker?: BulkTracker;
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
    { name: "leadbay", version: "0.3.0" },
    {
      capabilities: { tools: {}, prompts: {} },
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

  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
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
      return response;
    } catch (err: any) {
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
