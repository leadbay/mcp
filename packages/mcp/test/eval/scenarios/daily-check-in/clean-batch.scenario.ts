/**
 * Daily check-in scenario: a clean fresh-batch morning.
 *
 * The user has quota, the active lens has a fresh batch with 3 qualified
 * leads, the top one has a clear signal. Expected agent behavior:
 *   1. Call leadbay_account_status
 *   2. Call leadbay_pull_leads
 *   3. Call leadbay_research_lead_by_id on the top lead
 *   4. Emit "STOP — awaiting user decision" byproduct
 *   5. NOT call leadbay_report_outreach
 *
 * Fixture paths match the actual LeadbayClient API calls:
 *   - account_status:        GET /users/me + GET /organizations/{orgId}/quota_status
 *   - pull_leads:            GET /lenses/{lensId}/leads/wishlist?...
 *                            + GET /leads/{id}/ai_agent_responses (per lead, soft-fail)
 *   - research_lead_by_id:   POST /interactions + GET /lenses/{lensId}/leads/{leadId} (required)
 *                            + sub-requests (all soft-fail)
 */
import type { MissionMatchScenario } from "../../helpers/mission-match-judge.js";

export interface ScenarioFixture<TArgs = Record<string, string | undefined>> {
  name: string;
  prompt: string;
  tier: "gate" | "periodic";
  args: TArgs;
  backendFixtures: BackendFixture[];
  mission: MissionMatchScenario;
}

export interface BackendFixture {
  method: string;
  path: string | RegExp;
  status: number;
  body: unknown;
}

const ORG_ID = "org_cb_001";
const LENS_ID = 11;
// LeadbayClient constructs URLs as ${baseUrl}/1.5${path} — all fixture paths
// must include the /1.5 prefix so the https.request path matcher hits.
const P = (path: string) => `/1.5${path}`;

