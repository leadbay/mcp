import type { ScenarioFixture } from "../daily-check-in/clean-batch.scenario.js";

export const SCENARIO: ScenarioFixture<{ count: string }> = {
  name: "default-batch",
  prompt: "leadbay_qualify_top_n",
  tier: "gate",
  args: { count: "10" },
  backendFixtures: [
    {
      method: "POST",
      path: "/v1/qualify/bulk",
      status: 200,
      body: {
        qualified: [
          { lead_id: "l1", name: "Apex Health", ai_agent_lead_score: 0.91, qualification_summary: "Strong fit." },
          { lead_id: "l2", name: "Bayside Clinic", ai_agent_lead_score: 0.84, qualification_summary: "Good fit." },
          { lead_id: "l3", name: "Cedar Medical", ai_agent_lead_score: 0.79, qualification_summary: "Moderate." },
          { lead_id: "l4", name: "Delta Care", ai_agent_lead_score: 0.72, qualification_summary: "Borderline." },
          { lead_id: "l5", name: "Echo Health", ai_agent_lead_score: 0.65, qualification_summary: "Marginal." },
          { lead_id: "l6", name: "Foster Center", ai_agent_lead_score: 0.62, qualification_summary: "Uncertain." },
          { lead_id: "l7", name: "Greene Practice", ai_agent_lead_score: 0.58, qualification_summary: "Weak signal." },
        ],
        still_running: [{ lead_id: "l8" }, { lead_id: "l9" }, { lead_id: "l10" }],
      },
    },
  ],
  mission: {
    prompt_name: "leadbay_qualify_top_n",
    scenario_name: "default-batch",
    user_intent: "Bulk-qualify the top 10 unqualified leads and summarize the batch.",
    success_criteria: [
      "called leadbay_bulk_qualify_leads with count=10",
      "named still_running leads explicitly (l8, l9, l10) so the user can poll later",
      "surfaced the 3 highest ai_agent_lead_score leads from THIS batch (Apex, Bayside, Cedar)",
      "did NOT call leadbay_research_lead — wait for user go",
    ],
    required_calls: ["leadbay_bulk_qualify_leads"],
    required_byproducts: [],
    forbidden_calls: ["leadbay_research_lead", "leadbay_report_outreach"],
  },
};
