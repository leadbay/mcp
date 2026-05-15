import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { leadbay_get_lens_scoring as GET_LENS_SCORING_DESCRIPTION } from "../tool-descriptions.generated.js";

interface GetLensScoringParams {
  lensId: number;
}

interface LensScoringPayload {
  criteria?: unknown;
  [k: string]: unknown;
}

export const getLensScoring: Tool<GetLensScoringParams> = {
  name: "leadbay_get_lens_scoring",
  annotations: {
    title: "Read lens scoring",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: GET_LENS_SCORING_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: { lensId: { type: "number", description: "Lens id (required)" } },
    required: ["lensId"],
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: GetLensScoringParams) => {
    return await client.request<LensScoringPayload>(
      "GET",
      `/lenses/${params.lensId}/scoring`
    );
  },
};
