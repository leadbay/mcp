/**
 * Cross-mode pivot — after the follow-up check-in returns, the user says
 * "actually show me NEW leads instead". Expected: the agent recognizes
 * the pivot and routes to the discovery path (`leadbay_pull_leads`).
 *
 * This is a single-prompt scenario that fixtures both the initial
 * follow-up pull AND the discovery refresh; the agent is expected to
 * call both during the session.
 */
import type { ScenarioFixture } from "../daily-check-in/clean-batch.scenario.js";

export const SCENARIO: ScenarioFixture<Record<string, never>> = {
  name: "cross-mode-pivot",
  prompt: "leadbay_followup_check_in",
  tier: "gate",
  args: {},
  backendFixtures: [
    {
      method: "GET",
      path: /\/1\.5\/monitor/,
      status: 200,
      body: {
        leads: [
          {
            lead_id: "p1",
            name: "Pivot Industries",
            website: "pivot.example",
            score: 0.7,
            location: { city: "Paris", state: "FR" },
            size: { min: 100, max: 500 },
            split_ai_summary: {
              worth_pursuing: "Yes — recent funding round",
              approach_angle: "Congratulate + offer relevant case study",
              next_step: "Email the CTO this week",
            },
            last_monitor_action_at: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
            last_prospecting_action: null,
            last_prospecting_action_at: null,
            epilogue_status: null,
            recommended_contact: null,
          },
        ],
        active_filters: { criteria: [] },
        total_excluded_by_pushback: 0,
        has_more: false,
      },
    },
    {
      method: "POST",
      path: "/v1/leads/discover",
      status: 200,
      body: {
        lens: { id: "lens_pivot", name: "Default" },
        leads: [
          {
            lead_id: "d1",
            name: "Fresh Co",
            website: "fresh.example",
            score: 0.85,
            ai_agent_lead_score: 0.9,
            location: { city: "Berlin", state: "DE" },
            size: { min: 50, max: 200 },
            short_description: "Fresh from the wishlist.",
            tags: [],
            qualification_summary: { answered: 4, best_response_excerpt: "Strong fit." },
            recommended_contact: null,
          },
        ],
      },
    },
  ],
  mission: {
    prompt_name: "leadbay_followup_check_in",
    scenario_name: "cross-mode-pivot",
    user_intent:
      "Run the follow-up check-in, then when the user pivots to 'show me NEW leads instead', call leadbay_pull_leads (Discover) and render the discovery table. Both entry-point calls should appear in the session.",
    success_criteria: [
      "called leadbay_pull_followups during the initial follow-up phase",
      "recognized the cross-mode pivot offer and pointed to the discovery path",
      "rendered each call's response using its own canonical RENDERING block (followups-table for the Monitor view; pull-leads-table for the Discover refresh if pivoted to)",
      "did not silently merge the two batches into one rendering",
    ],
    required_calls: ["leadbay_pull_followups"],
    required_byproducts: ["Want to see NEW leads"],
    forbidden_calls: ["leadbay_report_outreach"],
  },
};
