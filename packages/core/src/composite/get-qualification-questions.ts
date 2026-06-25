import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext, AiAgentQuestionPayload } from "../types.js";
import { withAgentMemoryMeta } from "../agent-memory/index.js";

import { leadbay_get_qualification_questions as GET_QUALIFICATION_QUESTIONS_DESCRIPTION } from "../tool-descriptions.generated.js";

// Org-level "qualification questions" = the AI-agent questions Leadbay scores
// every lead against. Focused read tool: returns ONLY the question catalog
// (not the broader taste profile). Read-only itself; to MODIFY the questions
// use leadbay_set_qualification_questions (org-admin only, which every user is
// for their own org). For admins we surface that pointer in the hint.
export const getQualificationQuestions: Tool<Record<string, never>> = {
  name: "leadbay_get_qualification_questions",
  annotations: {
    title: "Read the org's qualification questions",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: GET_QUALIFICATION_QUESTIONS_DESCRIPTION,
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
          "Whether the current bearer-token holder is an org admin. Admins can modify the questions via leadbay_set_qualification_questions.",
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
    // resolveMe FIRST so its /users/me result is cached + gives us the org id.
    // The role flag is best-effort (null on failure → not admin).
    const me = await client.resolveMe().catch(() => null);
    const isAdmin = me?.admin ?? false;
    const orgId = me?.organization?.id ?? (await client.resolveOrgId());

    // Fetch the questions endpoint DIRECTLY (not via resolveTasteProfile, which
    // uses Promise.allSettled and substitutes [] for a rejected fetch). A
    // transient backend/auth failure must surface as an ERROR here — never as a
    // false "no questions configured", which could lead a caller to overwrite
    // an org's real questions.
    const questions = await client.request<AiAgentQuestionPayload[]>(
      "GET",
      `/organizations/${orgId}/ai_agent_questions`
    ) ?? [];

    let hint: string | undefined;
    if (questions.length === 0) {
      hint =
        "No qualification questions configured yet. Use leadbay_set_qualification_questions to add some, or leadbay_refine_prompt to shape the AI agent.";
    } else if (isAdmin) {
      hint =
        "You're an org admin — use leadbay_set_qualification_questions to add, remove, or replace these questions.";
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
