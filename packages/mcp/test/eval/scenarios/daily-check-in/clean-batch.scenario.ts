/**
 * Daily check-in scenario: a clean fresh-batch morning.
 *
 * The user has quota, the active lens has a fresh batch with 3 qualified
 * leads, the top one has a clear signal. Expected agent behavior:
 *   1. Call leadbay_account_status
 *   2. Call leadbay_pull_leads
 *   3. Call leadbay_research_lead on the top lead
 *   4. Emit "STOP — awaiting user decision" byproduct
 *   5. NOT call leadbay_report_outreach
 *
 * Backend fixtures are inline (small response payloads). For larger
 * scenarios use the recording manifest pattern.
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

export const SCENARIO: ScenarioFixture<Record<string, never>> = {
  name: "clean-batch",
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
        active_lens: { id: "lens_abc", name: "EU Hospitals" },
        computing_intelligence: false,
      },
    },
    {
      method: "POST",
      path: "/v1/leads/discover",
      status: 200,
      body: {
        leads: [
          {
            lead_id: "lead_001",
            name: "Acme Health",
            score: 0.82,
            ai_agent_lead_score: 0.91,
            qualification_summary:
              "Mid-sized hospital network running self-hosted EMR; growing operations team — strong IT spend signal.",
          },
          {
            lead_id: "lead_002",
            name: "Bryant Medical",
            score: 0.74,
            ai_agent_lead_score: 0.78,
            qualification_summary:
              "Regional hospital chain; recent migration RFP issued.",
          },
          {
            lead_id: "lead_003",
            name: "Coastline Health",
            score: 0.61,
            qualification_summary: "Smaller hospital, fewer signals but in-region.",
          },
        ],
      },
    },
    {
      method: "GET",
      path: /\/v1\/leads\/lead_001/,
      status: 200,
      body: {
        lead: {
          lead_id: "lead_001",
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
    scenario_name: "clean-batch",
    user_intent:
      "Show me my morning check-in: account state, fresh batch, the most-promising lead, then stop and wait.",
    success_criteria: [
      "called leadbay_account_status exactly once",
      "called leadbay_pull_leads exactly once",
      "called leadbay_research_lead exactly once on the top-scoring lead (lead_001 / Acme Health)",
      "emitted the STOP byproduct asking for next-action decision",
      "did NOT call leadbay_report_outreach",
    ],
    required_calls: ["leadbay_account_status", "leadbay_pull_leads", "leadbay_research_lead"],
    required_byproducts: ["STOP — awaiting user decision"],
    forbidden_calls: ["leadbay_report_outreach"],
  },
};
