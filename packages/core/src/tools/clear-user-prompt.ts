import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { leadbay_clear_user_prompt as CLEAR_USER_PROMPT_DESCRIPTION } from "../tool-descriptions.generated.js";

export const clearUserPrompt: Tool<Record<string, never>> = {
  name: "leadbay_clear_user_prompt",
  annotations: {
    title: "Clear the user prompt",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: CLEAR_USER_PROMPT_DESCRIPTION,
  optional: true,
  write: true,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  execute: async (client: LeadbayClient) => {
    const orgId = await client.resolveOrgId();
    await client.requestVoid("DELETE", `/organizations/${orgId}/user_prompt`);
    // Mutates organization.computing_intelligence — invalidate /me cache.
    client.invalidateMe();
    return { cleared: true };
  },
};
