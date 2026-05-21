/**
 * leadbay_list_campaigns — GET /campaigns
 *
 * Returns CampaignWithStatsPayload[] — each entry is the campaign +
 * roll-up counts (leads, contacts, contacted, meetings booked,
 * declined). This is the manager's "what's in flight" view.
 *
 * Scoped to the caller: backend `Database.campaigns.listForUser(orgId,
 * userId)` filters by creator. Other users in the same org with their
 * own campaigns aren't visible here.
 */
import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";

import { leadbay_list_campaigns as LIST_CAMPAIGNS_DESCRIPTION } from "../tool-descriptions.generated.js";

interface ListCampaignsParams {
  archived?: boolean;
}

interface CampaignSummary {
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

interface CampaignWithStats {
  campaign: CampaignSummary;
  lead_count: number;
  contact_count: number;
  contacted: number;
  meeting_booked: number;
  declined: number;
}

export const listCampaigns: Tool<ListCampaignsParams> = {
  name: "leadbay_list_campaigns",
  annotations: {
    title: "List your campaigns (with roll-up stats)",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: LIST_CAMPAIGNS_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      archived: {
        type: "boolean",
        description: "Include archived campaigns only. Default false (active only).",
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      campaigns: {
        type: "array",
        description:
          "Each entry is {campaign, lead_count, contact_count, contacted, meeting_booked, declined}. `contacted` = leads with at least one logged outreach; `meeting_booked` = leads with a recorded meeting outcome; `declined` = leads with a recorded decline outcome.",
        items: { type: "object" },
      },
      _meta: {
        type: "object",
        properties: {
          region: { type: "string" },
          latency_ms: { type: ["number", "null"] },
        },
      },
    },
    required: ["campaigns"],
  },
  execute: async (client: LeadbayClient, params: ListCampaignsParams) => {
    const archived = params.archived ?? false;
    const qs = archived ? "?archived=true" : "";
    const campaigns = await client.request<CampaignWithStats[]>(
      "GET",
      `/campaigns${qs}`,
    );
    return {
      campaigns,
      _meta: {
        region: client.region,
        latency_ms: client.lastMeta?.latency_ms ?? null,
      },
    };
  },
};