export const SCENARIO: ScenarioFixture<Record<string, never>> = {
  name: "clean-batch",
  prompt: "leadbay_daily_check_in",
  tier: "gate",
  args: {},
  backendFixtures: [
    // ── account_status: GET /users/me ─────────────────────────────────────
    {
      method: "GET",
      path: P("/users/me"),
      status: 200,
      body: {
        id: "user_cb_001",
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
    // ── account_status: GET /organizations/{orgId}/quota_status ──────────
    {
      method: "GET",
      path: P(`/organizations/${ORG_ID}/quota_status`),
      status: 200,
      body: {
        ai_rescore_remaining: 250,
        web_fetch_remaining: 500,
        monitored_remaining: 30,
      },
    },
    // ── pull_leads: GET /lenses/{lensId}/leads/wishlist ───────────────────
    {
      method: "GET",
      path: P(`/lenses/${LENS_ID}/leads/wishlist?count=20&page=0&contacts=true`),
      status: 200,
      body: {
        items: [
          {
            id: "lead_cb_001",
            name: "Acme Health",
            score: 0.82,
            ai_agent_lead_score: 0.91,
            short_description:
              "Mid-sized hospital network running self-hosted EMR; growing operations team — strong IT spend signal.",
            location: { city: "London", country: "GB", full: "London, UK", pos: null, state: null },
            size: { low: 500, high: 1000, min: 500, max: 1000, label: "500-1000" },
            website: "https://acmehealth.example",
            liked: false,
            disliked: false,
            new: true,
            tags: [],
            contacts_count: 1,
            org_contacts_count: 1,
          },
          {
            id: "lead_cb_002",
            name: "Bryant Medical",
            score: 0.74,
            ai_agent_lead_score: 0.78,
            short_description: "Regional hospital chain; recent migration RFP issued.",
            location: { city: "Manchester", country: "GB", full: "Manchester, UK", pos: null, state: null },
            size: { low: 200, high: 500, min: 200, max: 500, label: "200-500" },
            website: "https://bryantmed.example",
            liked: false,
            disliked: false,
            new: true,
            tags: [],
            contacts_count: 0,
            org_contacts_count: 0,
          },
          {
            id: "lead_cb_003",
            name: "Coastline Health",
            score: 0.61,
            ai_agent_lead_score: 0.67,
            short_description: "Smaller hospital, fewer signals but in-region.",
            location: { city: "Bristol", country: "GB", full: "Bristol, UK", pos: null, state: null },
            size: { low: 100, high: 300, min: 100, max: 300, label: "100-300" },
            website: "https://coastlinehealth.example",
            liked: false,
            disliked: false,
            new: true,
            tags: [],
            contacts_count: 0,
            org_contacts_count: 0,
          },
        ],
        pagination: { page: 0, count: 20, total: 3, has_more: false },
        computing_wishlist: false,
        computing_scores: false,
      },
    },
    // ── pull_leads: ai_agent_responses per lead (soft-fail OK) ───────────
    {
      method: "GET",
      path: P(`/leads/lead_cb_001/ai_agent_responses`),
      status: 200,
      body: [
        {
          question: "Is this a B2B healthcare company with 200+ employees?",
          lead_id: "lead_cb_001",
          score: 20,
          response: "Yes — mid-sized hospital network, ~700 employees, running self-hosted EMR.",
          computed_at: "2026-05-01T00:00:00Z",
          question_created_at: "2026-01-01T00:00:00Z",
        },
      ],
    },
    {
      method: "GET",
      path: P(`/leads/lead_cb_002/ai_agent_responses`),
      status: 200,
      body: [],
    },
    {
      method: "GET",
      path: P(`/leads/lead_cb_003/ai_agent_responses`),
      status: 200,
      body: [],
    },
    // ── bulk_qualify_leads: wishlist (count=50, called if agent runs qualifier) ─
    {
      method: "GET",
      path: P(`/lenses/${LENS_ID}/leads/wishlist?count=50&page=0`),
      status: 200,
      body: {
        items: [
          { id: "lead_cb_001", name: "Acme Health", score: 0.82, ai_agent_lead_score: 0.91,
            liked: false, disliked: false, tags: [], contacts_count: 1, org_contacts_count: 1 },
          { id: "lead_cb_002", name: "Bryant Medical", score: 0.74, ai_agent_lead_score: 0.78,
            liked: false, disliked: false, tags: [], contacts_count: 0, org_contacts_count: 0 },
          { id: "lead_cb_003", name: "Coastline Health", score: 0.61, ai_agent_lead_score: 0.67,
            liked: false, disliked: false, tags: [], contacts_count: 0, org_contacts_count: 0 },
        ],
        pagination: { page: 0, count: 50, total: 3, has_more: false },
        computing_wishlist: false,
        computing_scores: false,
      },
    },
    // bulk_qualify_leads: POST web_fetch per lead (soft-fail)
    {
      method: "POST",
      path: P(`/leads/lead_cb_001/web_fetch?force_fetch=false`),
      status: 200,
      body: { in_progress: false, fetch_at: "2026-05-20T00:00:00Z", content: {} },
    },
    {
      method: "POST",
      path: P(`/leads/lead_cb_002/web_fetch?force_fetch=false`),
      status: 200,
      body: { in_progress: false, fetch_at: "2026-05-20T00:00:00Z", content: {} },
    },
    {
      method: "POST",
      path: P(`/leads/lead_cb_003/web_fetch?force_fetch=false`),
      status: 200,
      body: { in_progress: false, fetch_at: "2026-05-20T00:00:00Z", content: {} },
    },
    // ── research_lead_by_id: POST /interactions (fire-and-forget) ─────────
    {
      method: "POST",
      path: P("/interactions"),
      status: 204,
      body: null,
    },
    // ── research_lead_by_id: GET /lenses/{lensId}/leads/{leadId} (required) ─
    {
      method: "GET",
      path: P(`/lenses/${LENS_ID}/leads/lead_cb_001`),
      status: 200,
      body: {
        id: "lead_cb_001",
        name: "Acme Health",
        score: 0.82,
        ai_agent_lead_score: 0.91,
        short_description:
          "Mid-sized hospital network running self-hosted EMR; growing operations team — strong IT spend signal.",
        description: "Acme Health operates a network of regional hospitals with a self-hosted EMR stack.",
        location: { city: "London", country: "GB", full: "London, UK", pos: null, state: null },
        size: { low: 500, high: 1000, min: 500, max: 1000, label: "500-1000" },
        website: "https://acmehealth.example",
        liked: false,
        disliked: false,
        new: true,
        tags: [],
        contacts_count: 1,
        org_contacts_count: 1,
        notes_count: 0,
        epilogue_actions_count: 0,
        prospecting_actions_count: 0,
        recommended_contact: {
          id: "c_cb_1",
          first_name: "Jamie",
          last_name: "Park",
          job_title: "VP of IT",
          email: "jamie@acmehealth.example",
          linkedin_page: "https://www.linkedin.com/in/jamie-park",
        },
        social_presence: {
          crunchbase: false, facebook: false, instagram: false,
          linkedin: true, tiktok: false, twitter: false,
        },
      },
    },
    // ── research_lead_by_id: sub-requests (all soft-fail OK) ─────────────
    {
      method: "GET",
      path: P(`/leads/lead_cb_001/ai_agent_responses`),
      status: 200,
      body: [
        {
          question: "Is this a B2B healthcare company with 200+ employees?",
          lead_id: "lead_cb_001",
          score: 20,
          response: "Yes — mid-sized hospital network, ~700 employees, running self-hosted EMR.",
          computed_at: "2026-05-01T00:00:00Z",
          question_created_at: "2026-01-01T00:00:00Z",
        },
      ],
    },
    {
      method: "GET",
      path: P(`/leads/lead_cb_001/enrich/contacts?IncludeEnriched=true`),
      status: 200,
      body: [
        {
          id: "c_cb_1",
          first_name: "Jamie",
          last_name: "Park",
          job_title: "VP of IT",
          email: "jamie@acmehealth.example",
          phone_number: null,
          linkedin_page: "https://www.linkedin.com/in/jamie-park",
          recommended: true,
          enrichment: { done: true },
        },
      ],
    },
    {
      method: "GET",
      path: P(`/leads/lead_cb_001/web_fetch`),
      status: 200,
      body: {
        in_progress: false,
        fetch_at: "2026-05-20T00:00:00Z",
        content: {
          "🏢 company profile": [
            { text: "Recent EMR migration RFP issued in Q1 2026", hot: true },
            { text: "IT team expanded by 30% last year", hot: true },
          ],
        },
      },
    },
    {
      method: "GET",
      path: P(`/leads/lead_cb_001/activities?count=20`),
      status: 200,
      body: { items: [], total: 0 },
    },
    {
      method: "GET",
      path: P(`/leads/lead_cb_001/contacts?IncludeEnriched=true`),
      status: 200,
      body: [
        {
          id: "c_cb_1",
          first_name: "Jamie",
          last_name: "Park",
          job_title: "VP of IT",
          email: "jamie@acmehealth.example",
          phone_number: null,
          linkedin_page: "https://www.linkedin.com/in/jamie-park",
          recommended: true,
        },
      ],
    },
  ],
  mission: {
    prompt_name: "leadbay_daily_check_in",
    scenario_name: "clean-batch",
    user_intent:
      "Show me my morning check-in: account state, fresh batch, the most-promising lead, then stop and wait.",
    success_criteria: [
      "called leadbay_account_status exactly once",
      "called leadbay_pull_leads exactly once",
      "called leadbay_research_lead_by_id exactly once on the top-scoring lead (lead_001 / Acme Health)",
      "emitted the STOP byproduct asking for next-action decision",
      "did NOT call leadbay_report_outreach",
    ],
    required_calls: ["leadbay_account_status", "leadbay_pull_leads", "leadbay_research_lead_by_id"],
    required_byproducts: ["STOP — awaiting user decision"],
    forbidden_calls: ["leadbay_report_outreach"],
  },
};
