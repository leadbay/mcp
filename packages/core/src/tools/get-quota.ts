import type { LeadbayClient } from "../client.js";
import type { Tool, QuotaStatusPayload } from "../types.js";
import { leadbay_get_quota as GET_QUOTA_DESCRIPTION } from "../tool-descriptions.generated.js";

export const getQuota: Tool<Record<string, never>> = {
  name: "leadbay_get_quota",
  annotations: {
    title: "Read quota status",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: GET_QUOTA_DESCRIPTION,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: {
    type: "object",
    properties: {
      plan: { type: ["string", "null"], description: "Org plan tier (e.g., FREE, PRO)." },
      windows: {
        type: "array",
        description:
          "Per-resource per-window limits. Each: {resource, window, current_units, max_units, resets_at}.",
        items: { type: "object" },
      },
    },
  },
  execute: async (client: LeadbayClient) => {
    const orgId = await client.resolveOrgId();
    return await client.request<QuotaStatusPayload>(
      "GET",
      `/organizations/${orgId}/quota_status`
    );
  },
};
