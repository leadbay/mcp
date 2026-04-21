import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import type { LensPayload } from "../types.js";

export const listLenses: Tool<Record<string, never>> = {
  name: "leadbay_list_lenses",
  description:
    "List all available Leadbay lenses (saved lead search configurations). Each lens defines a different target market or buyer segment. The lens with is_last_active=true is used by default for lead discovery.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  execute: async (client: LeadbayClient) => {
    const lenses = await client.request<LensPayload[]>("GET", "/lenses");
    return {
      lenses: lenses.map((l) => ({
        id: l.id,
        name: l.name,
        is_last_active: l.is_last_active,
        description: l.description,
      })),
    };
  },
};
