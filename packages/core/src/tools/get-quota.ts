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
      plan: {
        type: ["string", "null"],
        description: "Org plan tier (e.g., FREE, TIER1, TIER2). May be null.",
      },
      org: {
        type: "object",
        description: "Org-level quota state.",
        properties: {
          spend: { type: "array", description: "Reserved; empty in practice.", items: { type: "object" } },
          resources: {
            type: "array",
            description:
              "Per-resource per-window USAGE. Each: {resource_type, count, window_type, resets_at}. `count` is the amount USED in that window (not remaining, not a cap). No cap field is returned by the API.",
            items: { type: "object" },
          },
        },
      },
      user: {
        type: "object",
        description: "User-level quota state, same shape as `org`. May be absent.",
        properties: {
          spend: { type: "array", items: { type: "object" } },
          resources: { type: "array", items: { type: "object" } },
        },
      },
      // Legacy/compat: the live API does NOT return a top-level `windows`
      // array — usage lives in org/user.resources[]. Declared only so older
      // recorded fixtures still conform; do not rely on it.
      windows: {
        type: "array",
        description: "Deprecated — not returned by the live API. Use org/user.resources[].",
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
