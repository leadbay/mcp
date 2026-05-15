import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { leadbay_dismiss_clarification as DISMISS_CLARIFICATION_DESCRIPTION } from "../tool-descriptions.generated.js";

export const dismissClarification: Tool<Record<string, never>> = {
  name: "leadbay_dismiss_clarification",
  annotations: {
    title: "Dismiss a clarification",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  description: DISMISS_CLARIFICATION_DESCRIPTION,
  optional: true,
  write: true,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  execute: async (client: LeadbayClient) => {
    const orgId = await client.resolveOrgId();
    await client.requestVoid(
      "POST",
      `/organizations/${orgId}/dismiss_clarification`
    );
    // Dismissing clears the pending clarification on the org — that state
    // bleeds into /me via computing_intelligence reset. Invalidate cache.
    client.invalidateMe();
    return { dismissed: true };
  },
};
