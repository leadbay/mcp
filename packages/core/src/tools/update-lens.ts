import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { leadbay_update_lens as UPDATE_LENS_DESCRIPTION } from "../tool-descriptions.generated.js";

interface UpdateLensParams {
  lensId: number;
  name?: string;
  description?: string;
  multi_product_mode?: boolean;
  use_hq_only?: boolean;
}

export const updateLens: Tool<UpdateLensParams> = {
  name: "leadbay_update_lens",
  annotations: {
    title: "Update a lens",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: UPDATE_LENS_DESCRIPTION,
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      lensId: { type: "number" },
      name: { type: "string" },
      description: { type: "string" },
      multi_product_mode: { type: "boolean" },
      use_hq_only: { type: "boolean" },
    },
    required: ["lensId"],
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: UpdateLensParams) => {
    const { lensId, ...body } = params;
    await client.requestVoid("POST", `/lenses/${lensId}`, body);
    client.invalidateDefaultLens();
    return { updated: true, lens_id: lensId };
  },
};
