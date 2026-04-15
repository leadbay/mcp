import type { LeadbayClient } from "../client.js";

export function registerQualifyLead(api: any, client: LeadbayClient) {
  api.registerTool({
    name: "leadbay_qualify_lead",
    description:
      "Trigger AI qualification for a lead. This fetches the lead's website and runs AI scoring and web insights generation. The operation is asynchronous — use leadbay_get_lead_profile after about 60 seconds to check qualification results and web insights.",
    optional: true,
    parameters: {
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
    execute: async (params: { leadId: string; forceFetch?: boolean }) => {
      const force = params.forceFetch ?? false;
      await client.request(
        "POST",
        `/leads/${params.leadId}/web_fetch?force_fetch=${force}`
      );
      return {
        triggered: true,
        hint: "AI qualification started. Use leadbay_get_lead_profile after ~60 seconds to check qualification results and web insights.",
      };
    },
  });
}
