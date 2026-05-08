import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import type { LensPayload } from "../types.js";

export const listLenses: Tool<Record<string, never>> = {
  name: "leadbay_list_lenses",
  annotations: {
    title: "List active lenses",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description:
    "List all available Leadbay lenses (saved lead search configurations). Each lens defines a different " +
    "target market or buyer segment. The lens with is_last_active=true is used by default for lead discovery. " +
    "When to use: when the user wants to switch lens or asks 'what lenses do I have'. " +
    "When NOT to use: in normal flow — composites auto-resolve the active lens via /me.last_requested_lens.",
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
