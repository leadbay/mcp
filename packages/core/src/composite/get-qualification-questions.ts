import type { LeadbayClient } from "../client.js";
import type {
  Tool,
  ToolContext,
  AiAgentQuestionPayload,
  IdealBuyerProfilePayload,
  UserPromptPayload,
} from "../types.js";

import { leadbay_get_qualification_questions as GET_QUALIFICATION_QUESTIONS_DESCRIPTION } from "../tool-descriptions.generated.js";
import { MAX_QUESTIONS } from "./set-qualification-questions.js";

// Org-level "qualification questions" = the AI-agent questions Leadbay scores
// every lead against. Returns the question catalog plus the two settings the
// questions sit beside — the ideal buyer profile and the targeting prompt —
// so a caller can tell whether a user's stated rule is already covered
// (product#4139). Read-only itself; to MODIFY the questions
// use leadbay_set_qualification_questions (org-admin only, which every user is
// for their own org). For admins we surface that pointer in the hint.
export const getQualificationQuestions: Tool<Record<string, never>> = {
  name: "leadbay_get_qualification_questions",
  annotations: {
    title: "Read the org's qualification questions",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
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
      ideal_buyer_profile: {
        description:
          "The org's Ideal Buyer Profile {summary, key_characteristics, anti_patterns}, or null when none is configured. The questions score against this profile — read it before judging whether a user's stated rule is already covered.",
      },
      targeting_prompt: {
        type: ["string", "null"],
        description:
          "The org's free-text targeting prompt (user_prompt) the AI agent follows, or null when unset. Qualitative rules live here rather than in a question; change it with leadbay_refine_lead_targeting.",
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

    // The buyer profile and the targeting prompt are the other two halves of
    // the same setting: an agent cannot tell whether a user's stated rule is
    // ALREADY covered without seeing them. Best-effort — a failure here must
    // never mask the questions we did read, so both settle to null.
    const [ibpResult, promptResult] = await Promise.allSettled([
      client.request<IdealBuyerProfilePayload>(
        "GET",
        `/organizations/${orgId}/ideal_buyer_profile`
      ),
      client.request<UserPromptPayload | null>(
        "GET",
        `/organizations/${orgId}/user_prompt`
      ),
    ]);
    const ibp =
      ibpResult.status === "fulfilled" ? ibpResult.value ?? null : null;
    const targetingPrompt =
      promptResult.status === "fulfilled"
        ? promptResult.value?.prompt ?? null
        : null;

    let hint: string | undefined;
    if (questions.length >= MAX_QUESTIONS && isAdmin) {
      // The ceiling has to be stated in the turn the user asks for an addition,
      // not discovered from a rejected write (product#4139).
      hint = `${questions.length} of ${MAX_QUESTIONS} question slots are used — the set is FULL. An addition is a SWAP: tell the user the set is full, list these ${questions.length} and let THEM choose which one goes, then call leadbay_set_qualification_questions with confirm:true. Never pre-pick the one to drop.`;
    } else if (questions.length >= MAX_QUESTIONS) {
      // Non-admin: same fact, no write instruction. Modifying the questions is
      // org-admin-only, so pointing a non-admin at the write tool just earns a 403.
      hint = `${questions.length} of ${MAX_QUESTIONS} question slots are used — the set is FULL. Changing it means dropping one, and that is an org-admin action. Tell the user which question they would need an admin to swap out.`;
    } else if (questions.length === 0) {
      hint =
        "No qualification questions configured — every lead is scored on firmographics alone. Propose a starter set of exactly 3 questions in ONE leadbay_set_qualification_questions call — one question is too thin to separate anything, each on a DIFFERENT buying dimension, each starting \"Is the company likely to ...\" / \"L'entreprise est-elle susceptible de ...\", and none restating a sector or size the lens already filters on. Get the user's yes first.";
    } else if (isAdmin) {
      hint = `You're an org admin — use leadbay_set_qualification_questions to add, remove, or replace these questions. ${
        MAX_QUESTIONS - questions.length
      } of ${MAX_QUESTIONS} slots are still free.`;
    }

    return {
        qualification_questions: questions.map((q) => ({
          question: q.question,
          created_at: q.created_at,
          lang: q.lang,
        })),
        count: questions.length,
        ideal_buyer_profile: ibp
          ? {
              summary: ibp.summary,
              key_characteristics: ibp.key_characteristics,
              anti_patterns: ibp.anti_patterns,
            }
          : null,
        targeting_prompt: targetingPrompt,
        is_admin: isAdmin,
        region: client.region,
        ...(hint ? { hint } : {}),
      };
  },
};
