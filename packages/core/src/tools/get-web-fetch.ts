import type { LeadbayClient } from "../client.js";
import type { Tool, LeadWebFetchPayload } from "../types.js";

interface GetWebFetchParams {
  leadId: string;
}

export const getWebFetch: Tool<GetWebFetchParams> = {
  name: "leadbay_get_web_fetch",
  annotations: {
    title: "Read web-fetch result",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description:
    "Read the AI-generated web-research summary for a lead — company profile, business signals, prospecting clues, " +
    "each with sources and 'hot' flags marking high-signal recent items. The content is dictioned by emoji-prefixed " +
    "section labels in the raw API. " +
    "When to use: when the agent already qualified this lead and wants the underlying research to reason from. " +
    "When NOT to use: as the first read on a lead — the leadbay_research_lead composite bundles this with qualification " +
    "answers and reshapes the dict into a stable array form.",
  inputSchema: {
    type: "object",
    properties: { leadId: { type: "string", description: "Lead UUID (required)" } },
    required: ["leadId"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    description:
      "Raw LeadWebFetchPayload as returned by /leads/{id}/web_fetch. Permissive shape — backend dict structure is documented in detail by leadbay_research_lead which reshapes it.",
    properties: {
      content: {
        description: "Backend dict content (object or string), or null when no fetch yet.",
      },
      fetch_at: {
        description: "ISO timestamp of the most recent fetch (string or null).",
      },
      status: {
        type: "string",
        description: "'pending' | 'complete' | 'failed' (when present).",
      },
      signals: {
        type: "array",
        description: "Optional reshaped signals when the backend returns them.",
        items: { type: "object" },
      },
    },
  },
  execute: async (client: LeadbayClient, params: GetWebFetchParams) => {
    return await client.request<LeadWebFetchPayload>(
      "GET",
      `/leads/${params.leadId}/web_fetch`
    );
  },
};
