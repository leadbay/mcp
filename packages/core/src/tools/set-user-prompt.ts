import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";

interface SetUserPromptParams {
  prompt: string;
  dry_run?: boolean;
}

export const setUserPrompt: Tool<SetUserPromptParams> = {
  name: "leadbay_set_user_prompt",
  description:
    "Set the org's intelligence-refinement prompt — free-text instruction that steers Leadbay's lead " +
    "recommendations beyond firmographics. Admin-only. Setting this clears any pending clarification and " +
    "triggers a full intelligence regeneration (web search + high-reasoning). " +
    "When to use: low-level. " +
    "When NOT to use: from agent flow — use leadbay_refine_prompt, which polls for follow-up clarifications.",
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
