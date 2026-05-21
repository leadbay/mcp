import type { ScenarioFixture } from "../daily-check-in/clean-batch.scenario.js";

export const SCENARIO: ScenarioFixture<{ campaign: string }> = {
  name: "default-readiness",
  prompt: "leadbay_work_campaign",
  tier: "gate",
  args: { campaign: "Q2 Push" },
  backendFixtures: [
    {
      method: "GET",
      path: "/1.5/campaigns",
      status: 200,
      body: [
        {
          campaign: {
            id: "camp_q2_push",
            name: "Q2 Push",
            ai_generated_name: null,
            ai_name_count: 0,
            archived: false,
            created_by: "user_1",
            created_at: "2026-05-20T10:00:00Z",
            updated_at: "2026-05-20T12:00:00Z",
            last_accessed_at: "2026-05-20T12:00:00Z",
          },
          lead_count: 2,
          contact_count: 2,
          contacted: 0,
          meeting_booked: 0,
          declined: 0,
        },
      ],
    },
    {
      method: "GET",
      path: "/1.5/campaigns/camp_q2_push/contacts",
      status: 200,
      body: [
        {
          lead_id: "lead_peak",
          lead_name: "Peak Performers",
          progress: { total_contacts: 2, in_progress: 0, declined: 0 },
          affiliation: { own_campaigns: [], other_users_campaign_count: 0 },
          contacts: [
            {
              lead_id: "lead_peak",
              contact: {
                id: "contact_bree",
                first_name: "Bree",
                last_name: "Sarlati",
                email: "bree@example.com",
                phone_number: "+1 512-775-7933",
                linkedin_page: "https://www.linkedin.com/in/bree-sarlati/",
                job_title: "CEO",
                recommended: true,
                pinned: false,
                pinned_by_ai: true,
              },
              recent_notes: [],
            },
          ],
        },
      ],
    },
    {
      method: "GET",
      path: "/1.5/campaigns/camp_q2_push/leads?count=50&page=0",
      status: 200,
      body: {
        items: [
          {
            lead: {
              id: "lead_peak",
              name: "Peak Performers",
              score: 86,
              ai_agent_lead_score: 92,
              website: "https://peak.example",
              location: {
                city: "Austin",
                state: "Texas",
                country: "US",
                full: "Austin, TX, US",
                pos: [30.3192287, -97.7369031],
              },
              phone_numbers: [],
              split_ai_summary: {
                next_step: "Call Bree about operations staffing gaps.",
                approach_angle: "Hiring signal",
                worth_pursuing: "Strong fit",
              },
            },
            progress: {
              total_contacts: 2,
              in_progress: 0,
              declined: 0,
              headline: null,
            },
            affiliation: { own_campaigns: [], other_users_campaign_count: 0 },
          },
        ],
        pagination: { page: 0, pages: 1, total: 1 },
      },
    },
  ],
  mission: {
    prompt_name: "leadbay_work_campaign",
    scenario_name: "default-readiness",
    user_intent:
      "Start working an existing campaign. The agent should resolve the campaign, fetch the call-sheet readiness, and propose a session mode without mutating outreach state.",
    success_criteria: [
      "called leadbay_list_campaigns to resolve the campaign name",
      "called leadbay_campaign_call_sheet for the selected campaign",
      "did NOT call leadbay_campaign_progression for the call-ready view",
      "did NOT call leadbay_report_outreach before the user dictated an outcome",
      "did NOT call leadbay_enrich_titles before the user selected enrich-first mode",
    ],
    required_calls: ["leadbay_list_campaigns", "leadbay_campaign_call_sheet"],
    required_byproducts: [],
    forbidden_calls: [
      "leadbay_campaign_progression",
      "leadbay_report_outreach",
      "leadbay_enrich_titles",
    ],
  },
};
