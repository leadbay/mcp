/**
 * Tool-routing classifier fixtures for the MCP-first delivery tools.
 *
 * Same (intent, expected-tool, forbidden-tools) shape as `ROUTING_FIXTURES`,
 * kept in its own module so the established fixture file stays untouched.
 *
 * These three tools are the ones most at risk of misrouting, because a
 * plausible-looking older tool exists for every one of them:
 *
 *   leadbay_find_new_leads   vs leadbay_pull_leads (today's batch from an
 *                               existing lens — NOT a net-new search)
 *   leadbay_qualify_leads    vs leadbay_bulk_qualify_leads / import_leads
 *                               (the in-account batch path, not a supplied list)
 *   leadbay_lead_job_status  vs the three other *_status pollers
 *
 * The `forbidden_tools` entries are therefore the load-bearing half: routing
 * to the neighbour is the failure mode, and on the delivery tools it is a
 * PAID one.
 *
 * Note the deliberate split of duties: the live classifier eval (Sonnet with
 * the tool catalog bound) is what measures whether the intents actually
 * route, and it needs an API key. `lead-delivery-routing-fixtures.test.ts`
 * covers what a deterministic run can prove — that every tool named here is
 * real and that no fixture forbids the tool it expects — so a rename or typo
 * cannot rot these silently while no eval is running.
 */

import type { RoutingFixture } from "./routing-fixtures.js";

export const LEAD_DELIVERY_ROUTING_FIXTURES: RoutingFixture[] = [
  {
    intent:
      "Find me 10 gyms around Dallas that would buy our flooring, with someone I can call.",
    expected_tool: "leadbay_find_new_leads",
    forbidden_tools: ["leadbay_pull_leads", "leadbay_extend_lens"],
  },
  {
    intent:
      "Get me 20 brand-new prospects that look like our best customer, with the VP People's email.",
    expected_tool: "leadbay_find_new_leads",
    forbidden_tools: ["leadbay_pull_leads", "leadbay_enrich_titles"],
  },
  {
    intent: "We're entering the Lyon market — find 15 hotels that fit our ICP.",
    expected_tool: "leadbay_find_new_leads",
    forbidden_tools: ["leadbay_new_lens"],
  },
  {
    intent:
      "Here are 60 restaurant websites from my Austin sweep — which fit our profile, and who's the owner at each?",
    expected_tool: "leadbay_qualify_leads",
    forbidden_tools: [
      "leadbay_find_new_leads",
      "leadbay_bulk_qualify_leads",
      "leadbay_import_leads",
    ],
  },
  {
    intent:
      "Re-qualify everything you delivered last week and get phone numbers for the good ones.",
    expected_tool: "leadbay_qualify_leads",
    forbidden_tools: ["leadbay_bulk_qualify_leads"],
  },
  {
    intent:
      "Vet these 12 accounts from my spreadsheet against our qualification criteria.",
    expected_tool: "leadbay_qualify_leads",
    forbidden_tools: ["leadbay_import_leads", "leadbay_bulk_qualify_leads"],
  },
  {
    intent: "Any results yet from that lead search job you started?",
    expected_tool: "leadbay_lead_job_status",
    forbidden_tools: [
      "leadbay_bulk_enrich_status",
      "leadbay_import_status",
      "leadbay_qualify_status",
    ],
  },
  {
    intent:
      "Wait for the lead delivery job to finish and show me everything it found.",
    expected_tool: "leadbay_lead_job_status",
    forbidden_tools: ["leadbay_bulk_enrich_status"],
  },
];
