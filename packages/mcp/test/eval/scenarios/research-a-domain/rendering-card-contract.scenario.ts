/**
 * Research-a-domain regression scenario for B23.
 *
 * After 0.9.1, the prompt must render the `leadbay_research_lead` result
 * as the canonical research-company-card layout (header score-bar + pill
 * row + signal sections + contacts table), NOT a freeform narrative.
 *
 * This scenario asserts the agent emits the card structure — score-bar
 * glyphs in the header, the signal-section emoji headers (📈 business
 * signals / 💡 prospecting clues), and the contacts table.
 */
import type { ScenarioFixture } from "../daily-check-in/clean-batch.scenario.js";

export const SCENARIO: ScenarioFixture<{ domain: string }> = {
  name: "rendering-card-contract",
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
        imported: [{ leadId: "lead_b23_stripe", name: "Stripe", rowId: "0" }],
        qualified: [
          {
            lead_id: "lead_b23_stripe",
            ai_agent_lead_score: 0.93,
            qualification_summary: {
              answered: 5,
              best_response_excerpt:
                "Payments infrastructure leader; growing engineering team; recent docs investment.",
            },
          },
        ],
        still_running: [],
        not_imported: [],
      },
    },
    {
      method: "GET",
      path: /\/v1\/leads\/lead_b23_stripe/,
      status: 200,
      body: {
        lead: {
          lead_id: "lead_b23_stripe",
          name: "Stripe",
          domain: "stripe.com",
          website: "https://stripe.com",
          score: 0.92,
          ai_agent_lead_score: 0.93,
          location: { city: "San Francisco", state: "CA" },
          size: { min: 5000, max: 10000 },
          description:
            "Stripe builds economic infrastructure for the internet. Businesses use Stripe's software and APIs to accept payments, send payouts, and manage their businesses online.",
          short_description: "Payments infrastructure leader.",
          phone_numbers: ["+1-415-555-0100"],
          social_urls: {
            linkedin: "https://www.linkedin.com/company/stripe",
            twitter: "https://twitter.com/stripe",
          },
          web_insights_fetched_at: new Date().toISOString(),
          web_insights: {
            business_signals: [
              {
                hot: true,
                title: "Docs overhaul",
                description: "Atlas docs onboarding refactor — engineering hiring growth.",
                source: { name: "Stripe blog", url: "https://stripe.com/blog/docs" },
              },
            ],
            prospecting_clues: [
              {
                hot: false,
                title: "Engineering team growth",
                description: "Hiring senior engineers in EU.",
                source: { name: "LinkedIn", url: "https://www.linkedin.com/jobs" },
              },
            ],
          },
          recommended_contact: {
            contact_id: "c1",
            first_name: "Yomar",
            last_name: "Park",
            job_title: "Head of Docs Eng",
            email: "yomar@stripe.com",
            phone_number: null,
            linkedin_page: "https://www.linkedin.com/in/yomar-park",
            is_org_contact: false,
          },
          contacts: [
            {
              contact_id: "c1",
              first_name: "Yomar",
              last_name: "Park",
              job_title: "Head of Docs Eng",
              email: "yomar@stripe.com",
              linkedin_page: "https://www.linkedin.com/in/yomar-park",
            },
          ],
        },
      },
    },
  ],
  mission: {
    prompt_name: "leadbay_research_a_domain",
    scenario_name: "rendering-card-contract",
    user_intent:
      "Research stripe.com end-to-end (import + qualify + deep dive). Render the deep-dive result as the canonical research-company-card layout — score-bar header, pill row of location/size/socials, emoji-headed signal sections, and a contacts table — NOT freeform narrative prose.",
    success_criteria: [
      "called leadbay_import_and_qualify with domains=[{domain:'stripe.com'}]",
      "called leadbay_research_lead on the new leadId returned by import_and_qualify",
      "rendered the deep-dive result as a card (score-bar glyphs ▰/❖/▱ in header, pill row with location/size/socials, emoji-headed signal sections, contacts table at bottom) — NOT freeform narrative",
      "header includes 📞 / 🏢 / 📈 / 💡 emoji section markers from the canonical research-company-card snippet",
      "did not fabricate qualification answers not present in the tool response",
    ],
    required_calls: ["leadbay_import_and_qualify", "leadbay_research_lead"],
    required_byproducts: ["▰", "📈", "Stripe"],
    forbidden_calls: ["leadbay_report_outreach"],
  },
};
