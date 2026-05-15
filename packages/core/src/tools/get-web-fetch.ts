import type { LeadbayClient } from "../client.js";
import type { Tool, LeadWebFetchPayload } from "../types.js";
import { leadbay_get_web_fetch as GET_WEB_FETCH_DESCRIPTION } from "../tool-descriptions.generated.js";

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
  description: GET_WEB_FETCH_DESCRIPTION,
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
