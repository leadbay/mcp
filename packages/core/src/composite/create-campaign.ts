/**
 * leadbay_create_campaign — POST /campaigns
 *
 * Wraps the Campaigns API discovered in .context/campaigns-probe/API.md.
 * Body is snake_case (apiJson uses JsonNamingStrategy.SnakeCase).
 *
 * `name` is optional — if omitted with non-empty lead_ids, the backend
 * runs SuggestCampaignName.generate() to AI-pick one. With empty
 * lead_ids and no name, the backend falls back to a default.
 */
import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";

import { leadbay_create_campaign as CREATE_CAMPAIGN_DESCRIPTION } from "../tool-descriptions.generated.js";

interface CreateCampaignParams {
  name?: string;
  lead_ids?: string[];
}

// Server returns CampaignPayload (snake_case via apiJson).
interface CampaignResponse {
  id: string;
  name: string;
  ai_generated_name?: string | null;
  ai_name_count: number;
  archived: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_accessed_at: string;
}

export const createCampaign: Tool<CreateCampaignParams> = {
  name: "leadbay_create_campaign",
  annotations: {
    title: "Create a named campaign (optionally seeded with leads)",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  description: CREATE_CAMPAIGN_DESCRIPTION,
  optional: true, // gated behind LEADBAY_MCP_WRITE=1 in MCP
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "Campaign display name (max 255 chars). Omit to let the backend AI-generate one from the seed lead_ids. If lead_ids is empty AND name is omitted, the backend assigns a default.",
      },
      lead_ids: {
        type: "array",
        description:
          "Lead UUIDs to attach at creation. Empty array (default) creates an empty campaign — add leads later via leadbay_add_leads_to_campaign. Non-empty seed enables AI name suggestion.",
        items: { type: "string" },
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Campaign UUID." },
      name: { type: "string" },
      ai_generated_name: { type: ["string", "null"] },
      ai_name_count: { type: "number" },
      archived: { type: "boolean" },
      created_by: { type: "string" },
      created_at: { type: "string" },
      updated_at: { type: "string" },
      last_accessed_at: { type: "string" },
    },
    required: ["id", "name", "created_at"],
  },
  execute: async (client: LeadbayClient, params: CreateCampaignParams) => {
    const body: Record<string, unknown> = {
      lead_ids: params.lead_ids ?? [],
    };
    if (params.name && params.name.trim().length > 0) {
      body.name = params.name.slice(0, 255);
    }
    const result = await client.request<CampaignResponse>(
      "POST",
      `/campaigns`,
      body,
    );
    return result;
  },
};
