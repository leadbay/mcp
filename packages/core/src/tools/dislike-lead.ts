import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { leadbay_dislike_lead as DISLIKE_LEAD_DESCRIPTION } from "../tool-descriptions.generated.js";

interface DislikeLeadParams {
  lead_id: string;
}

export const dislikeLead: Tool<DislikeLeadParams> = {
  name: "leadbay_dislike_lead",
  annotations: {
    title: "Dislike a lead",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: DISLIKE_LEAD_DESCRIPTION,
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      lead_id: {
        type: "string",
        description: "UUID of the lead to dislike.",
      },
    },
    required: ["lead_id"],
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: DislikeLeadParams) => {
    await client.requestVoid("POST", `/leads/${params.lead_id}/dislike`);
    return { applied: true, lead_id: params.lead_id, action: "disliked" };
  },
};
