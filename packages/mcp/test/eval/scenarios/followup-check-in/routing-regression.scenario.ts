/**
 * Follow-up routing regression — the user asks for "leads I should
 * follow up with today", and the agent must call leadbay_pull_followups
 * (Monitor view) — NOT leadbay_pull_leads (Discover) iterated by
 * engagement counters.
 *
 * History (2026-05-17): a real session of `leadbay_daily_check_in`
 * (which had a "what should I work on" trigger phrase that overlaps
 * with follow-up intent) freelanced into pull_leads page iteration,
 * filtered by prospecting_actions_count, and rendered prose. The
 * Monitor view was never queried — so cold leads awaiting follow-up
 * were silently invisible.
 *
 * Fix shape: a parallel `leadbay_followup_check_in` orchestrator
 * prompt, narrower triggers on `leadbay_daily_check_in`, an
 * anti-confusion guardrail in `pull_followups`'s tool description,
 * and the explicit routing-pair section in the prospecting overview.
 */
import type { ScenarioFixture } from "../daily-check-in/clean-batch.scenario.js";

export const SCENARIO: ScenarioFixture<Record<string, never>> = {
  name: "routing-regression",
  prompt: "leadbay_followup_check_in",
  tier: "gate",
  args: {},
  backendFixtures: [
    {
      method: "GET",
      path: /\/1\.5\/monitor/,
      status: 200,
      body: {
        leads: [
          {
            lead_id: "f1",
            name: "Acme Health",
            website: "acmehealth.example",
            score: 0.82,
            location: { city: "London", state: "UK" },
            size: { min: 500, max: 1000 },
            split_ai_summary: {
              worth_pursuing: "Yes — promising fit, ready to re-engage",
              approach_angle: "Recent EMR RFP — a timely opening",
              next_step: "Reply to their RFP outreach with a quick demo offer",
            },
            last_monitor_action_at: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
            last_prospecting_action: "LEAD_EMAIL_SENT",
            last_prospecting_action_at: new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString(),
            epilogue_status: "EPILOGUE_STILL_CHASING",
            recommended_contact: {
              contact_id: "c1",
              first_name: "Jamie",
              last_name: "Park",
              job_title: "VP of IT",
              email: "jamie@acmehealth.example",
              phone_number: null,
              linkedin_page: "https://www.linkedin.com/in/jamie-park",
            },
          },
          {
            lead_id: "f2",
            name: "Bryant Medical",
            website: "bryantmed.example",
            score: 0.74,
            location: { city: "Manchester", state: "UK" },
            size: { min: 200, max: 500 },
            split_ai_summary: {
              worth_pursuing: "Maybe — went cold but the trigger still applies",
              approach_angle: "Quick check-in on the migration project",
              next_step: "LinkedIn DM with a 1-line update",
            },
            last_monitor_action_at: new Date(Date.now() - 35 * 24 * 3600 * 1000).toISOString(),
            last_prospecting_action: null,
            last_prospecting_action_at: null,
            epilogue_status: null,
            recommended_contact: null,
          },
          {
            lead_id: "f3",
            name: "Coastline Health",
            website: "coastlinehealth.example",
            score: 0.61,
            location: { city: "Bristol", state: "UK" },
            size: { min: 100, max: 300 },
            split_ai_summary: {
              worth_pursuing: "No — explicit no last quarter",
              approach_angle: "Skip for now",
              next_step: "Snooze 6 months",
            },
            last_monitor_action_at: new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString(),
            last_prospecting_action: "LEAD_CALL_MADE",
            last_prospecting_action_at: new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString(),
            epilogue_status: "EPILOGUE_NOT_INTERESTED_LOST",
            recommended_contact: null,
          },
        ],
        active_filters: { criteria: [] },
        total_excluded_by_pushback: 0,
        has_more: false,
      },
    },
  ],
  mission: {
    prompt_name: "leadbay_followup_check_in",
    scenario_name: "routing-regression",
    user_intent:
      "Surface KNOWN leads I should follow up with today via leadbay_pull_followups (NOT leadbay_pull_leads). Render the canonical pull_followups table with status badges, AI take, history & notes, contacts — preceded by a 'Where to start today' line.",
    success_criteria: [
      "called leadbay_pull_followups at least once",
      "did NOT call leadbay_pull_leads — Discover is the wrong entry point for follow-up queries",
      "did NOT iterate pages of pull_leads filtering by engagement counters",
      "rendered the canonical pull_followups table (status emoji like 🎯/⚡/🟢/💤/✨/🔥/❄ + AI take + history & notes + contacts) — NOT freeform prose per row",
      "preceded the table with a 'Where to start today' 1–3 sentence paragraph naming the single highest-urgency row",
      "emitted the STOP byproduct asking for next-action decision",
    ],
    required_calls: ["leadbay_pull_followups"],
    required_byproducts: ["Where to start today", "STOP — awaiting user decision"],
    forbidden_calls: ["leadbay_pull_leads", "leadbay_report_outreach"],
  },
};
