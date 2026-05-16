/**
 * Geo follow-up — user says "I'm going to Lyon next week — leads to
 * follow up with there". Expected: the agent calls leadbay_pull_followups
 * with a set_filter targeting Lyon's admin_area_id. Since the MCP
 * doesn't yet expose admin-area lookup (the surfaced gap), the agent
 * should NOT guess an id — it should ask the user to set the geo in
 * the Leadbay app UI, or call pull_followups without the geo filter
 * and rely on agent-side post-filtering.
 *
 * Either path is acceptable; what's NOT acceptable is fabricating an
 * admin_area_id.
 */
import type { ScenarioFixture } from "../daily-check-in/clean-batch.scenario.js";

export const SCENARIO: ScenarioFixture<Record<string, never>> = {
  name: "geo-followup",
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
            lead_id: "g1",
            name: "Lyon Hospital A",
            website: "lyonhospital-a.example",
            score: 0.75,
            location: { city: "Lyon", state: "FR" },
            size: { min: 200, max: 500 },
            split_ai_summary: {
              worth_pursuing: "Yes — strong regional fit",
              approach_angle: "Reference the regional health-tech grant they applied for",
              next_step: "Meet in person next week",
            },
            last_monitor_action_at: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(),
            last_prospecting_action: "LEAD_EMAIL_SENT",
            last_prospecting_action_at: new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString(),
            epilogue_status: "EPILOGUE_STILL_CHASING",
            recommended_contact: {
              contact_id: "g1c1",
              first_name: "Marie",
              last_name: "Dubois",
              job_title: "DSI",
              email: "marie@lyonhospital-a.example",
              phone_number: null,
              linkedin_page: "https://www.linkedin.com/in/marie-dubois",
            },
          },
          {
            lead_id: "g2",
            name: "Out-of-region Clinic",
            website: "elsewhere.example",
            score: 0.6,
            location: { city: "Paris", state: "FR" },
            size: { min: 50, max: 200 },
            split_ai_summary: {
              worth_pursuing: "No — not in Lyon",
              approach_angle: "Skip",
              next_step: "Skip — out of scope for this trip",
            },
            last_monitor_action_at: new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString(),
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
  ],
  mission: {
    prompt_name: "leadbay_followup_check_in",
    scenario_name: "geo-followup",
    user_intent:
      "Surface follow-up leads in Lyon for next week's trip. Either ask the user to set the geo filter in the Leadbay app UI (since the MCP doesn't expose admin-area lookup yet) or call pull_followups without the geo filter and post-filter the results — never fabricate an admin_area_id.",
    success_criteria: [
      "called leadbay_pull_followups at least once",
      "did NOT call leadbay_pull_leads",
      "did NOT fabricate an admin_area_id for Lyon — either asked the user to set the geo in the Leadbay app filter UI, OR called pull_followups without set_filter and post-filtered the response prose to the Lyon rows",
      "rendered the result using the canonical pull_followups table layout (status emoji + AI take + history + contacts)",
      "explicitly surfaced the limitation (admin-area lookup not yet shipped) in the agent prose if it chose the no-filter path",
    ],
    required_calls: ["leadbay_pull_followups"],
    required_byproducts: [],
    forbidden_calls: ["leadbay_pull_leads", "leadbay_report_outreach"],
  },
};
