/**
 * Research-a-domain regression scenario for B23.
 *
 * After 0.9.1, the prompt must render the `leadbay_research_lead_by_id` result
 * as the canonical research-company-card layout (header score-bar + pill
 * row + signal sections + contacts table), NOT a freeform narrative.
 *
 * This scenario asserts the agent emits the card structure — score-bar
 * glyphs in the header, the signal-section emoji headers (📈 business
 * signals / 💡 prospecting clues), and the contacts table.
 *
 * Fixture paths match the actual LeadbayClient API calls:
 *   - import_and_qualify: POST /imports?file_name=... + GET /imports/{id}
 *                         + GET /imports/{id}/leads + GET /crm/custom_fields
 *   - research_lead_by_id: POST /interactions + GET /lenses/{lensId}/leads/{leadId}
 *                          + sub-requests (soft-fail)
 */
import type { ScenarioFixture } from "../daily-check-in/clean-batch.scenario.js";

const ORG_ID = "org_rcc_001";
const LENS_ID = 1; // matches last_requested_lens in /users/me fixture
const P = (path: string) => `/1.5${path}`;

export const SCENARIO: ScenarioFixture<{ domain: string }> = {
  name: "rendering-card-contract",
  prompt: "leadbay_research_a_domain",
  tier: "gate",
  args: { domain: "stripe.com" },
  backendFixtures: [
    // ── resolveDefaultLens: GET /users/me (called by import_and_qualify + research_lead_by_id) ─
    {
      method: "GET",
      path: P("/users/me"),
      status: 200,
      body: {
        id: "user_rcc_001",
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
    // second copy — consumed by research_lead_by_id's resolveDefaultLens call
    {
      method: "GET",
      path: P("/users/me"),
      status: 200,
      body: {
        id: "user_rcc_001",
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
    // ── import_and_qualify: POST /imports?file_name=... (multipart upload) ─
    {
      method: "POST",
      path: /\/1\.5\/imports(\?.*)?$/,
      status: 200,
      body: {
        id: "imp_002",
        status: "preprocessing",
        lead_ids: [],
      },
    },
    // ── import_and_qualify: GET /imports/{importId} (polling) ─────────────
    {
      method: "GET",
      path: P(`/imports/imp_002`),
      status: 200,
      body: {
        id: "imp_002",
        status: "done",
        lead_ids: ["lead_b23_stripe"],
      },
    },
    // ── import_and_qualify: GET /imports/{importId}/leads ─────────────────
    {
      method: "GET",
      path: P(`/imports/imp_002/leads`),
      status: 200,
      body: {
        lead_ids: ["lead_b23_stripe"],
      },
    },
    // ── import_and_qualify: GET /crm/custom_fields ────────────────────────
    {
      method: "GET",
      path: P(`/crm/custom_fields`),
      status: 200,
      body: [],
    },
    // ── bulk_qualify / web_fetch fan-out: POST /leads/{id}/web_fetch ──────
    {
      method: "POST",
      path: P(`/leads/lead_b23_stripe/web_fetch?force_fetch=false`),
      status: 200,
      body: { in_progress: false, fetch_at: "2026-05-20T00:00:00Z", content: {} },
    },
    // ── qualify polling: GET /leads/{id}/ai_agent_responses ───────────────
    {
      method: "GET",
      path: P(`/leads/lead_b23_stripe/ai_agent_responses`),
      status: 200,
      body: [
        {
          question: "Is this a high-growth engineering organization?",
          lead_id: "lead_b23_stripe",
          score: 20,
          response:
            "Payments infrastructure leader; growing engineering team; recent docs investment.",
          computed_at: "2026-05-01T00:00:00Z",
          question_created_at: "2026-01-01T00:00:00Z",
        },
      ],
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
      path: P(`/lenses/${LENS_ID}/leads/lead_b23_stripe`),
      status: 200,
      body: {
        id: "lead_b23_stripe",
        name: "Stripe",
        score: 0.92,
        ai_agent_lead_score: 0.93,
        short_description: "Payments infrastructure leader.",
        description:
          "Stripe builds economic infrastructure for the internet. Businesses use Stripe's software and APIs to accept payments, send payouts, and manage their businesses online.",
        location: { city: "San Francisco", country: "US", full: "San Francisco, CA", pos: null, state: "CA" },
        size: { low: 5000, high: 10000, min: 5000, max: 10000, label: "5000-10000" },
        website: "https://stripe.com",
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
          first_name: "Yomar",
          last_name: "Park",
          job_title: "Head of Docs Eng",
          email: "yomar@stripe.com",
          phone_number: null,
          linkedin_page: "https://www.linkedin.com/in/yomar-park",
          is_org_contact: false,
        },
        social_presence: {
          crunchbase: true, facebook: false, instagram: false,
          linkedin: true, tiktok: false, twitter: true,
        },
      },
    },
    // ── research_lead_by_id: sub-requests (soft-fail) ─────────────────────
    {
      method: "GET",
      path: P(`/leads/lead_b23_stripe/ai_agent_responses`),
      status: 200,
      body: [
        {
          question: "Is this a high-growth engineering organization?",
          lead_id: "lead_b23_stripe",
          score: 20,
          response:
            "Payments infrastructure leader; growing engineering team; recent docs investment.",
          computed_at: "2026-05-01T00:00:00Z",
          question_created_at: "2026-01-01T00:00:00Z",
        },
      ],
    },
    {
      method: "GET",
      path: P(`/leads/lead_b23_stripe/enrich/contacts?IncludeEnriched=true`),
      status: 200,
      body: [
        {
          id: "c1",
          first_name: "Yomar",
          last_name: "Park",
          job_title: "Head of Docs Eng",
          email: "yomar@stripe.com",
          phone_number: null,
          linkedin_page: "https://www.linkedin.com/in/yomar-park",
          recommended: true,
          enrichment: { done: true },
        },
      ],
    },
    {
      method: "GET",
      path: P(`/leads/lead_b23_stripe/web_fetch`),
      status: 200,
      body: {
        in_progress: false,
        fetch_at: "2026-05-20T00:00:00Z",
        content: {
          "📈 business signals": [
            {
              hot: true,
              title: "Docs overhaul",
              description: "Atlas docs onboarding refactor — engineering hiring growth.",
              source: { name: "Stripe blog", url: "https://stripe.com/blog/docs" },
            },
          ],
          "💡 prospecting clues": [
            {
              hot: false,
              title: "Engineering team growth",
              description: "Hiring senior engineers in EU.",
              source: { name: "LinkedIn", url: "https://www.linkedin.com/jobs" },
            },
          ],
        },
      },
    },
    {
      method: "GET",
      path: P(`/leads/lead_b23_stripe/activities?count=20`),
      status: 200,
      body: { items: [], total: 0 },
    },
    {
      method: "GET",
      path: P(`/leads/lead_b23_stripe/contacts?IncludeEnriched=true`),
      status: 200,
      body: [
        {
          id: "c1",
          first_name: "Yomar",
          last_name: "Park",
          job_title: "Head of Docs Eng",
          email: "yomar@stripe.com",
          phone_number: null,
          linkedin_page: "https://www.linkedin.com/in/yomar-park",
          recommended: true,
        },
      ],
    },
  ],
  mission: {
    prompt_name: "leadbay_research_a_domain",
    scenario_name: "rendering-card-contract",
    user_intent:
      "Research stripe.com end-to-end (import + qualify + deep dive). Render the deep-dive result as the canonical research-company-card layout — score-bar header, pill row of location/size/socials, emoji-headed signal sections, and a contacts table — NOT freeform narrative prose.",
    success_criteria: [
      "called leadbay_import_and_qualify with domains=[{domain:'stripe.com'}]",
      "called leadbay_research_lead_by_id on the new leadId returned by import_and_qualify",
      "rendered the deep-dive result as a card (score-bar glyphs ▰/❖/▱ in header, pill row with location/size/socials, emoji-headed signal sections, contacts table at bottom) — NOT freeform narrative",
      "header includes 📞 / 🏢 / 📈 / 💡 emoji section markers from the canonical research-company-card snippet",
      "did not fabricate qualification answers not present in the tool response",
    ],
    required_calls: ["leadbay_import_and_qualify", "leadbay_research_lead_by_id"],
    required_byproducts: ["▰", "📈", "Stripe"],
    forbidden_calls: ["leadbay_report_outreach"],
  },
};
