import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { leadbay_promote_lens as PROMOTE_LENS_DESCRIPTION } from "../tool-descriptions.generated.js";

interface PromoteLensParams {
  lensId: number;
}

export const promoteLens: Tool<PromoteLensParams> = {
  name: "leadbay_promote_lens",
  annotations: {
    title: "Promote a lens draft to active",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  description: PROMOTE_LENS_DESCRIPTION,
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: { lensId: { type: "number" } },
    required: ["lensId"],
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: PromoteLensParams) => {
    await client.requestVoid("POST", `/lenses/${params.lensId}/promote`);
    client.invalidateDefaultLens();
    return { promoted: true, lens_id: params.lensId };
  },
};
