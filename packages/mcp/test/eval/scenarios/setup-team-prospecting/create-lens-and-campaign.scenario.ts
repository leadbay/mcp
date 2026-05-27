/**
 * Manager-led prospecting scenario: manager sets up a lens + campaign for reps.
 *
 * Expected agent behavior (WORKFLOWS.md #11):
 *   1. Call leadbay_create_lens (or leadbay_refine_prompt) to build the audience
 *   2. Call leadbay_pull_leads to validate the lens produces results
 *   3. Call leadbay_create_campaign to persist a named campaign
 *   4. Add validated leads via leadbay_add_leads_to_campaign
 *   5. NOT call leadbay_report_outreach unilaterally
 *
 * Fixture paths:
 *   - create_lens:          POST /lenses
 *   - pull_leads:           GET /lenses/{id}/leads/wishlist
 *   - create_campaign:      POST /campaigns
 *   - add_leads_to_campaign: POST /campaigns/{id}/leads
 */
import type { ScenarioFixture } from "../daily-check-in/clean-batch.scenario.js";

const NEW_LENS_ID = 55;
const CAMPAIGN_ID = "camp_team_001";
const P = (path: string) => `/1.5${path}`;

export const SCENARIO: ScenarioFixture<{ audience: string; rep_split?: string }> = {
  name: "create-lens-and-campaign",
  prompt: "leadbay_setup_team_prospecting",
  tier: "periodic",
  args: { audience: "plumbing companies with 10-50 employees in Normandy", rep_split: "split by city" },
  backendFixtures: [
    {
      method: "GET",
      path: P("/users/me"),
      status: 200,
      body: {
        id: "user_mgr_001",
        email: "manager@leadbay.ai",
        name: "Manager User",
        admin: false,
        manager: true,
        organization: { id: "org_mgr_001", name: "Manager Demo Org", ai_agent_enabled: true, computing_intelligence: false },
        last_requested_lens: NEW_LENS_ID,
      },
    },
    {
      method: "GET",
      path: P(`/organizations/org_mgr_001/quota_status`),
      status: 200,
      body: { ai_rescore_remaining: 200, web_fetch_remaining: 600, monitored_remaining: 40 },
    },
    {
      method: "GET",
      path: P("/lenses"),
      status: 200,
      body: [{ id: NEW_LENS_ID, name: "Plumbing Normandy", user_prompt: "plumbing 10-50 Normandy" }],
    },
    {
      method: "POST",
      path: P("/lenses"),
      status: 201,
      body: { id: NEW_LENS_ID, name: "Plumbing Normandy", user_prompt: "plumbing 10-50 Normandy" },
    },
    {
      method: "GET",
      path: P("/lenses/active"),
      status: 200,
      body: { id: NEW_LENS_ID, name: "Plumbing Normandy" },
    },
    {
      method: "GET",
      path: P(`/lenses/${NEW_LENS_ID}/leads/wishlist?count=20&page=0&contacts=true`),
      status: 200,
      body: {
        items: [
          {
            id: "lead_plumb_001",
            name: "Plomberie Martin",
            score: 0.84,
            ai_agent_lead_score: 0.87,
            short_description: "Family-run plumbing contractor in Rouen; 20 employees.",
            location: { city: "Rouen", country: "FR", full: "Rouen, Normandy, France", pos: null, state: null },
            size: { low: 10, high: 50, min: 10, max: 50, label: "10-50" },
            website: "https://plomberie-martin.example",
            liked: false, disliked: false, new: true, tags: [], contacts_count: 1, org_contacts_count: 1,
          },
          {
            id: "lead_plumb_002",
            name: "Caen Plomberie Pro",
            score: 0.76,
            ai_agent_lead_score: 0.80,
            short_description: "Commercial plumbing firm in Caen; 35 employees.",
            location: { city: "Caen", country: "FR", full: "Caen, Normandy, France", pos: null, state: null },
            size: { low: 10, high: 50, min: 10, max: 50, label: "10-50" },
            website: "https://caen-plomberie.example",
            liked: false, disliked: false, new: true, tags: [], contacts_count: 0, org_contacts_count: 0,
          },
        ],
        pagination: { page: 0, count: 20, total: 2, has_more: false },
        computing_wishlist: false,
        computing_scores: false,
      },
    },
    {
      method: "GET",
      path: P(`/leads/lead_plumb_001/ai_agent_responses`),
      status: 200,
      body: [],
    },
    {
      method: "GET",
      path: P(`/leads/lead_plumb_002/ai_agent_responses`),
      status: 200,
      body: [],
    },
    {
      method: "POST",
      path: P("/campaigns"),
      status: 201,
      body: { id: CAMPAIGN_ID, name: "Plomberie Normandy — Rouen rep", status: "active" },
    },
    {
      method: "POST",
      path: P(`/campaigns/${CAMPAIGN_ID}/leads`),
      status: 200,
      body: { added: 1 },
    },
  ],
  mission: {
    prompt_name: "leadbay_setup_team_prospecting",
    scenario_name: "create-lens-and-campaign",
    user_intent:
      "Set up a prospecting lens for plumbing companies in Normandy with 10-50 employees, validate the leads, and create named campaigns split by city for the reps.",
    success_criteria: [
      "created or activated a lens targeting the plumbing audience in Normandy",
      "called leadbay_pull_leads to validate the lens produces results",
      "created at least one named campaign via leadbay_create_campaign",
      "added leads to the campaign via leadbay_add_leads_to_campaign",
      "did NOT call leadbay_report_outreach",
    ],
    required_calls: ["leadbay_pull_leads", "leadbay_create_campaign"],
    required_byproducts: [],
    forbidden_calls: ["leadbay_report_outreach"],
  },
};
