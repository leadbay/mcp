import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";
import { withAgentMemoryMeta } from "../agent-memory/index.js";

import { leadbay_get_qualification_methods as GET_QUALIFICATION_METHODS_DESCRIPTION } from "../tool-descriptions.generated.js";

// Org-level "qualification methods" = the AI-agent questions Leadbay scores
// every lead against. Focused read tool: returns ONLY the question catalog
// (not the broader taste profile). Read-only itself; to MODIFY the questions
// use leadbay_set_qualification_methods (org-admin only, which every user is
// for their own org). For admins we surface that pointer in the hint.
export const getQualificationMethods: Tool<Record<string, never>> = {
  name: "leadbay_get_qualification_methods",
  annotations: {
    title: "Read the org's qualification methods",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: GET_QUALIFICATION_METHODS_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      qualification_questions: {
        type: "array",
        description:
          "Org-level questions Leadbay scores every lead against. Each: {question, created_at, lang}.",
        items: { type: "object" },
      },
      count: {
        type: "number",
        description: "Number of qualification questions configured.",
      },
      is_admin: {
        type: "boolean",
        description:
          "Whether the current bearer-token holder is an org admin. Admins can modify the questions via leadbay_set_qualification_methods.",
      },
      region: { type: "string" },
      hint: {
        type: "string",
        description:
          "Operator note — admin edit pointer, or the empty-state message when no questions are configured.",
      },
      _meta: { type: "object" },
    },
    required: ["qualification_questions"],
  },
  execute: async (
    client: LeadbayClient,
    _params: Record<string, never>,
    ctx?: ToolContext
  ) => {
    // resolveMe FIRST so its /users/me result is cached before
    // resolveTasteProfile (which resolves the org id from the same /me) and
    // before withAgentMemoryMeta reuse it — avoids a concurrent double-fetch.
    // Both are best-effort for the role flag.
    const me = await client.resolveMe().catch(() => null);
    const profile = await client.resolveTasteProfile();

    const questions = profile.qualificationQuestions ?? [];
    const isAdmin = me?.admin ?? false;

    let hint: string | undefined;
    if (questions.length === 0) {
      hint =
        "No qualification questions configured yet. Use leadbay_set_qualification_methods to add some, or leadbay_refine_prompt to shape the AI agent.";
    } else if (isAdmin) {
      hint =
        "You're an org admin — use leadbay_set_qualification_methods to add, remove, or replace these questions.";
    }

    return withAgentMemoryMeta(
      client,
      {
        qualification_questions: questions.map((q) => ({
          question: q.question,
          created_at: q.created_at,
          lang: q.lang,
        })),
        count: questions.length,
        is_admin: isAdmin,
        region: client.region,
        ...(hint ? { hint } : {}),
      },
      ctx
    );
  },
};
