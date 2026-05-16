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
 */
import type { ScenarioFixture } from "./clean-batch.scenario.js";

export const SCENARIO: ScenarioFixture<Record<string, never>> = {
  name: "rendering-table-contract",
  prompt: "leadbay_daily_check_in",
  tier: "gate",
  args: {},
  backendFixtures: [
    {
      method: "GET",
      path: "/v1/quota",
      status: 200,
      body: {
        quota: {
          ai_rescore_remaining: 250,
          web_fetch_remaining: 500,
          monitored_remaining: 30,
        },
        active_lens: { id: "lens_b23", name: "EU Hospitals" },
        computing_intelligence: false,
      },
    },
    {
      method: "POST",
      path: "/v1/leads/discover",
      status: 200,
      body: {
        lens: { id: "lens_b23", name: "EU Hospitals" },
        leads: [
          {
            lead_id: "lead_b23_001",
            name: "Acme Health",
            website: "acmehealth.example",
            score: 0.82,
            ai_agent_lead_score: 0.91,
            location: { city: "London", state: "UK" },
            size: { min: 500, max: 1000 },
            short_description: "Mid-sized hospital network running self-hosted EMR.",
            tags: [
              { id: "t1", display_name: "EMR", tag: "emr", score: 0.9 },
              { id: "t2", display_name: "Self-hosted", tag: "selfhost", score: 0.8 },
            ],
            qualification_summary: {
              answered: 5,
              best_response_excerpt: "Running self-hosted EMR; growing operations team — strong IT spend signal.",
            },
            recommended_contact: {
              contact_id: "c1",
              first_name: "Jamie",
              last_name: "Park",
              job_title: "VP of IT",
              linkedin_page: "https://www.linkedin.com/in/jamie-park",
              email: "jamie@acmehealth.example",
            },
          },
          {
            lead_id: "lead_b23_002",
            name: "Bryant Medical",
            website: "bryantmed.example",
            score: 0.74,
            ai_agent_lead_score: 0.78,
            location: { city: "Manchester", state: "UK" },
            size: { min: 200, max: 500 },
            short_description: "Regional hospital chain with recent EMR migration RFP.",
            tags: [{ id: "t1", display_name: "EMR", tag: "emr", score: 0.85 }],
            qualification_summary: {
              answered: 4,
              best_response_excerpt: "Regional hospital chain; recent migration RFP issued.",
            },
            recommended_contact: null,
          },
          {
            lead_id: "lead_b23_003",
            name: "Coastline Health",
            website: "coastlinehealth.example",
            score: 0.61,
            ai_agent_lead_score: 0.7,
            location: { city: "Bristol", state: "UK" },
            size: { min: 100, max: 300 },
            short_description: "Smaller hospital, fewer signals but in-region.",
            tags: [],
            qualification_summary: { answered: 3, best_response_excerpt: "In-region; smaller footprint." },
            recommended_contact: null,
          },
        ],
      },
    },
    {
      method: "GET",
      path: /\/v1\/leads\/lead_b23_001/,
      status: 200,
      body: {
        lead: {
          lead_id: "lead_b23_001",
          name: "Acme Health",
          domain: "acmehealth.example",
          contacts: [
            { id: "c1", first_name: "Jamie", last_name: "Park", title: "VP of IT", email: "jamie@acmehealth.example" },
          ],
          signals: ["recent EMR migration RFP", "internal IT team expansion"],
        },
      },
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
