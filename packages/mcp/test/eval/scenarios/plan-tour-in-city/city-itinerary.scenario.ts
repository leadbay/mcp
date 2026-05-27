/**
 * Field sales tour scenario: user visits Limoges and wants a mixed itinerary.
 *
 * Expected agent behavior (WORKFLOWS.md #10):
 *   1. Call leadbay_tour_plan with city: "Limoges" (which calls pull_followups
 *      + pull_leads internally)
 *   2. Produce a map/itinerary with Monitor leads + fresh Discover leads
 *   3. NOT call standalone leadbay_pull_leads or leadbay_pull_followups
 *   4. NOT call leadbay_report_outreach
 *
 * Fixture paths:
 *   - tour_plan internals:
 *       GET /geo/search?q=Limoges        (city resolver)
 *       GET /monitor?filtered=true&...   (Monitor followups for the city)
 *       GET /lenses/{id}/leads/wishlist  (Discover leads, over-pulled then geo-filtered)
 */
import type { ScenarioFixture } from "../daily-check-in/clean-batch.scenario.js";

const LENS_ID = 44;
const P = (path: string) => `/1.5${path}`;

export const SCENARIO: ScenarioFixture<{ city: string; date?: string }> = {
  name: "city-itinerary",
  prompt: "leadbay_plan_tour_in_city",
  tier: "periodic",
  args: { city: "Limoges", date: "June 10" },
  backendFixtures: [
    {
      method: "GET",
      path: P("/users/me"),
      status: 200,
      body: {
        id: "user_tour_001",
        email: "demo@leadbay.ai",
        name: "Demo User",
        admin: false,
        manager: false,
        organization: { id: "org_tour_001", name: "Tour Demo Org", ai_agent_enabled: true, computing_intelligence: false },
        last_requested_lens: LENS_ID,
      },
    },
    {
      method: "GET",
      path: P(`/organizations/org_tour_001/quota_status`),
      status: 200,
      body: { ai_rescore_remaining: 150, web_fetch_remaining: 400, monitored_remaining: 25 },
    },
    {
      method: "GET",
      path: /\/1\.5\/geo\/search\?q=Limoges/,
      status: 200,
      body: {
        results: [
          { id: "87000", label: "Limoges, Haute-Vienne, France", lat: 45.83, lon: 1.26 },
        ],
      },
    },
    {
      method: "GET",
      path: /\/1\.5\/monitor/,
      status: 200,
      body: {
        items: [
          {
            lead_id: "tour_m1",
            name: "CHU Limoges",
            website: "chu-limoges.example",
            score: 0.82,
            location: { city: "Limoges", state: "FR", country: "FR", full: "Limoges, France" },
            size: { min: 1000, max: 5000 },
            split_ai_summary: {
              worth_pursuing: "Yes — existing Monitor account, recent IT tender",
              approach_angle: "Follow up on the Q1 RFP we submitted",
              next_step: "In-person visit to discuss integration timeline",
            },
            last_monitor_action_at: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
            last_prospecting_action: "LEAD_EMAIL_SENT",
            last_prospecting_action_at: new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString(),
            epilogue_status: "EPILOGUE_STILL_CHASING",
            recommended_contact: {
              contact_id: "tour_m1c1",
              first_name: "Sophie",
              last_name: "Martin",
              job_title: "DSI",
              email: "sophie@chu-limoges.example",
              phone_number: null,
              linkedin_page: "https://www.linkedin.com/in/sophie-martin",
            },
          },
          {
            lead_id: "tour_m2",
            name: "Clinique du Cheverny",
            website: "cheverny-clinic.example",
            score: 0.68,
            location: { city: "Limoges", state: "FR", country: "FR", full: "Limoges, France" },
            size: { min: 200, max: 500 },
            split_ai_summary: {
              worth_pursuing: "Yes — small private clinic, budget cycle starts Q3",
              approach_angle: "Introduce our lightweight EMR module",
              next_step: "Demo request follow-up",
            },
            last_monitor_action_at: new Date(Date.now() - 21 * 24 * 3600 * 1000).toISOString(),
            last_prospecting_action: "LEAD_VISITED",
            last_prospecting_action_at: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
            epilogue_status: "EPILOGUE_STILL_CHASING",
            recommended_contact: {
              contact_id: "tour_m2c1",
              first_name: "Pierre",
              last_name: "Dupont",
              job_title: "Directeur médical",
              email: "pierre@cheverny-clinic.example",
              phone_number: null,
              linkedin_page: null,
            },
          },
        ],
        pagination: { page: 0, count: 20, total: 2, has_more: false },
      },
    },
    {
      method: "GET",
      path: P(`/lenses/${LENS_ID}/leads/wishlist?count=30&page=0&contacts=true`),
      status: 200,
      body: {
        items: [
          {
            id: "tour_d1",
            name: "MedTech Limoges",
            score: 0.79,
            ai_agent_lead_score: 0.84,
            short_description: "Local medical device startup — EMR integration interest confirmed.",
            location: { city: "Limoges", country: "FR", full: "Limoges, France", pos: null, state: null },
            size: { low: 50, high: 200, min: 50, max: 200, label: "50-200" },
            website: "https://medtech-limoges.example",
            liked: false,
            disliked: false,
            new: true,
            tags: [],
            contacts_count: 1,
            org_contacts_count: 1,
          },
          {
            id: "tour_d2",
            name: "Pharma Paris",
            score: 0.71,
            ai_agent_lead_score: 0.75,
            short_description: "Large pharma — HQ in Paris, not in Limoges.",
            location: { city: "Paris", country: "FR", full: "Paris, France", pos: null, state: null },
            size: { low: 1000, high: 5000, min: 1000, max: 5000, label: "1000+" },
            website: "https://pharma-paris.example",
            liked: false,
            disliked: false,
            new: true,
            tags: [],
            contacts_count: 2,
            org_contacts_count: 2,
          },
        ],
        pagination: { page: 0, count: 30, total: 2, has_more: false },
        computing_wishlist: false,
        computing_scores: false,
      },
    },
    {
      method: "GET",
      path: P(`/leads/tour_d1/ai_agent_responses`),
      status: 200,
      body: [],
    },
    {
      method: "GET",
      path: P(`/leads/tour_d2/ai_agent_responses`),
      status: 200,
      body: [],
    },
  ],
  mission: {
    prompt_name: "leadbay_plan_tour_in_city",
    scenario_name: "city-itinerary",
    user_intent:
      "I'm visiting Limoges on June 10 — build me a tour itinerary with existing Monitor contacts + fresh Discover leads on a map.",
    success_criteria: [
      "called leadbay_tour_plan with city Limoges (not raw pull_followups or pull_leads separately)",
      "included Monitor follow-up leads (CHU Limoges, Clinique du Cheverny) in the itinerary",
      "included geo-matched Discover leads (MedTech Limoges) and excluded non-matching ones (Pharma Paris)",
      "presented the itinerary as a map or place-card list with addresses and contacts",
      "did NOT call leadbay_report_outreach",
    ],
    required_calls: ["leadbay_tour_plan"],
    required_byproducts: [],
    forbidden_calls: ["leadbay_report_outreach", "leadbay_pull_leads"],
  },
};
