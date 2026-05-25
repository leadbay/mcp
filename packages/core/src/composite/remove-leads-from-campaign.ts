/**
 * leadbay_remove_leads_from_campaign — DELETE /campaigns/{id}/leads
 *
 * Removes one or more leads from a campaign. The backend returns
 * `{removed, not_present}` so the agent can surface the no-op count
 * separately ("2 removed, 1 was not in the campaign").
 */
import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";

import { leadbay_remove_leads_from_campaign as REMOVE_LEADS_DESCRIPTION } from "../tool-descriptions.generated.js";

interface RemoveLeadsParams {
  campaign_id: string;
  lead_ids: string[];
}

interface RemoveLeadsResponse {
  removed: number;
  not_present: number;
}

export const removeLeadsFromCampaign: Tool<RemoveLeadsParams> = {
  name: "leadbay_remove_leads_from_campaign",
  annotations: {
    title: "Remove leads from a campaign",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: REMOVE_LEADS_DESCRIPTION,
  optional: true,
  inputSchema: {
    type: "object",
    properties: {
      campaign_id: {
        type: "string",
        description: "Campaign UUID (from leadbay_create_campaign or leadbay_list_campaigns).",
      },
      lead_ids: {
        type: "array",
        description:
          "Lead UUIDs to remove. Unknown UUIDs are counted in `not_present` — they do not cause an error.",
        items: { type: "string" },
        minItems: 1,
      },
    },
    required: ["campaign_id", "lead_ids"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      removed: { type: "number", description: "Leads successfully detached from the campaign." },
      not_present: { type: "number", description: "Lead IDs that were not in the campaign — no-op." },
    },
    required: ["removed", "not_present"],
  },
  execute: async (client: LeadbayClient, params: RemoveLeadsParams) => {
    if (!params.lead_ids || params.lead_ids.length === 0) {
      throw client.makeError(
        "INVALID_PARAMS",
        "lead_ids must be a non-empty array",
        "Pass at least one lead UUID to remove.",
      );
    }
    const result = await client.request<RemoveLeadsResponse>(
      "DELETE",
      `/campaigns/${params.campaign_id}/leads`,
      { lead_ids: params.lead_ids },
    );
    return result;
  },
};
