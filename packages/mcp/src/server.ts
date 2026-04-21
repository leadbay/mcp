import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  compositeReadTools,
  compositeWriteTools,
  granularReadTools,
  granularWriteTools,
  type BulkTracker,
  type LeadbayClient,
  type Tool,
  type ToolLogger,
} from "@leadbay/core";

// Lead-paragraph mandate is the first thing the agent reads — followed by
// three sentences, then per-tool descriptions carry the runbook detail.
export const SERVER_INSTRUCTIONS =
  "After every email, call, message, or meeting with a lead's contact, you MUST call leadbay_report_outreach " +
  "with verification={source, ref} (gmail_message_id from the Gmail send, calendar_event_id from a booking, " +
  "or user_confirmed='<the user's literal confirmation>'). Skipping or fabricating verification poisons the " +
  "human team's pipeline.\n\n" +
  "Start with leadbay_account_status to see the user's state, then leadbay_pull_leads to surface fresh leads. " +
  "Use leadbay_research_lead to dig into one lead deeply (qualification answers, signals, contacts). " +
  "When the user wants more leads, narrower audience, refined criteria, or contact enrichment, use the matching " +
  "composite tool (bulk_qualify_leads / adjust_audience / refine_prompt / enrich_titles) — they hide lens " +
  "permissions, region routing, polling, and selection state from you.";

interface BuildServerOptions {
  includeAdvanced?: boolean;
  includeWrite?: boolean;
  logger?: ToolLogger;
  bulkTracker?: BulkTracker;
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
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

export function buildServer(
  client: LeadbayClient,
  opts: BuildServerOptions = {}
): Server {
  const server = new Server(
    { name: "leadbay", version: "0.2.0" },
    {
      capabilities: { tools: {} },
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  const exposedTools: Tool[] = [];
  // Read composites — ALWAYS exposed.
  exposedTools.push(...compositeReadTools);
  // Write composites — gated by includeWrite (LEADBAY_MCP_WRITE=1).
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

  // UC-3: leadbay_login is NEVER registered on MCP (prompt-injection vector).
  // It remains available only in the OpenClaw adapter.

  // Dedup by name (some tools may be referenced in multiple catalogues).
  const toolByName = new Map<string, Tool>();
  for (const t of exposedTools) {
    if (!toolByName.has(t.name) && t.name !== "leadbay_login") {
      toolByName.set(t.name, t);
    }
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolsListPayload([...toolByName.values()]),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
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
    try {
      const result = await tool.execute(client, args, {
        logger: opts.logger,
        bulkTracker: opts.bulkTracker,
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
      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
      };
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
