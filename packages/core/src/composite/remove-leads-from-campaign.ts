/**
 * leadbay_remove_leads_from_campaign — DELETE /campaigns/{id}/leads
 *
 * Removes one or more leads from a campaign. The backend returns 204
 * (no body), so we return a synthetic {removed} count based on how
 * many lead_ids were submitted.
 */
import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";

import { leadbay_remove_leads_from_campaign as REMOVE_LEADS_DESCRIPTION } from "../tool-descriptions.generated.js";

interface RemoveLeadsParams {
  campaign_id: string;
  lead_ids: string[];
}

export const removeLeadsFromCampaign: Tool<RemoveLeadsParams> = {
  name: "leadbay_remove_leads_from_campaign",
  annotations: {
    title: "Remove leads from a campaign",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
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
          "Lead UUIDs to remove. Pass IDs sourced from Leadbay tools; invalid IDs are handled by the backend.",
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
      removed: { type: "number", description: "Number of leads submitted for removal (backend returns 204, no per-lead breakdown)." },
    },
    required: ["removed"],
  },
  execute: async (client: LeadbayClient, params: RemoveLeadsParams) => {
    if (!params.lead_ids || params.lead_ids.length === 0) {
      throw client.makeError(
        "INVALID_PARAMS",
        "lead_ids must be a non-empty array",
        "Pass at least one lead UUID to remove.",
      );
    }
    await client.requestVoid(
      "DELETE",
      `/campaigns/${params.campaign_id}/leads`,
      { lead_ids: params.lead_ids },
    );
    return { removed: params.lead_ids.length };
  },
};
