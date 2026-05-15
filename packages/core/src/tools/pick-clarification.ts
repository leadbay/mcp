import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { leadbay_pick_clarification as PICK_CLARIFICATION_DESCRIPTION } from "../tool-descriptions.generated.js";

interface PickClarificationParams {
  option_id?: string;
  text_answer?: string;
}

export const pickClarification: Tool<PickClarificationParams> = {
  name: "leadbay_pick_clarification",
  annotations: {
    title: "Pick a clarification answer",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  description: PICK_CLARIFICATION_DESCRIPTION,
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      option_id: { type: "string", description: "Id of one of the clarification's options" },
      text_answer: { type: "string", description: "Free-text answer (overrides option_id if both are set)" },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      answered: {
        type: "boolean",
        description: "True when the answer was recorded; intelligence regeneration begins.",
      },
    },
    required: ["answered"],
  },
  execute: async (
    client: LeadbayClient,
    params: PickClarificationParams
  ) => {
    if (!params.option_id && !params.text_answer) {
      return {
        error: true,
        code: "BAD_INPUT",
        message: "Provide either option_id or text_answer",
        hint: "Call leadbay_get_clarification to see the options first",
      };
    }
    const orgId = await client.resolveOrgId();
    await client.requestVoid(
      "POST",
      `/organizations/${orgId}/pick_clarification`,
      params
    );
    // Stores answer as user_prompt and triggers regeneration → mutates
    // organization.computing_intelligence on /me. Invalidate cache.
    client.invalidateMe();
    return { answered: true };
  },
};
