import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { leadbay_launch_bulk_enrichment as LAUNCH_BULK_ENRICHMENT_DESCRIPTION } from "../tool-descriptions.generated.js";

// IMPORTANT — backend behavior confirmed by live probe (SHAPE-DRIFT.md probe 5):
// `/leads/selection/enrichment/launch` returns 204 with no body and no headers
// other than `date`. There is NO bulk_id returned. There is NO list endpoint
// at /leads/bulk_enrichments to recover one. Polling per-bulk-job is therefore
// not possible from the agent.
//
// Track progress instead by polling individual leads via leadbay_get_contacts —
// when contact.enrichment.done flips to true, that contact has been enriched.

interface LaunchBulkEnrichmentParams {
  titles: string[];
  email?: boolean;
  phone?: boolean;
  dry_run?: boolean;
}

export const launchBulkEnrichment: Tool<LaunchBulkEnrichmentParams> = {
  name: "leadbay_launch_bulk_enrichment",
  annotations: {
    title: "Launch bulk enrichment",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: LAUNCH_BULK_ENRICHMENT_DESCRIPTION,
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      titles: { type: "array", items: { type: "string" } },
      email: { type: "boolean", description: "Enrich emails (default true)" },
      phone: { type: "boolean", description: "Enrich phone numbers (default false)" },
      dry_run: {
        type: "boolean",
        description:
          "If true, return the call shape WITHOUT contacting the backend",
      },
    },
    required: ["titles"],
    additionalProperties: false,
  },
  execute: async (
    client: LeadbayClient,
    params: LaunchBulkEnrichmentParams
  ) => {
    const email = params.email ?? true;
    const phone = params.phone ?? false;
    if (!email && !phone) {
      return {
        error: true,
        code: "BAD_INPUT",
        message: "Either email or phone must be true",
        hint: "Set email:true to enrich emails (most common), or phone:true for phone numbers",
      };
    }
    if (params.dry_run) {
      return {
        dry_run: true,
        would_call: {
          method: "POST",
          path: "/leads/selection/enrichment/launch",
          body: { titles: params.titles, email, phone },
        },
      };
    }
    await client.requestVoid("POST", "/leads/selection/enrichment/launch", {
      titles: params.titles,
      email,
      phone,
    });
    return {
      launched: true,
      titles: params.titles,
      email,
      phone,
      hint:
        "Enrichment job launched (runs async). Stay active — poll individual leads' contacts via " +
        "leadbay_get_contacts(leadId) (re-check every ~30s until contact.enrichment.done flips), then report " +
        "when done. Don't end your turn on this ack and force the user to reprompt.",
    };
  },
};
