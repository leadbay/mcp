/**
 * Daily check-in regression scenario for B23 — prompts override per-tool
 * RENDERING blocks.
 *
 * History: in 0.9.0 we shipped RENDERING + NEXT STEPS blocks for every
 * composite. But agents kept rendering prose for the daily check-in
 * because the orchestrating prompt's Phase 3 directed motivational
 * one-liners and "won" over the per-tool RENDERING block.
 *
 * 0.9.1 patches the prompt to defer to the pull-leads-table snippet and
 * adds the `gates/defer-to-tool-rendering` snippet. This scenario asserts
 * the agent renders the canonical 3-column table (score-bar + linked
 * company + "why it fits" + contact) preceded by a "Today's nudges"
 * paragraph — NOT a numbered prose list.
 *
 * Expected byproducts include score-bar glyphs (`▰`, `▱`) and the
 * "Today's nudges" header. The pyramid + invariants check the tool
 * sequence; the LLM judge checks the rendering contract.
 *
 * Fixture paths match the actual LeadbayClient API calls:
 *   - account_status:        GET /users/me + GET /organizations/{orgId}/quota_status
 *   - pull_leads:            GET /lenses/{lensId}/leads/wishlist?...
 *                            + GET /leads/{id}/ai_agent_responses (per lead, soft-fail)
 *   - bulk_qualify_leads:    GET /lenses/{lensId}/leads/wishlist?count=50&page=0 (optional)
 */
import type { ScenarioFixture } from "./clean-batch.scenario.js";

const ORG_ID = "org_rtc_001";
const LENS_ID = 22;
const P = (path: string) => `/1.5${path}`;

