import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { leadbay_like_lead as LIKE_LEAD_DESCRIPTION } from "../tool-descriptions.generated.js";

interface LikeLeadParams {
  lead_id: string;
}

export const likeLead: Tool<LikeLeadParams> = {
  name: "leadbay_like_lead",
  annotations: {
    title: "Like a lead",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: LIKE_LEAD_DESCRIPTION,
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      lead_id: {
        type: "string",
        description: "UUID of the lead to like.",
      },
    },
    required: ["lead_id"],
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: LikeLeadParams) => {
    await client.requestVoid("POST", `/leads/${params.lead_id}/like`);
    return { applied: true, lead_id: params.lead_id, action: "liked" };
  },
};
