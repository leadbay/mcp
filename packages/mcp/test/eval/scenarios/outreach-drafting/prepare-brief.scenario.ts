/**
 * Outreach drafting scenario: user asks to draft an email to a specific lead.
 *
 * The agent is given a lead ID; it must call leadbay_prepare_outreach to
 * assemble the brief, then draft an email from the brief. Expected behavior:
 *   1. Call leadbay_prepare_outreach with the provided lead ID
 *   2. Draft an outreach email using the brief data
 *   3. NOT call leadbay_report_outreach (logging is a separate user step)
 *   4. Render via message_compose_v1 when available
 *
 * Fixture paths:
 *   - prepare_outreach: GET /lenses/{lensId}/leads/{leadId}
 *                       + GET /leads/{leadId}/contacts?IncludeEnriched=true
 */
import type { ScenarioFixture } from "../daily-check-in/clean-batch.scenario.js";

const LENS_ID = 33;
const LEAD_ID = "lead_od_001";
const P = (path: string) => `/1.5${path}`;

export const SCENARIO: ScenarioFixture<{ leadId: string }> = {
  name: "prepare-brief",
  prompt: "leadbay_daily_check_in",
  tier: "gate",
  args: { leadId: LEAD_ID },
  backendFixtures: [
    {
      method: "GET",
      path: P("/users/me"),
      status: 200,
      body: {
        id: "user_od_001",
        email: "demo@leadbay.ai",
        name: "Demo User",
        admin: false,
        manager: false,
        organization: { id: "org_od_001", name: "Outreach Demo Org", ai_agent_enabled: true, computing_intelligence: false },
        last_requested_lens: LENS_ID,
      },
    },
    {
      method: "GET",
      path: P(`/organizations/org_od_001/quota_status`),
      status: 200,
      body: { ai_rescore_remaining: 100, web_fetch_remaining: 300, monitored_remaining: 20 },
    },
    {
      method: "GET",
      path: P(`/lenses/${LENS_ID}/leads/${LEAD_ID}`),
      status: 200,
      body: {
        id: LEAD_ID,
        name: "HealthBridge Systems",
        score: 0.78,
        ai_agent_lead_score: 0.85,
        short_description: "Mid-market healthcare SaaS vendor; actively evaluating EMR integrations.",
        description: "HealthBridge Systems builds middleware for clinical data exchange. Recently raised Series B and expanded their engineering team.",
        location: { city: "Berlin", country: "DE", full: "Berlin, Germany", pos: null, state: null },
        size: { low: 200, high: 500, min: 200, max: 500, label: "200-500" },
        website: "https://healthbridge.example",
        liked: false,
        disliked: false,
        new: false,
        tags: [],
        contacts_count: 1,
        org_contacts_count: 1,
        notes_count: 0,
        epilogue_actions_count: 0,
        prospecting_actions_count: 1,
        recommended_contact: {
          id: "c_od_1",
          first_name: "Lukas",
          last_name: "Bauer",
          job_title: "Head of Partnerships",
          email: "lukas@healthbridge.example",
          linkedin_page: "https://www.linkedin.com/in/lukas-bauer",
        },
        social_presence: { crunchbase: true, facebook: false, instagram: false, linkedin: true, tiktok: false, twitter: false },
      },
    },
    {
      method: "GET",
      path: P(`/leads/${LEAD_ID}/contacts?IncludeEnriched=true`),
      status: 200,
      body: [
        {
          id: "c_od_1",
          first_name: "Lukas",
          last_name: "Bauer",
          job_title: "Head of Partnerships",
          email: "lukas@healthbridge.example",
          phone_number: null,
          linkedin_page: "https://www.linkedin.com/in/lukas-bauer",
          recommended: true,
          enrichment: { done: true },
        },
      ],
    },
    {
      method: "GET",
      path: P(`/leads/${LEAD_ID}/ai_agent_responses`),
      status: 200,
      body: [
        {
          question: "Does this company sell software to hospitals?",
          lead_id: LEAD_ID,
          score: 20,
          response: "Yes — HealthBridge builds clinical data exchange middleware for hospital networks.",
          computed_at: "2026-05-01T00:00:00Z",
          question_created_at: "2026-01-01T00:00:00Z",
        },
      ],
    },
    {
      method: "GET",
      path: P(`/leads/${LEAD_ID}/web_fetch`),
      status: 200,
      body: {
        in_progress: false,
        fetch_at: "2026-05-20T00:00:00Z",
        content: {
          "🏢 company profile": [
            { text: "Series B raised Q4 2025", hot: true },
            { text: "Engineering team grew 40% since funding", hot: true },
          ],
        },
      },
    },
    {
      method: "GET",
      path: P(`/leads/${LEAD_ID}/activities?count=20`),
      status: 200,
      body: { items: [], total: 0 },
    },
  ],
  mission: {
    prompt_name: "leadbay_daily_check_in",
    scenario_name: "prepare-brief",
    user_intent:
      "Draft an email to HealthBridge Systems — pull the brief and write me a personalised intro.",
    success_criteria: [
      "called leadbay_prepare_outreach at least once with the correct lead ID",
      "used the brief data (company description, contact name/role, recent signals) in the draft",
      "did NOT call leadbay_report_outreach (logging is a separate step)",
      "email draft is addressed to the recommended contact (Lukas Bauer, Head of Partnerships)",
    ],
    required_calls: ["leadbay_prepare_outreach"],
    required_byproducts: [],
    forbidden_calls: ["leadbay_report_outreach"],
  },
};
