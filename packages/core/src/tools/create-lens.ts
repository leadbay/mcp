import type { LeadbayClient } from "../client.js";
import type { Tool, LensPayload } from "../types.js";
import { leadbay_create_lens as CREATE_LENS_DESCRIPTION } from "../tool-descriptions.generated.js";

interface CreateLensParams {
  base: number;
  name: string;
  description?: string;
}

export const createLens: Tool<CreateLensParams> = {
  name: "leadbay_create_lens",
  annotations: {
    title: "Create a new lens",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  description: CREATE_LENS_DESCRIPTION,
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      base: { type: "number", description: "Base lens id to clone from" },
      name: { type: "string", description: "Display name for the new lens" },
      description: { type: "string" },
    },
    required: ["base", "name"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    description:
      "Full LensPayload as returned by the backend. Permissive shape — backend may add fields over time.",
    properties: {
      id: { type: "number", description: "New lens id." },
      name: { type: "string" },
      description: { type: ["string", "null"] },
      is_default: { type: "boolean" },
      is_last_active: { type: "boolean" },
      user_id: { type: ["string", "number", "null"] },
    },
    required: ["id", "name"],
  },
  execute: async (client: LeadbayClient, params: CreateLensParams) => {
    // Backend requires `base` as a STRING (lens ids are strings server-side);
    // a numeric base yields 400 "JSON deserialization error".
    const lens = await client.request<LensPayload>("POST", "/lenses", {
      base: String(params.base),
      name: params.name,
      description: params.description,
    });
    // /me's last_requested_lens is unchanged by creation, but the lens-list
    // cache the client maintains is now stale.
    client.invalidateDefaultLens();
    return lens;
  },
};
