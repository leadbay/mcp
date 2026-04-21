import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";

interface QualifyLeadParams {
  leadId: string;
  forceFetch?: boolean;
}

export const qualifyLead: Tool<QualifyLeadParams> = {
  name: "leadbay_qualify_lead",
  description:
    "Trigger AI qualification for a lead. This fetches the lead's website and runs AI scoring and web insights generation. The operation is asynchronous — use leadbay_get_lead_profile after about 60 seconds to check qualification results and web insights.",
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
