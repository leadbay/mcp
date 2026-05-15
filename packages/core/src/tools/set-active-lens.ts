import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { leadbay_set_active_lens as SET_ACTIVE_LENS_DESCRIPTION } from "../tool-descriptions.generated.js";

interface SetActiveLensParams {
  lensId: number;
}

export const setActiveLens: Tool<SetActiveLensParams> = {
  name: "leadbay_set_active_lens",
  annotations: {
    title: "Set active lens",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: SET_ACTIVE_LENS_DESCRIPTION,
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: { lensId: { type: "number", description: "Lens id (required)" } },
    required: ["lensId"],
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: SetActiveLensParams) => {
    await client.requestVoid(
      "POST",
      `/lenses/${params.lensId}/update_last_requested`
    );
    // /me cache holds last_requested_lens — invalidate so next read reflects the change.
    client.invalidateMe();
    client.invalidateDefaultLens();
    return { active_lens_id: params.lensId };
  },
};
