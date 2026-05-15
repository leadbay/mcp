import type { LeadbayClient } from "../client.js";
import type { Tool, ClarificationPayload } from "../types.js";
import { leadbay_get_clarification as GET_CLARIFICATION_DESCRIPTION } from "../tool-descriptions.generated.js";

export const getClarification: Tool<Record<string, never>> = {
  name: "leadbay_get_clarification",
  annotations: {
    title: "Read pending clarification",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: GET_CLARIFICATION_DESCRIPTION,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: {
    type: "object",
    properties: {
      pending: {
        type: "boolean",
        description: "False when no clarification is pending (and `clarification` is null).",
      },
      clarification: {
        description: "ClarificationPayload (object) when pending, otherwise null.",
      },
      // When the backend returns a populated ClarificationPayload, the keys
      // are spread directly into the response. The asserter is permissive —
      // declare the union of keys here so the conformance check doesn't
      // flag drift.
      id: { type: "string", description: "Clarification id (when pending)." },
      question: { type: "string", description: "Question text (when pending)." },
      options: {
        type: "array",
        description: "Picker options (when pending). Each: {id, label}.",
        items: { type: "object" },
      },
    },
  },
  execute: async (client: LeadbayClient) => {
    const orgId = await client.resolveOrgId();
    const c = await client.request<ClarificationPayload | null>(
      "GET",
      `/organizations/${orgId}/clarifications`
    );
    return c ?? { pending: false, clarification: null };
  },
};
