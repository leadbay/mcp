import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { leadbay_remove_pushback as REMOVE_PUSHBACK_DESCRIPTION } from "../tool-descriptions.generated.js";

interface RemovePushbackParams {
  lead_ids: string[];
}

export const removePushback: Tool<RemovePushbackParams> = {
  name: "leadbay_remove_pushback",
  annotations: {
    title: "Remove pushback (un-snooze) leads",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: REMOVE_PUSHBACK_DESCRIPTION,
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      lead_ids: {
        type: "array",
        items: { type: "string" },
        description: "Lead UUIDs",
      },
    },
    required: ["lead_ids"],
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: RemovePushbackParams) => {
    await client.requestVoid("POST", "/leads/remove_pushback", {
      lead_ids: params.lead_ids,
    });
    return { cleared: true, count: params.lead_ids.length };
  },
};
