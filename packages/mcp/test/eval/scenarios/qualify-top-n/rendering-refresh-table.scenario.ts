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
 */
import type { ScenarioFixture } from "../daily-check-in/clean-batch.scenario.js";

export const SCENARIO: ScenarioFixture<{ count: string }> = {
  name: "rendering-refresh-table",
  prompt: "leadbay_qualify_top_n",
  tier: "gate",
  args: { count: "10" },
  backendFixtures: [
    {
      method: "POST",
      path: "/v1/qualify/bulk",
      status: 200,
      body: {
        qualified: [
          {
            lead_id: "ql1",
            name: "Apex Health",
            ai_agent_lead_score: 0.91,
            qualification_summary: { answered: 5, best_response_excerpt: "Strong fit." },
          },
          {
            lead_id: "ql2",
            name: "Bayside Clinic",
            ai_agent_lead_score: 0.84,
            qualification_summary: { answered: 5, best_response_excerpt: "Good fit." },
          },
          {
            lead_id: "ql3",
            name: "Cedar Medical",
            ai_agent_lead_score: 0.79,
            qualification_summary: { answered: 4, best_response_excerpt: "Moderate." },
          },
        ],
        still_running: [],
      },
    },
    {
      method: "POST",
      path: "/v1/leads/discover",
      status: 200,
      body: {
        lens: { id: "lens_b23_qn", name: "EU Hospitals" },
        leads: [
          {
            lead_id: "ql1",
            name: "Apex Health",
            website: "apexhealth.example",
            score: 0.82,
            ai_agent_lead_score: 0.91,
            location: { city: "London", state: "UK" },
            size: { min: 500, max: 1000 },
            short_description: "Strong IT spend; recent EMR investment.",
            tags: [{ id: "t1", display_name: "EMR", tag: "emr", score: 0.9 }],
            qualification_summary: { answered: 5, best_response_excerpt: "Strong fit." },
            recommended_contact: {
              contact_id: "c1",
              first_name: "Sasha",
              last_name: "Knight",
              job_title: "CTO",
              linkedin_page: "https://www.linkedin.com/in/sasha-knight",
              email: null,
            },
          },
          {
            lead_id: "ql2",
            name: "Bayside Clinic",
            website: "bayside.example",
            score: 0.76,
            ai_agent_lead_score: 0.84,
            location: { city: "Bristol", state: "UK" },
            size: { min: 100, max: 300 },
            short_description: "Mid-market clinic chain; growing footprint.",
            tags: [],
            qualification_summary: { answered: 5, best_response_excerpt: "Good fit." },
            recommended_contact: null,
          },
          {
            lead_id: "ql3",
            name: "Cedar Medical",
            website: "cedarmed.example",
            score: 0.7,
            ai_agent_lead_score: 0.79,
            location: { city: "Manchester", state: "UK" },
            size: { min: 200, max: 400 },
            short_description: "Regional hospital chain.",
            tags: [],
            qualification_summary: { answered: 4, best_response_excerpt: "Moderate." },
            recommended_contact: null,
          },
        ],
      },
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
      "did NOT call leadbay_research_lead — wait for user go",
    ],
    required_calls: ["leadbay_bulk_qualify_leads", "leadbay_pull_leads"],
    required_byproducts: ["Standouts from this batch", "▰"],
    forbidden_calls: ["leadbay_research_lead", "leadbay_report_outreach"],
  },
};
