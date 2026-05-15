import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import type { LensPayload } from "../types.js";
import { leadbay_list_lenses as LIST_LENSES_DESCRIPTION } from "../tool-descriptions.generated.js";

export const listLenses: Tool<Record<string, never>> = {
  name: "leadbay_list_lenses",
  annotations: {
    title: "List active lenses",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: LIST_LENSES_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      lenses: {
        type: "array",
        description:
          "Available lenses. Each: {id, name, is_last_active, description}.",
        items: {
          type: "object",
          properties: {
            id: { type: "number" },
            name: { type: "string" },
            is_last_active: { type: "boolean" },
            description: { type: ["string", "null"] },
          },
        },
      },
    },
    required: ["lenses"],
  },
  execute: async (client: LeadbayClient) => {
    const lenses = await client.request<LensPayload[]>("GET", "/lenses");
    return {
      lenses: lenses.map((l) => ({
        id: l.id,
        name: l.name,
        is_last_active: l.is_last_active,
        description: l.description,
      })),
    };
  },
};
