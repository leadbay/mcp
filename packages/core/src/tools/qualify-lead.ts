import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { leadbay_qualify_lead as QUALIFY_LEAD_DESCRIPTION } from "../tool-descriptions.generated.js";

interface QualifyLeadParams {
  leadId: string;
  forceFetch?: boolean;
}

export const qualifyLead: Tool<QualifyLeadParams> = {
  name: "leadbay_qualify_lead",
  annotations: {
    title: "Qualify a single lead",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: QUALIFY_LEAD_DESCRIPTION,
  optional: true,
  inputSchema: {
    type: "object",
    properties: {
      leadId: {
        type: "string",
        description: "Lead UUID (required)",
      },
      forceFetch: {
        type: "boolean",
        description:
          "Force re-fetch even if recent data exists (default: false)",
      },
    },
    required: ["leadId"],
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: QualifyLeadParams) => {
    const force = params.forceFetch ?? false;
    await client.requestVoid(
      "POST",
      `/leads/${params.leadId}/web_fetch?force_fetch=${force}`
    );
    return {
      triggered: true,
      hint: "AI qualification started. Use leadbay_get_lead_profile after ~60 seconds to check qualification results and web insights.",
    };
  },
};
