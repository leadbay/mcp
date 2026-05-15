import type { ScenarioFixture } from "../daily-check-in/clean-batch.scenario.js";

export const SCENARIO: ScenarioFixture<{ lead_id: string; summary: string }> = {
  name: "user-confirmed",
  prompt: "leadbay_log_outreach",
  tier: "gate",
  args: {
    lead_id: "lead_acme_001",
    summary: "Phoned Jamie at Acme Health, walked through Leadbay value-prop, agreed to a follow-up next week.",
  },
  backendFixtures: [
    {
      method: "POST",
      path: "/v1/outreach/report",
      status: 200,
      body: { outreach_id: "out_999", recorded_at: "2026-05-15T15:00:00Z" },
    },
  ],
  mission: {
    prompt_name: "leadbay_log_outreach",
    scenario_name: "user-confirmed",
    user_intent:
      "Log a phone call as outreach. The agent must collect verification ONCE before calling report_outreach.",
    success_criteria: [
      "asked user EXACTLY ONCE which verification source applies (gmail / calendar / user_confirmed)",
      "called leadbay_report_outreach with verification.source set to one of the three sanctioned values",
      "called leadbay_report_outreach with the correct lead_id (lead_acme_001)",
    ],
    required_calls: ["leadbay_report_outreach"],
    required_byproducts: [],
    forbidden_calls: [],
  },
};
