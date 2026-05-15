import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import type { PaginatedActivities } from "../types.js";
import { leadbay_get_lead_activities as GET_LEAD_ACTIVITIES_DESCRIPTION } from "../tool-descriptions.generated.js";

interface GetLeadActivitiesParams {
  leadId: string;
  count?: number;
}

export const getLeadActivities: Tool<GetLeadActivitiesParams> = {
  name: "leadbay_get_lead_activities",
  annotations: {
    title: "Read a lead's activity feed",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: GET_LEAD_ACTIVITIES_DESCRIPTION,
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
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      activities: {
        type: "array",
        description: "Activity entries. Each: {type, date}. Older activities trimmed by `count`.",
        items: {
          type: "object",
          properties: {
            type: { type: "string" },
            date: { type: "string" },
          },
        },
      },
      total: {
        type: "number",
        description: "Total activity count for this lead (across all pages).",
      },
    },
    required: ["activities", "total"],
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
