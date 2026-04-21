import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  compositeTools,
  granularTools,
  type LeadbayClient,
  type Tool,
  type ToolLogger,
} from "@leadbay/core";

export const SERVER_INSTRUCTIONS =
  "Leadbay is a B2B lead-gen platform. Use these tools to find prospects, " +
  "research companies, and prepare outreach based on the user's Ideal Buyer Profile.\n\n" +
  "Recommended flow:\n" +
  "1. leadbay_find_prospects — discovery (returns scored leads)\n" +
  "2. leadbay_research_company — deep-dive on a lead (profile + contacts + activity)\n" +
  "3. leadbay_prepare_outreach — assemble a contact package for the recommended contact\n\n" +
  "The 11 granular tools (leadbay_list_lenses, leadbay_discover_leads, " +
  "leadbay_get_lead_profile, etc.) map 1:1 to Leadbay API endpoints and are " +
  "available if LEADBAY_MCP_ADVANCED=1 is set. Most tasks do not need them.";

interface BuildServerOptions {
  includeAdvanced?: boolean;
  logger?: ToolLogger;
}

function formatErrorForLLM(err: any): string {
  // LeadbayError shape: { error: true, code, message, hint }
  if (err && typeof err === "object" && err.error === true) {
    return `${err.message}. ${err.hint}`.trim();
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
    { name: "leadbay", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  const exposedTools: Tool[] = opts.includeAdvanced
    ? [...compositeTools, ...granularTools.filter((t) => t.name !== "leadbay_login")]
    : [...compositeTools];

  // UC-3: leadbay_login is NEVER registered on MCP (prompt-injection vector).
  // It remains available only in the OpenClaw adapter.

  const toolByName = new Map(exposedTools.map((t) => [t.name, t]));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolsListPayload(exposedTools),
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
      const result = await tool.execute(client, args, { logger: opts.logger });
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
