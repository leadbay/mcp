import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { leadbay_get_selection_ids as GET_SELECTION_IDS_DESCRIPTION } from "../tool-descriptions.generated.js";

export const getSelectionIds: Tool<Record<string, never>> = {
  name: "leadbay_get_selection_ids",
  annotations: {
    title: "Read selection ids",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: GET_SELECTION_IDS_DESCRIPTION,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  execute: async (client: LeadbayClient) => {
    return await client.request<string[]>("GET", "/leads/selection/ids");
  },
};
