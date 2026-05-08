// IMPORTANT: /leads/selection/select takes leadIds as REPEATED QUERY PARAMS,
// not as a JSON body. A naive `body: {leadIds: [...]}` returns 400 "missing
// 'leadIds' parameter". This was confirmed by live probe (see
// .context/leadbay-live-shapes/SHAPE-DRIFT.md). Don't "fix" the lack of body.

import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";

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
  description:
    "Add leads to the user's transient selection (used by selection-scoped bulk operations). " +
    "When to use: low-level. The user's selection is a per-token global state — be careful when invoking " +
    "directly. " +
    "When NOT to use: in normal flow — leadbay_enrich_titles wraps select → action → clear in one call " +
    "with proper Mutex protection. Calling this directly without acquiring the selection lock can clobber " +
    "concurrent composite calls.",
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
