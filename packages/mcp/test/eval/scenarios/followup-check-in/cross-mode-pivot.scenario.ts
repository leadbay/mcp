/**
 * Cross-mode pivot — after the follow-up check-in returns, the user says
 * "actually show me NEW leads instead". Expected: the agent recognizes
 * the pivot and routes to the discovery path (`leadbay_pull_leads`).
 *
 * This is a single-prompt scenario that fixtures both the initial
 * follow-up pull AND the discovery refresh; the agent is expected to
 * call both during the session.
 *
 * Fixture paths match the actual LeadbayClient API calls:
 *   - pull_followups: GET /1.5/monitor?... (regex — query params vary)
 *   - pull_leads:     GET /lenses/{lensId}/leads/wishlist?count=20&page=0&contacts=true
 *                     + GET /leads/{id}/ai_agent_responses (per lead, soft-fail)
 */
import type { ScenarioFixture } from "../daily-check-in/clean-batch.scenario.js";

const ORG_ID = "org_cmp_001";
const LENS_ID = 55;
const P = (path: string) => `/1.5${path}`;

export const SCENARIO: ScenarioFixture<Record<string, never>> = {
  name: "cross-mode-pivot",
  prompt: "leadbay_followup_check_in",
  tier: "gate",
  args: {},
  backendFixtures: [
    // ── pull_leads resolveDefaultLens: GET /users/me ──────────────────────
    // (consumed when the agent pivots to pull_leads after the followup check-in)
    {
      method: "GET",
      path: P("/users/me"),
      status: 200,
      body: {
        id: "user_cmp_001",
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
        last_requested_lens: LENS_ID,
      },
    },
    // ── pull_followups: GET /monitor?... (regex — query params vary) ──────
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
    // ── pull_leads (pivot): GET /lenses/{lensId}/leads/wishlist ──────────
    {
      method: "GET",
      path: P(`/lenses/${LENS_ID}/leads/wishlist?count=20&page=0&contacts=true`),
      status: 200,
      body: {
        items: [
          {
            id: "d1",
            name: "Fresh Co",
            score: 0.85,
            ai_agent_lead_score: 0.9,
            short_description: "Fresh from the wishlist.",
            location: { city: "Berlin", country: "DE", full: "Berlin, Germany", pos: null, state: null },
            size: { low: 50, high: 200, min: 50, max: 200, label: "50-200" },
            website: "https://fresh.example",
            liked: false,
            disliked: false,
            new: true,
            tags: [],
            contacts_count: 0,
            org_contacts_count: 0,
            recommended_contact: null,
          },
        ],
        pagination: { page: 0, count: 20, total: 1, has_more: false },
        computing_wishlist: false,
        computing_scores: false,
      },
    },
    // ── pull_leads: ai_agent_responses per lead (soft-fail OK) ───────────
    {
      method: "GET",
      path: P(`/leads/d1/ai_agent_responses`),
      status: 200,
      body: [
        {
          question: "Is this a strong B2B fit?",
          lead_id: "d1",
          score: 18,
          response: "Strong fit.",
          computed_at: "2026-05-01T00:00:00Z",
          question_created_at: "2026-01-01T00:00:00Z",
        },
      ],
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
