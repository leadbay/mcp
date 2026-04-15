import type { LeadbayClient } from "../client.js";
import type { LensPayload } from "../types.js";

export function registerListLenses(api: any, client: LeadbayClient) {
  api.registerTool({
    name: "leadbay_list_lenses",
    description:
      "List all available Leadbay lenses (saved lead search configurations). Each lens defines a different target market or buyer segment. The lens with is_last_active=true is used by default for lead discovery.",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: async () => {
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
  });
}
