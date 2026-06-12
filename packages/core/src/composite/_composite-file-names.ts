// Tool names whose source file lives under packages/core/src/composite/.
// The MCP server reads this set to (a) mark `_triggered_by` mandatory on
// these tools' input schemas, (b) reject dispatches that arrive without it,
// and (c) emit a dedicated `mcp composite call` PostHog event in addition
// to the existing `mcp tool called` event.
//
// Kept in sync with the on-disk directory by
// packages/mcp/test/audit/composite-file-names.test.ts — adding a new
// composite/<stem>.ts (or removing one) without updating this set fails
// that audit.
export const COMPOSITE_FILE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "leadbay_account_history",
  "leadbay_account_status",
  "leadbay_add_leads_to_campaign",
  "leadbay_adjust_audience",
  "leadbay_answer_clarification",
  "leadbay_bulk_enrich_status",
  "leadbay_bulk_qualify_leads",
  "leadbay_campaign_call_sheet",
  "leadbay_campaign_progression",
  "leadbay_create_campaign",
  "leadbay_enrich_titles",
  "leadbay_extend_lens",
  "leadbay_followups_map",
  "leadbay_import_and_qualify",
  "leadbay_import_leads",
  "leadbay_import_status",
  "leadbay_list_campaigns",
  "leadbay_my_lenses",
  "leadbay_new_lens",
  "leadbay_prepare_outreach",
  "leadbay_pull_followups",
  "leadbay_pull_leads",
  "leadbay_qualify_status",
  "leadbay_recall_ordered_titles",
  "leadbay_refine_prompt",
  "leadbay_remove_leads_from_campaign",
  "leadbay_report_friction",
  "leadbay_report_outreach",
  "leadbay_research_lead_by_id",
  "leadbay_research_lead_by_name_fuzzy",
  "leadbay_resolve_import_rows",
  "leadbay_scan_portfolio_signals",
  "leadbay_seed_candidates",
  "leadbay_tour_plan",
]);
