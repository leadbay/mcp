import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import type { UserMePayload } from "../types.js";

export const getQuota: Tool<Record<string, never>> = {
  name: "leadbay_get_quota",
  description:
    "Check organization billing and AI credit quota. Useful before enrichment or qualification operations to verify available credits.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  execute: async (client: LeadbayClient) => {
    const me = await client.request<UserMePayload>("GET", "/users/me");
    const org = me.organization;
    return {
      org_name: org.name,
      ai_credits: org.billing?.ai_credits ?? null,
      ai_credits_quota: org.billing?.ai_credits_quota ?? null,
      billing_status: org.billing?.status ?? "unknown",
    };
  },
};
