// IMPORTANT: /leads/selection/select takes leadIds as REPEATED QUERY PARAMS,
// not as a JSON body. A naive `body: {leadIds: [...]}` returns 400 "missing
// 'leadIds' parameter". This was confirmed by live probe (see
// .context/leadbay-live-shapes/SHAPE-DRIFT.md). Don't "fix" the lack of body.

import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { leadbay_select_leads as SELECT_LEADS_DESCRIPTION } from "../tool-descriptions.generated.js";

interface SelectLeadsParams {
  leadIds: string[];
}

export const selectLeads: Tool<SelectLeadsParams> = {
  name: "leadbay_select_leads",
  annotations: {
    title: "Select leads",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: SELECT_LEADS_DESCRIPTION,
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      leadIds: {
        type: "array",
        items: { type: "string" },
        description: "Lead UUIDs to add to selection (1-1000)",
        minItems: 1,
        maxItems: 1000,
      },
    },
    required: ["leadIds"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      selected: {
        type: "number",
        description: "How many leadIds the call added to the selection (echoes input length).",
      },
    },
    required: ["selected"],
  },
  execute: async (client: LeadbayClient, params: SelectLeadsParams) => {
    const qs = params.leadIds
      .map((id) => `leadIds=${encodeURIComponent(id)}`)
      .join("&");
    await client.requestVoid("POST", `/leads/selection/select?${qs}`);
    return { selected: params.leadIds.length };
  },
};
