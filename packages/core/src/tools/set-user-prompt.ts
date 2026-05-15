import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { leadbay_set_user_prompt as SET_USER_PROMPT_DESCRIPTION } from "../tool-descriptions.generated.js";

interface SetUserPromptParams {
  prompt: string;
  dry_run?: boolean;
}

export const setUserPrompt: Tool<SetUserPromptParams> = {
  name: "leadbay_set_user_prompt",
  annotations: {
    title: "Set the user prompt",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: SET_USER_PROMPT_DESCRIPTION,
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Refinement instruction (free text)" },
      dry_run: {
        type: "boolean",
        description:
          "If true, return the call shape that WOULD be sent without contacting the backend",
      },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: SetUserPromptParams) => {
    const orgId = await client.resolveOrgId();
    if (params.dry_run) {
      return {
        dry_run: true,
        would_call: {
          method: "POST",
          path: `/organizations/${orgId}/user_prompt`,
          body: { user_prompt: params.prompt },
        },
      };
    }
    await client.requestVoid("POST", `/organizations/${orgId}/user_prompt`, {
      user_prompt: params.prompt,
    });
    // Mutates organization.computing_intelligence (and clears any pending
    // clarification). The /me cache holds organization.computing_intelligence;
    // invalidate so polling helpers (e.g. account_status) see the fresh state.
    client.invalidateMe();
    return { set: true };
  },
};
