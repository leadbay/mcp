import type { ScenarioFixture } from "../daily-check-in/clean-batch.scenario.js";

const ORG_ID = "org_rfn_001";
const P = (path: string) => `/1.5${path}`;

export const SCENARIO: ScenarioFixture<{ instruction: string }> = {
  name: "clarification-roundtrip",
  prompt: "leadbay_refine_audience",
  tier: "gate",
  args: { instruction: "focus on hospitals running their own IT" },
  backendFixtures: [
    // ── refine_prompt: GET /users/me (to get orgId) ───────────────────────
    {
      method: "GET",
      path: P("/users/me"),
      status: 200,
      body: {
        id: "user_rfn_001",
        email: "demo@leadbay.ai",
        name: "Demo User",
        admin: false,
        manager: false,
        organization: {
          id: ORG_ID,
          name: "Leadbay Demo Org",
          ai_agent_enabled: true,
          computing_intelligence: false,
        },
        last_requested_lens: 99,
      },
    },
    // ── refine_prompt: POST /organizations/{orgId}/user_prompt ────────────
    {
      method: "POST",
      path: P(`/organizations/${ORG_ID}/user_prompt`),
      status: 204,
      body: null,
    },
    // ── refine_prompt: GET /organizations/{orgId}/clarifications (polling) ─
    {
      method: "GET",
      path: P(`/organizations/${ORG_ID}/clarifications`),
      status: 200,
      body: {
        id: "clarif_001",
        question: "By 'their own IT', do you mean self-hosted EMR, in-house infrastructure team, or both?",
        options: ["self-hosted EMR only", "in-house infra team only", "both"],
        created_at: "2026-05-26T09:00:00Z",
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
