import type { LeadbayClient } from "../client.js";
import type { Tool, FilterPayload } from "../types.js";
import { leadbay_update_lens_filter as UPDATE_LENS_FILTER_DESCRIPTION } from "../tool-descriptions.generated.js";

interface UpdateLensFilterParams {
  lensId: number;
  filter: FilterPayload;
  dry_run?: boolean;
}

export const updateLensFilter: Tool<UpdateLensFilterParams> = {
  name: "leadbay_update_lens_filter",
  annotations: {
    title: "Update lens filter",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: UPDATE_LENS_FILTER_DESCRIPTION,
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      lensId: { type: "number", description: "Lens id" },
      filter: {
        type: "object",
        description: "Full FilterPayload (lens_filter + locations)",
      },
      dry_run: {
        type: "boolean",
        description:
          "If true, return the call shape that WOULD be sent without contacting the backend",
      },
    },
    required: ["lensId", "filter"],
    additionalProperties: false,
  },
  execute: async (
    client: LeadbayClient,
    params: UpdateLensFilterParams
  ) => {
    if (params.dry_run) {
      return {
        dry_run: true,
        would_call: {
          method: "POST",
          path: `/lenses/${params.lensId}/filter`,
          body: params.filter,
        },
      };
    }
    await client.requestVoid(
      "POST",
      `/lenses/${params.lensId}/filter`,
      params.filter
    );
    client.invalidateDefaultLens();
    return { updated: true, lens_id: params.lensId };
  },
};
