/**
 * Qualify-top-N regression scenario for B23.
 *
 * After 0.9.1, Phase 3 of `leadbay_qualify_top_n` must:
 *  - render the qualify-status update as the canonical
 *    `{{include:rendering/status-inline}}` single-sentence shape, NOT a
 *    multi-line card;
 *  - re-pull via `leadbay_pull_leads` with the same lensId and render the
 *    newly-qualified leads using the canonical pull-leads-table layout
 *    (score-bar + linked company + why-it-fits + contact), with a
 *    "Standouts from this batch" line ABOVE the table.
 *
 * This scenario gives the qualifier a clean batch and asserts the agent
 * issues the refresh pull_leads call and renders the table — not a
 * freeform summary.
 *
 * Fixture paths match the actual LeadbayClient API calls:
 *   - bulk_qualify_leads:  GET /lenses/{lensId}/leads/wishlist?count=50&page=0
 *                          + POST /leads/{id}/web_fetch (per lead, soft-fail)
 *                          + GET /leads/{id}/ai_agent_responses (per lead, soft-fail)
 *   - pull_leads (refresh): GET /lenses/{lensId}/leads/wishlist?count=20&page=0&contacts=true
 *                          + GET /leads/{id}/ai_agent_responses (per lead, soft-fail)
 */
import type { ScenarioFixture } from "../daily-check-in/clean-batch.scenario.js";

const ORG_ID = "org_rrt_001";
const LENS_ID = 44;
const P = (path: string) => `/1.5${path}`;

