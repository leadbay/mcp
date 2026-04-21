import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import type { PaginatedActivities } from "../types.js";

interface GetLeadActivitiesParams {
  leadId: string;
  count?: number;
}

export const getLeadActivities: Tool<GetLeadActivitiesParams> = {
  name: "leadbay_get_lead_activities",
  description:
    "Get prospecting activity history for a lead (emails sent, calls made, status changes, notes). Use this to avoid redundant outreach and understand where this lead is in the sales process.",
  inputSchema: {
    type: "object",
    properties: {
      leadId: {
        type: "string",
        description: "Lead UUID (required)",
      },
      count: {
        type: "number",
        description: "Number of activities to return, max 100 (default: 50)",
      },
    },
    required: ["leadId"],
  },
  execute: async (client: LeadbayClient, params: GetLeadActivitiesParams) => {
    const count = Math.min(params.count ?? 50, 100);

    const res = await client.request<PaginatedActivities>(
      "GET",
      `/leads/${params.leadId}/activities?count=${count}`
    );

    return {
      activities: res.items.map((a) => ({
        type: a.type,
        date: a.date,
      })),
      total: res.pagination.total,
    };
  },
};
