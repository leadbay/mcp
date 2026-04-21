import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";

export const getTasteProfile: Tool<Record<string, never>> = {
  name: "leadbay_get_taste_profile",
  description:
    "Get the user's Ideal Buyer Profile, purchase intent tags, and qualification questions. IMPORTANT: Call this at the very start of every session to understand what kind of leads the user is looking for. This data rarely changes and is cached.",
  inputSchema: {
    type: "object",
    properties: {},
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
            hint: "No taste profile configured yet. Set it up at app.leadbay.ai for better lead matching.",
          }
        : {}),
    };
  },
};
