import type { LeadbayClient } from "../client.js";
import type { Tool, LensPayload } from "../types.js";
import { leadbay_create_lens_draft as CREATE_LENS_DRAFT_DESCRIPTION } from "../tool-descriptions.generated.js";

interface CreateLensDraftParams {
  lensId: number;
}

export const createLensDraft: Tool<CreateLensDraftParams> = {
  name: "leadbay_create_lens_draft",
  annotations: {
    title: "Create a lens draft",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  description: CREATE_LENS_DRAFT_DESCRIPTION,
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: { lensId: { type: "number", description: "Lens id of the org-level lens to draft" } },
    required: ["lensId"],
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: CreateLensDraftParams) => {
    return await client.request<LensPayload>(
      "POST",
      `/lenses/${params.lensId}/draft`
    );
  },
};
