/**
 * leadbay_add_leads_to_campaign — POST /campaigns/{id}/leads
 *
 * Idempotent at the lead level: the server dedups against existing
 * campaign_leads and returns `{added, already_present}` so the agent
 * can render the no-op count separately ("3 added, 2 already in the
 * campaign").
 */
import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";

import { leadbay_add_leads_to_campaign as ADD_LEADS_DESCRIPTION } from "../tool-descriptions.generated.js";

interface AddLeadsParams {
  campaign_id: string;
  lead_ids: string[];
}

interface AddLeadsResponse {
  added: number;
  already_present: number;
}

export const addLeadsToCampaign: Tool<AddLeadsParams> = {
  name: "leadbay_add_leads_to_campaign",
  annotations: {
    title: "Add leads to an existing campaign",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: ADD_LEADS_DESCRIPTION,
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
          "Lead UUIDs to add. Backend rejects unknown lead UUIDs with 404 — pass UUIDs sourced from pull_leads / pull_followups / tour_plan / research.",
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
      added: { type: "number", description: "Leads newly attached." },
      already_present: { type: "number", description: "Leads that were already in this campaign — no-op." },
    },
    required: ["added", "already_present"],
  },
  execute: async (client: LeadbayClient, params: AddLeadsParams) => {
    if (!params.lead_ids || params.lead_ids.length === 0) {
      throw client.makeError(
        "INVALID_PARAMS",
        "lead_ids must be a non-empty array",
        "Pass at least one lead UUID to add. To create an empty campaign, use leadbay_create_campaign with lead_ids: [].",
      );
    }
    const result = await client.request<AddLeadsResponse>(
      "POST",
      `/campaigns/${params.campaign_id}/leads`,
      { lead_ids: params.lead_ids },
    );
    return result;
  },
};
