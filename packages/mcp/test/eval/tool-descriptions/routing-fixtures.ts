/**
 * Tool-routing classifier fixtures.
 *
 * Each fixture is a (natural-language intent, expected-tool, forbidden-tools)
 * triple. The classifier eval feeds the intent to Sonnet with the full
 * Leadbay tool catalog bound (Anthropic native tool-use mode) and intercepts
 * the FIRST `tool_use` block. Pass = name matches `expected_tool`.
 *
 * Authoring note (per eng-review T4): these are written by the same person
 * who wrote the descriptions, so they're biased toward passing. We accept
 * the bias; the classifier is signal for regressions, not for absolute
 * correctness. To deepen signal later, regenerate intents via an
 * independent model.
 *
 * Coverage target: 3 intents per tool. Some tools share intents at
 * different specificity levels (e.g. "list my lenses" vs "show me the
 * lens config").
 */

export interface RoutingFixture {
  intent: string;
  expected_tool: string;
  forbidden_tools?: string[];   // strong false-positive signal
}

export const ROUTING_FIXTURES: RoutingFixture[] = [
  // Account / state
  { intent: "Show me my Leadbay account status and quota.", expected_tool: "leadbay_account_status" },
  { intent: "What's the quota I have left this month?", expected_tool: "leadbay_account_status" },
  { intent: "Which lens is currently active?", expected_tool: "leadbay_account_status" },

  // Pull leads
  { intent: "Give me today's fresh batch of leads.", expected_tool: "leadbay_pull_leads" },
  { intent: "What new leads has Leadbay surfaced for me?", expected_tool: "leadbay_pull_leads" },
  { intent: "Pull the morning queue.", expected_tool: "leadbay_pull_leads" },

  // Research lead
  {
    intent: "Tell me everything about lead 7d3f-abcd-1234, signals and contacts.",
    expected_tool: "leadbay_research_lead",
    forbidden_tools: ["leadbay_research_company"],
  },
  { intent: "Deep dive on this lead id.", expected_tool: "leadbay_research_lead" },
  { intent: "What contacts do we know for lead_001?", expected_tool: "leadbay_research_lead" },

  // Research company (without an existing leadId)
  {
    intent: "I want everything Leadbay knows about acme.com — import and research it.",
    expected_tool: "leadbay_research_company",
    forbidden_tools: ["leadbay_pull_leads"],
  },
  { intent: "Research a company by its primary domain.", expected_tool: "leadbay_research_company" },

  // Bulk qualify
  { intent: "Qualify the top 10 unqualified leads.", expected_tool: "leadbay_bulk_qualify_leads" },
  { intent: "Run AI qualification on 15 leads at once.", expected_tool: "leadbay_bulk_qualify_leads" },
  { intent: "Score a batch of unqualified leads.", expected_tool: "leadbay_bulk_qualify_leads" },

  // Refine audience
  { intent: "Tighten my audience to focus on hospitals running their own IT.", expected_tool: "leadbay_refine_prompt" },
  { intent: "Update the prospecting prompt to be narrower.", expected_tool: "leadbay_refine_prompt" },

  // Adjust audience (geo/firmographic)
  { intent: "Restrict my audience to the EU only.", expected_tool: "leadbay_adjust_audience" },
  { intent: "Increase the minimum employee count to 200.", expected_tool: "leadbay_adjust_audience" },

  // Resolve import rows
  { intent: "I have a messy CSV — help me figure out which rows match existing leads.", expected_tool: "leadbay_resolve_import_rows" },
  { intent: "Dedupe these contact rows against Leadbay.", expected_tool: "leadbay_resolve_import_rows" },

  // Import leads
  { intent: "Import this CSV into Leadbay.", expected_tool: "leadbay_import_leads" },
  { intent: "Add these companies to my CRM without qualification.", expected_tool: "leadbay_import_leads" },

  // Import and qualify
  { intent: "Import these domains and run AI qualification on each.", expected_tool: "leadbay_import_and_qualify" },
  { intent: "Onboard this list and qualify them in one pass.", expected_tool: "leadbay_import_and_qualify" },

  // Import status
  { intent: "Check progress on my running import.", expected_tool: "leadbay_import_status" },
  { intent: "Poll the import handle to see if it's done.", expected_tool: "leadbay_import_status" },

  // Bulk enrich
  { intent: "Enrich contact emails for the selected leads.", expected_tool: "leadbay_enrich_titles" },
  { intent: "Get the CTO emails for these companies.", expected_tool: "leadbay_enrich_titles" },

  // Bulk enrich status
  { intent: "How far along is the running enrichment job?", expected_tool: "leadbay_bulk_enrich_status" },

  // Qualify status
  { intent: "Poll the qualify_id handle for remaining results.", expected_tool: "leadbay_qualify_status" },

  // Report outreach
  {
    intent: "Log that I sent an email to Jamie at Acme.",
    expected_tool: "leadbay_report_outreach",
    forbidden_tools: ["leadbay_add_note"],
  },
  { intent: "Record my call as outreach on this lead.", expected_tool: "leadbay_report_outreach" },

  // Answer clarification
  { intent: "Pick option B for the audience clarification.", expected_tool: "leadbay_answer_clarification" },

  // Prepare outreach
  { intent: "Help me draft an email for this lead.", expected_tool: "leadbay_prepare_outreach" },

  // Recall ordered titles
  { intent: "Show me the titles I previously enriched, in order.", expected_tool: "leadbay_recall_ordered_titles" },

  // List mappable fields
  { intent: "What custom field types can I create for imports?", expected_tool: "leadbay_list_mappable_fields" },

  // Create custom field
  { intent: "Create a HubSpot record link field as EXTERNAL_ID.", expected_tool: "leadbay_create_custom_field" },

  // Add note
  { intent: "Attach a per-lead note: 'follow up after HIMSS'.", expected_tool: "leadbay_add_note" },

  // Granular reads
  { intent: "List all of my lenses.", expected_tool: "leadbay_list_lenses" },
  { intent: "Get the lens filter for lens X.", expected_tool: "leadbay_get_lens_filter" },
  { intent: "Get the scoring config for lens X.", expected_tool: "leadbay_get_lens_scoring" },
  { intent: "List the available industry sectors.", expected_tool: "leadbay_list_sectors" },
  { intent: "Show me my current user prompt.", expected_tool: "leadbay_get_user_prompt" },
  { intent: "Get the lead profile for lead_xyz.", expected_tool: "leadbay_get_lead_profile" },
  { intent: "Show recent activities on this lead.", expected_tool: "leadbay_get_lead_activities" },
  { intent: "Get my taste profile.", expected_tool: "leadbay_get_taste_profile" },
  { intent: "Get the contacts I have on lead X.", expected_tool: "leadbay_get_contacts" },
  { intent: "Get my current quota.", expected_tool: "leadbay_get_quota" },
  { intent: "Get the pending clarification.", expected_tool: "leadbay_get_clarification" },
  { intent: "Get notes on this lead.", expected_tool: "leadbay_get_lead_notes" },
  { intent: "Get the epilogue responses for this lead.", expected_tool: "leadbay_get_epilogue_responses" },
  { intent: "Get the prospecting actions for the active lens.", expected_tool: "leadbay_get_prospecting_actions" },
  { intent: "Get the cached web fetch for this domain.", expected_tool: "leadbay_get_web_fetch" },
  { intent: "Get my current selection ids.", expected_tool: "leadbay_get_selection_ids" },
  { intent: "Get the enrichment titles I'm using.", expected_tool: "leadbay_get_enrichment_job_titles" },

  // Granular writes
  { intent: "Qualify just this one lead synchronously.", expected_tool: "leadbay_qualify_lead" },
  { intent: "Enrich contacts on one specific lead.", expected_tool: "leadbay_enrich_contacts" },
  { intent: "Add these lead ids to my selection.", expected_tool: "leadbay_select_leads" },
  { intent: "Remove these lead ids from my selection.", expected_tool: "leadbay_deselect_leads" },
  { intent: "Clear my entire selection.", expected_tool: "leadbay_clear_selection" },
  { intent: "Switch the active lens to lens_xyz.", expected_tool: "leadbay_set_active_lens" },
  { intent: "Create a new lens.", expected_tool: "leadbay_create_lens" },
  { intent: "Update the existing lens metadata.", expected_tool: "leadbay_update_lens" },
  { intent: "Update only the filter on this lens.", expected_tool: "leadbay_update_lens_filter" },
  { intent: "Start a draft lens for experimentation.", expected_tool: "leadbay_create_lens_draft" },
  { intent: "Promote this draft lens to active.", expected_tool: "leadbay_promote_lens" },
  { intent: "Set my user prompt to a new prompt.", expected_tool: "leadbay_set_user_prompt" },
  { intent: "Clear the user prompt.", expected_tool: "leadbay_clear_user_prompt" },
  { intent: "Pick option C for the open clarification.", expected_tool: "leadbay_pick_clarification" },
  { intent: "Dismiss the open clarification.", expected_tool: "leadbay_dismiss_clarification" },
  { intent: "Set the epilogue status on this lead to follow_up.", expected_tool: "leadbay_set_epilogue_status" },
  { intent: "Remove the epilogue entry for this lead.", expected_tool: "leadbay_remove_epilogue" },
  { intent: "Preview the cost of bulk enrichment before launching.", expected_tool: "leadbay_preview_bulk_enrichment" },
  { intent: "Launch the bulk enrichment job.", expected_tool: "leadbay_launch_bulk_enrichment" },
];