export const SCENARIO: ScenarioFixture<Record<string, never>> = {
  name: "rendering-table-contract",
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
        id: "user_rtc_001",
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
            id: "lead_b23_001",
            name: "Acme Health",
            score: 0.82,
            ai_agent_lead_score: 0.91,
            short_description: "Mid-sized hospital network running self-hosted EMR.",
            location: { city: "London", country: "GB", full: "London, UK", pos: null, state: null },
            size: { low: 500, high: 1000, min: 500, max: 1000, label: "500-1000" },
            website: "https://acmehealth.example",
            liked: false,
            disliked: false,
            new: true,
            tags: [
              { id: "t1", display_name: "EMR", tag: "emr", score: 0.9 },
              { id: "t2", display_name: "Self-hosted", tag: "selfhost", score: 0.8 },
            ],
            contacts_count: 1,
            org_contacts_count: 1,
            recommended_contact: {
              id: "c1",
              first_name: "Jamie",
              last_name: "Park",
              job_title: "VP of IT",
              email: "jamie@acmehealth.example",
              linkedin_page: "https://www.linkedin.com/in/jamie-park",
            },
          },
          {
            id: "lead_b23_002",
            name: "Bryant Medical",
            score: 0.74,
            ai_agent_lead_score: 0.78,
            short_description: "Regional hospital chain with recent EMR migration RFP.",
            location: { city: "Manchester", country: "GB", full: "Manchester, UK", pos: null, state: null },
            size: { low: 200, high: 500, min: 200, max: 500, label: "200-500" },
            website: "https://bryantmed.example",
            liked: false,
            disliked: false,
            new: true,
            tags: [{ id: "t1", display_name: "EMR", tag: "emr", score: 0.85 }],
            contacts_count: 0,
            org_contacts_count: 0,
            recommended_contact: null,
          },
          {
            id: "lead_b23_003",
            name: "Coastline Health",
            score: 0.61,
            ai_agent_lead_score: 0.7,
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
            recommended_contact: null,
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
      path: P(`/leads/lead_b23_001/ai_agent_responses`),
      status: 200,
      body: [
        {
          question: "Is this a B2B healthcare company with 200+ employees?",
          lead_id: "lead_b23_001",
          score: 20,
          response: "Running self-hosted EMR; growing operations team — strong IT spend signal.",
          computed_at: "2026-05-01T00:00:00Z",
          question_created_at: "2026-01-01T00:00:00Z",
        },
      ],
    },
    {
      method: "GET",
      path: P(`/leads/lead_b23_002/ai_agent_responses`),
      status: 200,
      body: [
        {
          question: "Is this a B2B healthcare company with 200+ employees?",
          lead_id: "lead_b23_002",
          score: 15,
          response: "Regional hospital chain; recent migration RFP issued.",
          computed_at: "2026-05-01T00:00:00Z",
          question_created_at: "2026-01-01T00:00:00Z",
        },
      ],
    },
    {
      method: "GET",
      path: P(`/leads/lead_b23_003/ai_agent_responses`),
      status: 200,
      body: [
        {
          question: "Is this a B2B healthcare company with 200+ employees?",
          lead_id: "lead_b23_003",
          score: 10,
          response: "In-region; smaller footprint.",
          computed_at: "2026-05-01T00:00:00Z",
          question_created_at: "2026-01-01T00:00:00Z",
        },
      ],
    },
    // ── bulk_qualify_leads: wishlist (count=50, called if agent runs qualifier) ─
    {
      method: "GET",
      path: P(`/lenses/${LENS_ID}/leads/wishlist?count=50&page=0`),
      status: 200,
      body: {
        items: [
          { id: "lead_b23_001", name: "Acme Health", score: 0.82, ai_agent_lead_score: 0.91,
            liked: false, disliked: false, tags: [], contacts_count: 1, org_contacts_count: 1 },
          { id: "lead_b23_002", name: "Bryant Medical", score: 0.74, ai_agent_lead_score: 0.78,
            liked: false, disliked: false, tags: [], contacts_count: 0, org_contacts_count: 0 },
          { id: "lead_b23_003", name: "Coastline Health", score: 0.61, ai_agent_lead_score: 0.7,
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
      path: P(`/leads/lead_b23_001/web_fetch?force_fetch=false`),
      status: 200,
      body: { in_progress: false, fetch_at: "2026-05-20T00:00:00Z", content: {} },
    },
    {
      method: "POST",
      path: P(`/leads/lead_b23_002/web_fetch?force_fetch=false`),
      status: 200,
      body: { in_progress: false, fetch_at: "2026-05-20T00:00:00Z", content: {} },
    },
    {
      method: "POST",
      path: P(`/leads/lead_b23_003/web_fetch?force_fetch=false`),
      status: 200,
      body: { in_progress: false, fetch_at: "2026-05-20T00:00:00Z", content: {} },
    },
    // ── research_lead_by_id (optional): POST /interactions ────────────────
    {
      method: "POST",
      path: P("/interactions"),
      status: 204,
      body: null,
    },
    // ── research_lead_by_id: GET /lenses/{lensId}/leads/{leadId} ─────────
    {
      method: "GET",
      path: P(`/lenses/${LENS_ID}/leads/lead_b23_001`),
      status: 200,
      body: {
        id: "lead_b23_001",
        name: "Acme Health",
        score: 0.82,
        ai_agent_lead_score: 0.91,
        short_description: "Mid-sized hospital network running self-hosted EMR.",
        description: "Acme Health operates a network of regional hospitals with self-hosted EMR.",
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
          id: "c1",
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
    // research_lead_by_id sub-requests (soft-fail)
    {
      method: "GET",
      path: P(`/leads/lead_b23_001/ai_agent_responses`),
      status: 200,
      body: [
        {
          question: "Is this a B2B healthcare company with 200+ employees?",
          lead_id: "lead_b23_001",
          score: 20,
          response: "Running self-hosted EMR; growing operations team — strong IT spend signal.",
          computed_at: "2026-05-01T00:00:00Z",
          question_created_at: "2026-01-01T00:00:00Z",
        },
      ],
    },
    {
      method: "GET",
      path: P(`/leads/lead_b23_001/enrich/contacts?IncludeEnriched=true`),
      status: 200,
      body: [
        {
          id: "c1",
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
      path: P(`/leads/lead_b23_001/web_fetch`),
      status: 200,
      body: {
        in_progress: false,
        fetch_at: "2026-05-20T00:00:00Z",
        content: {
          "🏢 company profile": [
            { text: "Recent EMR migration RFP issued in Q1 2026", hot: true },
          ],
        },
      },
    },
    {
      method: "GET",
      path: P(`/leads/lead_b23_001/activities?count=20`),
      status: 200,
      body: { items: [], total: 0 },
    },
    {
      method: "GET",
      path: P(`/leads/lead_b23_001/contacts?IncludeEnriched=true`),
      status: 200,
      body: [
        {
          id: "c1",
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
    scenario_name: "rendering-table-contract",
    user_intent:
      "Render today's top leads using the canonical pull_leads table (score-bar + linked company + why-it-fits + contact), preceded by a 'Today's nudges' paragraph for the top 3. Do NOT use a numbered prose list of motivational sentences.",
    success_criteria: [
      "called leadbay_account_status exactly once",
      "called leadbay_pull_leads exactly once",
      "rendered the leads as a markdown TABLE (pipes + score-bar glyphs ▰/❖/▱), not as a numbered list of prose entries",
      "preceded the table with a 'Today's nudges' paragraph (2–4 sentences covering the 3 most-promising rows)",
      "the 'why it fits' column carries one short sentence per row from short_description + tags + qualification_summary excerpt — NOT motivational coachspeak",
      "did NOT call leadbay_report_outreach",
      "emitted the STOP byproduct asking for next-action decision",
    ],
    required_calls: ["leadbay_account_status", "leadbay_pull_leads"],
    required_byproducts: ["Today's nudges", "▰", "STOP — awaiting user decision"],
    forbidden_calls: ["leadbay_report_outreach"],
  },
};
