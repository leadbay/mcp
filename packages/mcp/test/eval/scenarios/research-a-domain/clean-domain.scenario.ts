import type { ScenarioFixture } from "../daily-check-in/clean-batch.scenario.js";

export const SCENARIO: ScenarioFixture<{ domain: string }> = {
  name: "clean-domain",
  prompt: "leadbay_research_a_domain",
  tier: "gate",
  args: { domain: "stripe.com" },
  backendFixtures: [
    {
      method: "POST",
      path: "/v1/leads/import_and_qualify",
      status: 200,
      body: {
        kind: "result",
        imported: [{ leadId: "lead_stripe", name: "Stripe", rowId: "0" }],
        qualified: [
          {
            lead_id: "lead_stripe",
            ai_agent_lead_score: 0.93,
            qualification_summary:
              "Payments infrastructure leader; growing engineering team; recent docs investment.",
          },
        ],
        still_running: [],
        not_imported: [],
      },
    },
    {
      method: "GET",
      path: /\/v1\/leads\/lead_stripe/,
      status: 200,
      body: {
        lead: {
          lead_id: "lead_stripe",
          name: "Stripe",
          domain: "stripe.com",
          signals: ["Atlas docs onboarding refactor", "engineering hiring growth"],
          contacts: [
            { id: "c1", first_name: "Yomar", last_name: "Park", title: "Head of Docs Eng", email: "yomar@stripe.com" },
          ],
        },
      },
    },
  ],
  mission: {
    prompt_name: "leadbay_research_a_domain",
    scenario_name: "clean-domain",
    user_intent: "Research stripe.com end-to-end: import + qualify + deep dive.",
    success_criteria: [
      "called leadbay_import_and_qualify with domains=[{domain:'stripe.com'}]",
      "called leadbay_research_lead on the new leadId returned by import_and_qualify",
      "summarized: company description, fit (qualification_answers), signals, recommended first-contact",
      "did not fabricate qualification answers not present in the tool response",
    ],
    required_calls: ["leadbay_import_and_qualify", "leadbay_research_lead"],
    required_byproducts: [],
    forbidden_calls: ["leadbay_report_outreach"],
  },
};
