import type { ScenarioFixture } from "../daily-check-in/clean-batch.scenario.js";

const ORG_ID = "org_qn_001";
const LENS_ID = 33;
const P = (path: string) => `/1.5${path}`;

export const SCENARIO: ScenarioFixture<{ count: string }> = {
  name: "default-batch",
  prompt: "leadbay_qualify_top_n",
  tier: "gate",
  args: { count: "10" },
  backendFixtures: [
    // ── bulk_qualify_leads resolveDefaultLens: GET /users/me ─────────────
    {
      method: "GET",
      path: P("/users/me"),
      status: 200,
      body: {
        id: "user_qn_001",
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
    // ── bulk_qualify_leads: GET /lenses/{lensId}/leads/wishlist?count=50&page=0 ─
    {
      method: "GET",
      path: P(`/lenses/${LENS_ID}/leads/wishlist?count=50&page=0`),
      status: 200,
      body: {
        items: [
          { id: "l1", name: "Apex Health", score: 0.88, ai_agent_lead_score: 0.91,
            liked: false, disliked: false, tags: [], contacts_count: 1, org_contacts_count: 1 },
          { id: "l2", name: "Bayside Clinic", score: 0.82, ai_agent_lead_score: 0.84,
            liked: false, disliked: false, tags: [], contacts_count: 0, org_contacts_count: 0 },
          { id: "l3", name: "Cedar Medical", score: 0.77, ai_agent_lead_score: 0.79,
            liked: false, disliked: false, tags: [], contacts_count: 0, org_contacts_count: 0 },
          { id: "l4", name: "Delta Care", score: 0.70, ai_agent_lead_score: 0.72,
            liked: false, disliked: false, tags: [], contacts_count: 0, org_contacts_count: 0 },
          { id: "l5", name: "Echo Health", score: 0.63, ai_agent_lead_score: 0.65,
            liked: false, disliked: false, tags: [], contacts_count: 0, org_contacts_count: 0 },
          { id: "l6", name: "Foster Center", score: 0.60, ai_agent_lead_score: 0.62,
            liked: false, disliked: false, tags: [], contacts_count: 0, org_contacts_count: 0 },
          { id: "l7", name: "Greene Practice", score: 0.55, ai_agent_lead_score: 0.58,
            liked: false, disliked: false, tags: [], contacts_count: 0, org_contacts_count: 0 },
          { id: "l8", name: "Harbor Group", score: 0.50, ai_agent_lead_score: null,
            liked: false, disliked: false, tags: [], contacts_count: 0, org_contacts_count: 0 },
          { id: "l9", name: "Iris Medical", score: 0.48, ai_agent_lead_score: null,
            liked: false, disliked: false, tags: [], contacts_count: 0, org_contacts_count: 0 },
          { id: "l10", name: "Jensen Clinic", score: 0.45, ai_agent_lead_score: null,
            liked: false, disliked: false, tags: [], contacts_count: 0, org_contacts_count: 0 },
        ],
        pagination: { page: 0, count: 50, total: 10, has_more: false },
        computing_wishlist: false,
        computing_scores: false,
      },
    },
    // ── bulk_qualify_leads: POST web_fetch per lead (soft-fail) ──────────
    { method: "POST", path: P(`/leads/l1/web_fetch?force_fetch=false`), status: 200,
      body: { in_progress: false, fetch_at: "2026-05-20T00:00:00Z", content: {} } },
    { method: "POST", path: P(`/leads/l2/web_fetch?force_fetch=false`), status: 200,
      body: { in_progress: false, fetch_at: "2026-05-20T00:00:00Z", content: {} } },
    { method: "POST", path: P(`/leads/l3/web_fetch?force_fetch=false`), status: 200,
      body: { in_progress: false, fetch_at: "2026-05-20T00:00:00Z", content: {} } },
    { method: "POST", path: P(`/leads/l4/web_fetch?force_fetch=false`), status: 200,
      body: { in_progress: false, fetch_at: "2026-05-20T00:00:00Z", content: {} } },
    { method: "POST", path: P(`/leads/l5/web_fetch?force_fetch=false`), status: 200,
      body: { in_progress: false, fetch_at: "2026-05-20T00:00:00Z", content: {} } },
    { method: "POST", path: P(`/leads/l6/web_fetch?force_fetch=false`), status: 200,
      body: { in_progress: false, fetch_at: "2026-05-20T00:00:00Z", content: {} } },
    { method: "POST", path: P(`/leads/l7/web_fetch?force_fetch=false`), status: 200,
      body: { in_progress: false, fetch_at: "2026-05-20T00:00:00Z", content: {} } },
    { method: "POST", path: P(`/leads/l8/web_fetch?force_fetch=false`), status: 200,
      body: { in_progress: false, fetch_at: "2026-05-20T00:00:00Z", content: {} } },
    { method: "POST", path: P(`/leads/l9/web_fetch?force_fetch=false`), status: 200,
      body: { in_progress: false, fetch_at: "2026-05-20T00:00:00Z", content: {} } },
    { method: "POST", path: P(`/leads/l10/web_fetch?force_fetch=false`), status: 200,
      body: { in_progress: false, fetch_at: "2026-05-20T00:00:00Z", content: {} } },
    // ── bulk_qualify_leads: GET ai_agent_responses per lead ───────────────
    {
      method: "GET",
      path: P(`/leads/l1/ai_agent_responses`),
      status: 200,
      body: [
        { question: "Is this a strong B2B fit?", lead_id: "l1", score: 20,
          response: "Strong fit.", computed_at: "2026-05-01T00:00:00Z", question_created_at: "2026-01-01T00:00:00Z" },
      ],
    },
    {
      method: "GET",
      path: P(`/leads/l2/ai_agent_responses`),
      status: 200,
      body: [
        { question: "Is this a strong B2B fit?", lead_id: "l2", score: 17,
          response: "Good fit.", computed_at: "2026-05-01T00:00:00Z", question_created_at: "2026-01-01T00:00:00Z" },
      ],
    },
    {
      method: "GET",
      path: P(`/leads/l3/ai_agent_responses`),
      status: 200,
      body: [
        { question: "Is this a strong B2B fit?", lead_id: "l3", score: 14,
          response: "Moderate.", computed_at: "2026-05-01T00:00:00Z", question_created_at: "2026-01-01T00:00:00Z" },
      ],
    },
    {
      method: "GET",
      path: P(`/leads/l4/ai_agent_responses`),
      status: 200,
      body: [
        { question: "Is this a strong B2B fit?", lead_id: "l4", score: 12,
          response: "Borderline.", computed_at: "2026-05-01T00:00:00Z", question_created_at: "2026-01-01T00:00:00Z" },
      ],
    },
    {
      method: "GET",
      path: P(`/leads/l5/ai_agent_responses`),
      status: 200,
      body: [
        { question: "Is this a strong B2B fit?", lead_id: "l5", score: 10,
          response: "Marginal.", computed_at: "2026-05-01T00:00:00Z", question_created_at: "2026-01-01T00:00:00Z" },
      ],
    },
    {
      method: "GET",
      path: P(`/leads/l6/ai_agent_responses`),
      status: 200,
      body: [
        { question: "Is this a strong B2B fit?", lead_id: "l6", score: 9,
          response: "Uncertain.", computed_at: "2026-05-01T00:00:00Z", question_created_at: "2026-01-01T00:00:00Z" },
      ],
    },
    {
      method: "GET",
      path: P(`/leads/l7/ai_agent_responses`),
      status: 200,
      body: [
        { question: "Is this a strong B2B fit?", lead_id: "l7", score: 8,
          response: "Weak signal.", computed_at: "2026-05-01T00:00:00Z", question_created_at: "2026-01-01T00:00:00Z" },
      ],
    },
    { method: "GET", path: P(`/leads/l8/ai_agent_responses`), status: 200, body: [] },
    { method: "GET", path: P(`/leads/l9/ai_agent_responses`), status: 200, body: [] },
    { method: "GET", path: P(`/leads/l10/ai_agent_responses`), status: 200, body: [] },
  ],
  mission: {
    prompt_name: "leadbay_qualify_top_n",
    scenario_name: "default-batch",
    user_intent: "Bulk-qualify the top 10 unqualified leads and summarize the batch.",
    success_criteria: [
      "called leadbay_bulk_qualify_leads with count=10",
      "named still_running leads explicitly (l8, l9, l10) so the user can poll later",
      "surfaced the 3 highest ai_agent_lead_score leads from THIS batch (Apex, Bayside, Cedar)",
      "did NOT call leadbay_research_lead_by_id — wait for user go",
    ],
    required_calls: ["leadbay_bulk_qualify_leads"],
    required_byproducts: [],
    forbidden_calls: ["leadbay_research_lead_by_id", "leadbay_report_outreach"],
  },
};
