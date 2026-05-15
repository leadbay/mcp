import type { LeadbayClient } from "../client.js";
import type { Tool, BulkEnrichPreview } from "../types.js";
import { leadbay_preview_bulk_enrichment as PREVIEW_BULK_ENRICHMENT_DESCRIPTION } from "../tool-descriptions.generated.js";

interface PreviewBulkEnrichmentParams {
  titles: string[];
}

export const previewBulkEnrichment: Tool<PreviewBulkEnrichmentParams> = {
  name: "leadbay_preview_bulk_enrichment",
  annotations: {
    title: "Preview bulk enrichment cost",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: PREVIEW_BULK_ENRICHMENT_DESCRIPTION,
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      titles: {
        type: "array",
        items: { type: "string" },
        description: "Job titles to enrich (matched against contacts in selected leads)",
      },
    },
    required: ["titles"],
    additionalProperties: false,
  },
  execute: async (
    client: LeadbayClient,
    params: PreviewBulkEnrichmentParams
  ) => {
    return await client.request<BulkEnrichPreview>(
      "POST",
      "/leads/selection/enrichment/preview",
      { titles: params.titles }
    );
  },
};
