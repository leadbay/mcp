import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";

export const getTasteProfile: Tool<Record<string, never>> = {
  name: "leadbay_get_taste_profile",
  annotations: {
    title: "Read the org's taste profile",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description:
    "Get the user's Ideal Buyer Profile, purchase intent tags, and qualification questions. " +
    "When to use: at the very start of a session to understand what kind of leads the user is looking for. " +
    "Data is cached. " +
    "When NOT to use: per-lead — leadbay_research_lead already includes the per-lead qualification answers " +
    "(which are scored against these org-level questions).",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      ideal_buyer_profile: {
        description:
          "Ideal Buyer Profile {summary, key_characteristics, anti_patterns} or null when none.",
      },
      purchase_intent_tags: {
        type: "array",
        description: "Tags describing buying signals. Each: {display_name, description, score, reasoning}.",
        items: { type: "object" },
      },
      qualification_questions: {
        type: "array",
        description: "Questions Leadbay asks for each lead. Each: {question}.",
        items: { type: "object" },
      },
      hint: {
        type: "string",
        description: "Operator note when the taste profile is empty (no_profile state).",
      },
    },
    required: ["purchase_intent_tags", "qualification_questions"],
  },
  execute: async (client: LeadbayClient) => {
    const profile = await client.resolveTasteProfile();

    const isEmpty =
      !profile.idealBuyerProfile &&
      profile.purchaseIntentTags.length === 0 &&
      profile.qualificationQuestions.length === 0;

    return {
      ideal_buyer_profile: profile.idealBuyerProfile
        ? {
            summary: profile.idealBuyerProfile.summary,
            key_characteristics:
              profile.idealBuyerProfile.key_characteristics,
            anti_patterns: profile.idealBuyerProfile.anti_patterns,
          }
        : null,
      purchase_intent_tags: profile.purchaseIntentTags.map((t) => ({
        display_name: t.display_name,
        description: t.description,
        score: t.score,
        reasoning: t.reasoning,
      })),
      qualification_questions: profile.qualificationQuestions.map((q) => ({
        question: q.question,
      })),
      ...(isEmpty
        ? {
            hint: "No taste profile configured yet. Use leadbay_refine_prompt or contact Leadbay support to set one up for better lead matching.",
          }
        : {}),
    };
  },
};
