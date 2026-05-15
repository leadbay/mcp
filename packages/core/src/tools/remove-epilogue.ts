import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { leadbay_remove_epilogue as REMOVE_EPILOGUE_DESCRIPTION } from "../tool-descriptions.generated.js";

interface RemoveEpilogueParams {
  lead_ids: string[];
}

export const removeEpilogue: Tool<RemoveEpilogueParams> = {
  name: "leadbay_remove_epilogue",
  annotations: {
    title: "Remove lead epilogue",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: REMOVE_EPILOGUE_DESCRIPTION,
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
  execute: async (client: LeadbayClient, params: RemoveEpilogueParams) => {
    await client.requestVoid("POST", "/leads/remove_epilogue", {
      lead_ids: params.lead_ids,
    });
    return { cleared: true, count: params.lead_ids.length };
  },
};