export const SCENARIO: ScenarioFixture<{ count: string }> = {
  name: "rendering-refresh-table",
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
        id: "user_rrt_001",
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
    // second copy consumed by pull_leads refresh resolveDefaultLens call
    {
      method: "GET",
      path: P("/users/me"),
      status: 200,
      body: {
        id: "user_rrt_001",
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
          { id: "ql1", name: "Apex Health", score: 0.82, ai_agent_lead_score: 0.91,
            liked: false, disliked: false, tags: [], contacts_count: 1, org_contacts_count: 1 },
          { id: "ql2", name: "Bayside Clinic", score: 0.76, ai_agent_lead_score: 0.84,
            liked: false, disliked: false, tags: [], contacts_count: 0, org_contacts_count: 0 },
          { id: "ql3", name: "Cedar Medical", score: 0.70, ai_agent_lead_score: 0.79,
            liked: false, disliked: false, tags: [], contacts_count: 0, org_contacts_count: 0 },
        ],
        pagination: { page: 0, count: 50, total: 3, has_more: false },
        computing_wishlist: false,
        computing_scores: false,
      },
    },
    // ── bulk_qualify_leads: POST web_fetch per lead (soft-fail) ──────────
    { method: "POST", path: P(`/leads/ql1/web_fetch?force_fetch=false`), status: 200,
      body: { in_progress: false, fetch_at: "2026-05-20T00:00:00Z", content: {} } },
    { method: "POST", path: P(`/leads/ql2/web_fetch?force_fetch=false`), status: 200,
      body: { in_progress: false, fetch_at: "2026-05-20T00:00:00Z", content: {} } },
    { method: "POST", path: P(`/leads/ql3/web_fetch?force_fetch=false`), status: 200,
      body: { in_progress: false, fetch_at: "2026-05-20T00:00:00Z", content: {} } },
    // ── bulk_qualify_leads: GET ai_agent_responses per lead ───────────────
    {
      method: "GET",
      path: P(`/leads/ql1/ai_agent_responses`),
      status: 200,
      body: [
        { question: "Strong IT spend?", lead_id: "ql1", score: 20,
          response: "Strong fit.", computed_at: "2026-05-01T00:00:00Z", question_created_at: "2026-01-01T00:00:00Z" },
      ],
    },
    {
      method: "GET",
      path: P(`/leads/ql2/ai_agent_responses`),
      status: 200,
      body: [
        { question: "Strong IT spend?", lead_id: "ql2", score: 17,
          response: "Good fit.", computed_at: "2026-05-01T00:00:00Z", question_created_at: "2026-01-01T00:00:00Z" },
      ],
    },
    {
      method: "GET",
      path: P(`/leads/ql3/ai_agent_responses`),
      status: 200,
      body: [
        { question: "Strong IT spend?", lead_id: "ql3", score: 14,
          response: "Moderate.", computed_at: "2026-05-01T00:00:00Z", question_created_at: "2026-01-01T00:00:00Z" },
      ],
    },
    // ── pull_leads (refresh): GET /lenses/{lensId}/leads/wishlist?count=20&page=0&contacts=true ─
    {
      method: "GET",
      path: P(`/lenses/${LENS_ID}/leads/wishlist?count=20&page=0&contacts=true`),
      status: 200,
      body: {
        items: [
          {
            id: "ql1",
            name: "Apex Health",
            score: 0.82,
            ai_agent_lead_score: 0.91,
            short_description: "Strong IT spend; recent EMR investment.",
            location: { city: "London", country: "GB", full: "London, UK", pos: null, state: null },
            size: { low: 500, high: 1000, min: 500, max: 1000, label: "500-1000" },
            website: "https://apexhealth.example",
            liked: false,
            disliked: false,
            new: true,
            tags: [{ id: "t1", display_name: "EMR", tag: "emr", score: 0.9 }],
            contacts_count: 1,
            org_contacts_count: 1,
            recommended_contact: {
              id: "c1",
              first_name: "Sasha",
              last_name: "Knight",
              job_title: "CTO",
              email: null,
              linkedin_page: "https://www.linkedin.com/in/sasha-knight",
            },
          },
          {
            id: "ql2",
            name: "Bayside Clinic",
            score: 0.76,
            ai_agent_lead_score: 0.84,
            short_description: "Mid-market clinic chain; growing footprint.",
            location: { city: "Bristol", country: "GB", full: "Bristol, UK", pos: null, state: null },
            size: { low: 100, high: 300, min: 100, max: 300, label: "100-300" },
            website: "https://bayside.example",
            liked: false,
            disliked: false,
            new: true,
            tags: [],
            contacts_count: 0,
            org_contacts_count: 0,
            recommended_contact: null,
          },
          {
            id: "ql3",
            name: "Cedar Medical",
            score: 0.70,
            ai_agent_lead_score: 0.79,
            short_description: "Regional hospital chain.",
            location: { city: "Manchester", country: "GB", full: "Manchester, UK", pos: null, state: null },
            size: { low: 200, high: 400, min: 200, max: 400, label: "200-400" },
            website: "https://cedarmed.example",
            liked: false,
            disliked: false,
            new: true,
            tags: [],
            contacts_count: 0,
            org_contacts_count: 0,
            recommended_contact: null,
          },
        ],
        pagination: { page: 0, count: 20, total: 3, has_more: false },
        computing_wishlist: false,
        computing_scores: false,
      },
    },
    // ── pull_leads refresh: ai_agent_responses per lead ───────────────────
    {
      method: "GET",
      path: P(`/leads/ql1/ai_agent_responses`),
      status: 200,
      body: [
        { question: "Strong IT spend?", lead_id: "ql1", score: 20,
          response: "Strong fit.", computed_at: "2026-05-01T00:00:00Z", question_created_at: "2026-01-01T00:00:00Z" },
      ],
    },
    {
      method: "GET",
      path: P(`/leads/ql2/ai_agent_responses`),
      status: 200,
      body: [
        { question: "Strong IT spend?", lead_id: "ql2", score: 17,
          response: "Good fit.", computed_at: "2026-05-01T00:00:00Z", question_created_at: "2026-01-01T00:00:00Z" },
      ],
    },
    {
      method: "GET",
      path: P(`/leads/ql3/ai_agent_responses`),
      status: 200,
      body: [
        { question: "Strong IT spend?", lead_id: "ql3", score: 14,
          response: "Moderate.", computed_at: "2026-05-01T00:00:00Z", question_created_at: "2026-01-01T00:00:00Z" },
      ],
    },
  ],
  mission: {
    prompt_name: "leadbay_qualify_top_n",
    scenario_name: "rendering-refresh-table",
    user_intent:
      "Bulk-qualify the top 10 leads. Render the qualify-status as one inline sentence, then issue a pull_leads refresh with the same lensId and render the newly-qualified leads using the canonical pull-leads table (score-bar columns), with a 'Standouts from this batch' line ABOVE.",
    success_criteria: [
      "called leadbay_bulk_qualify_leads with count=10",
      "rendered the qualify-status as a one-line status-inline sentence (e.g. starting with ✓ or ⏳), not as a multi-line card",
      "issued a leadbay_pull_leads refresh after the qualifier returned",
      "rendered the refreshed leads as a markdown TABLE with score-bar glyphs ▰/❖/▱ — NOT a numbered prose list",
      "added a 'Standouts from this batch' commentary line ABOVE the table for the 3 highest-scoring rows (Apex, Bayside, Cedar)",
      "did NOT call leadbay_research_lead_by_id — wait for user go",
    ],
    required_calls: ["leadbay_bulk_qualify_leads", "leadbay_pull_leads"],
    required_byproducts: ["Standouts from this batch", "▰"],
    forbidden_calls: ["leadbay_research_lead_by_id", "leadbay_report_outreach"],
  },
};
