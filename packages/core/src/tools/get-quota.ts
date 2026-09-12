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
        type: ["object", "null"],
        description: "Org-level quota state. Admin-only; null for non-admin callers (use `user`).",
        properties: {
          spend: {
            type: "array",
            description:
              "Per-window DOLLAR-SPEND gauge. Each: {current_units, max_units, window_type, resets_at} in dollar_cents — % used = current_units/max_units, $ = /100. Empty when the org has no OVERALL_SPEND (COST_CENTS) quota provisioned (internal/free orgs).",
            items: { type: "object" },
          },
          resources: {
            type: "array",
            description:
              "Per-resource per-window USAGE. Each: {resource_type, count, max_units, window_type, resets_at}. `count` is the amount USED in that window (not remaining). `max_units` is the per-resource cap when a count-quota is provisioned, else null.",
            items: { type: "object" },
          },
        },
      },
      user: {
        type: ["object", "null"],
        description: "User-level quota state, same shape as `org`. Present for every caller. May be absent.",
        properties: {
          spend: { type: "array", items: { type: "object" } },
          resources: { type: "array", items: { type: "object" } },
        },
      },
      topup: {
        type: ["object", "null"],
        description:
          "Active top-up balance, or null. {remaining_cents, total_credit_cents} in dollar_cents. Top-ups clear throttles immediately, outside the windows.",
        properties: {
          remaining_cents: { type: "number" },
          total_credit_cents: { type: "number" },
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
