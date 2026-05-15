import type { ScenarioFixture } from "../daily-check-in/clean-batch.scenario.js";

export const SCENARIO: ScenarioFixture<{ instruction: string }> = {
  name: "clarification-roundtrip",
  prompt: "leadbay_refine_audience",
  tier: "gate",
  args: { instruction: "focus on hospitals running their own IT" },
  backendFixtures: [
    {
      method: "POST",
      path: "/v1/audience/refine",
      status: 200,
      body: {
        status: "needs_clarification",
        clarification: {
          question: "By 'their own IT', do you mean self-hosted EMR, in-house infrastructure team, or both?",
          options: ["self-hosted EMR only", "in-house infra team only", "both"],
        },
      },
    },
  ],
  mission: {
    prompt_name: "leadbay_refine_audience",
    scenario_name: "clarification-roundtrip",
    user_intent: "Refine my Leadbay audience prompt with a clarification handled correctly.",
    success_criteria: [
      "called leadbay_refine_prompt exactly once",
      "surfaced the clarification question and all 3 options VERBATIM in agent prose",
      "did NOT call leadbay_answer_clarification on the user's behalf",
    ],
    required_calls: ["leadbay_refine_prompt"],
    required_byproducts: [
      "By 'their own IT', do you mean self-hosted EMR, in-house infrastructure team, or both?",
    ],
    forbidden_calls: ["leadbay_answer_clarification"],
  },
};
