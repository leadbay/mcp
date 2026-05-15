import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { leadbay_get_enrichment_job_titles as GET_ENRICHMENT_JOB_TITLES_DESCRIPTION } from "../tool-descriptions.generated.js";

export const getEnrichmentJobTitles: Tool<Record<string, never>> = {
  name: "leadbay_get_enrichment_job_titles",
  annotations: {
    title: "Read enrichment job titles",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: GET_ENRICHMENT_JOB_TITLES_DESCRIPTION,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  execute: async (client: LeadbayClient) => {
    return await client.request<string[]>(
      "GET",
      "/leads/selection/enrichment/job_titles"
    );
  },
};
