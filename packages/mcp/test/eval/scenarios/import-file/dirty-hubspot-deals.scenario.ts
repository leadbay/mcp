/**
 * Import-file scenario: a dirty HubSpot deal export.
 *
 * Tests prompt steps 1–5: scan, column preservation plan, derive,
 * resolve identities, decision log, hubspot URL preservation.
 *
 * Backend fixtures cover: list-mappable-fields, resolve-import-rows
 * with 6 rows (2 deterministic matches, 4 ambiguous), create-custom-field
 * for HubSpot id, import-and-qualify (since user asked to qualify).
 */
import type { ScenarioFixture } from "../daily-check-in/clean-batch.scenario.js";

const CSV_CONTENT = [
  '"Deal Name","Domain","Owner Email","HubSpot URL","Notes"',
  '"Acme Corp BYOC only DD - Q3 Pipeline","acme.example","jamie@acme.example","https://app.hubspot.com/contacts/123/record/0-3/45","intro via Linda"',
  '"Beta Health Uber BYOC","betahealth.example","sam@gmail.com","https://app.hubspot.com/contacts/123/record/0-3/46","saw demo at HIMSS"',
  '"Carter Group","cartergroup.example","amy@cartergroup.example","https://app.hubspot.com/contacts/123/record/0-3/47","main contact"',
  '"Delta Diner Manhattan","deltadiners.example","contact@deltadiners.example","","NYC location"',
  '"Delta Diner Brooklyn","deltadiners.example","contact@deltadiners.example","","Brooklyn location"',
  '"Echo Restaurant","echo.example","manager@gmail.com","","needs disambiguation"',
].join("\n");

export const SCENARIO: ScenarioFixture<{ file: string; instruction: string }> = {
  name: "dirty-hubspot-deals",
  prompt: "leadbay_import_file",
  tier: "gate",
  args: {
    file: "hubspot_deals.csv",
    instruction:
      "Import these rows, preserve the HubSpot URL as a stable link, and then qualify the leads. CSV content below.\n\n" +
      CSV_CONTENT,
  },
  backendFixtures: [
    {
      method: "GET",
      path: "/v1/custom_fields",
      status: 200,
      body: {
        custom_fields: [
          { id: 100, name: "Notes", kind: "TEXT" },
        ],
      },
    },
    {
      method: "POST",
      path: "/v1/leads/resolve",
      status: 200,
      body: {
        rows: [
          { row_index: 0, status: "matched", lead_id: "lead_001", confidence: 0.95 },
          { row_index: 1, status: "ambiguous", candidates: [{ lead_id: "lead_201", score: 0.7 }, { lead_id: "lead_202", score: 0.65 }] },
          { row_index: 2, status: "matched", lead_id: "lead_003", confidence: 0.92 },
          { row_index: 3, status: "ambiguous", candidates: [{ lead_id: "lead_204", score: 0.6 }, { lead_id: "lead_205", score: 0.58 }] },
          { row_index: 4, status: "ambiguous", candidates: [{ lead_id: "lead_204", score: 0.6 }, { lead_id: "lead_205", score: 0.58 }] },
          { row_index: 5, status: "no_match" },
        ],
        mappings_for_import: {
          fields: {
            LEAD_NAME: "Deal Name",
            LEAD_WEBSITE: "Domain",
          },
        },
      },
    },
    {
      method: "POST",
      path: "/v1/custom_fields",
      status: 200,
      body: { custom_field: { id: 101, name: "HubSpot record", kind: "EXTERNAL_ID" } },
    },
    {
      method: "POST",
      path: "/v1/leads/import_and_qualify",
      status: 200,
      body: {
        kind: "result",
        imported: [
          { leadId: "lead_001", name: "Acme Corp", rowId: "0" },
          { leadId: "lead_003", name: "Carter Group", rowId: "2" },
        ],
        qualified: [
          { lead_id: "lead_001", ai_agent_lead_score: 0.84, qualification_summary: "Strong fit." },
          { lead_id: "lead_003", ai_agent_lead_score: 0.71, qualification_summary: "Moderate fit." },
        ],
        still_running: [],
        not_imported: [{ rowId: "5", reason: "no_match" }],
      },
    },
  ],
  mission: {
    prompt_name: "leadbay_import_file",
    scenario_name: "dirty-hubspot-deals",
    user_intent:
      "Import a HubSpot deals CSV with messy names, preserve the HubSpot record link, qualify the imports.",
    success_criteria: [
      "rendered the COLUMN PRESERVATION PLAN byproduct BEFORE any leadbay_* tool call",
      "called leadbay_resolve_import_rows with cleaned LEAD_NAME (campaign suffixes BYOC, DD, Uber stripped)",
      "called leadbay_list_mappable_fields or leadbay_create_custom_field for HubSpot URL preservation",
      "rendered the DECISION LOG byproduct for ambiguous rows BEFORE writing LEADBAY_ID",
      "called leadbay_import_and_qualify (not just leadbay_import_leads) because user asked to qualify",
      "rendered the FINAL REPORT byproduct",
    ],
    required_calls: ["leadbay_resolve_import_rows", "leadbay_import_and_qualify"],
    required_byproducts: [
      "COLUMN PRESERVATION PLAN",
      "DECISION LOG",
      "FINAL REPORT",
    ],
    forbidden_calls: ["leadbay_report_outreach"],
  },
};
