import type { LeadbayClient } from "../client.js";
import type { Tool, FilterPayload } from "../types.js";
import { leadbay_get_lens_filter as GET_LENS_FILTER_DESCRIPTION } from "../tool-descriptions.generated.js";

interface GetLensFilterParams {
  lensId: number;
}

export const getLensFilter: Tool<GetLensFilterParams> = {
  name: "leadbay_get_lens_filter",
  annotations: {
    title: "Read lens filter",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: GET_LENS_FILTER_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      lensId: { type: "number", description: "Lens id (required)" },
    },
    required: ["lensId"],
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: GetLensFilterParams) => {
    return await client.request<FilterPayload>(
      "GET",
      `/lenses/${params.lensId}/filter`
    );
  },
};
