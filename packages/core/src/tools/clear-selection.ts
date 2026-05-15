import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { leadbay_clear_selection as CLEAR_SELECTION_DESCRIPTION } from "../tool-descriptions.generated.js";

export const clearSelection: Tool<Record<string, never>> = {
  name: "leadbay_clear_selection",
  annotations: {
    title: "Clear selection",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: CLEAR_SELECTION_DESCRIPTION,
  optional: true,
  write: true,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  execute: async (client: LeadbayClient) => {
    await client.requestVoid("POST", "/leads/selection/clear");
    return { cleared: true };
  },
};
