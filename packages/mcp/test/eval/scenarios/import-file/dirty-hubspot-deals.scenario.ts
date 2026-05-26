/**
 * Import-file scenario: a dirty HubSpot deal export.
 *
 * Tests prompt steps 1–5: scan, column preservation plan, derive,
 * resolve identities, decision log, hubspot URL preservation.
 *
 * Backend fixtures cover: list-mappable-fields (GET /crm/custom_fields),
 * resolve-import-rows (POST /leads/resolve) with 6 rows (2 deterministic
 * matches, 4 ambiguous), create-custom-field (POST /crm/custom_fields) for
 * HubSpot id, import-and-qualify (POST /imports + polling + GET /crm/custom_fields).
 *
 * Fixture paths match the actual LeadbayClient API calls:
 *   - list_mappable_fields:    GET /crm/custom_fields
 *   - resolve_import_rows:     POST /leads/resolve
 *   - import_and_qualify:      POST /imports?file_name=... + GET /imports/{id}
 *                              + GET /imports/{id}/leads + GET /crm/custom_fields
 */
import type { ScenarioFixture } from "../daily-check-in/clean-batch.scenario.js";

const ORG_ID = "org_hs_001";
const LENS_ID = 1; // matches last_requested_lens in /users/me fixture

const CSV_CONTENT = [
  '"Deal Name","Domain","Owner Email","HubSpot URL","Notes"',
  '"Acme Corp BYOC only DD - Q3 Pipeline","acme.example","jamie@acme.example","https://app.hubspot.com/contacts/123/record/0-3/45","intro via Linda"',
  '"Beta Health Uber BYOC","betahealth.example","sam@gmail.com","https://app.hubspot.com/contacts/123/record/0-3/46","saw demo at HIMSS"',
  '"Carter Group","cartergroup.example","amy@cartergroup.example","https://app.hubspot.com/contacts/123/record/0-3/47","main contact"',
  '"Delta Diner Manhattan","deltadiners.example","contact@deltadiners.example","","NYC location"',
  '"Delta Diner Brooklyn","deltadiners.example","contact@deltadiners.example","","Brooklyn location"',
  '"Echo Restaurant","echo.example","manager@gmail.com","","needs disambiguation"',
].join("\n");

const P = (path: string) => `/1.5${path}`;

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
    // ── resolveDefaultLens: GET /users/me (called by import_and_qualify) ──
    {
      method: "GET",
      path: P("/users/me"),
      status: 200,
      body: {
        id: "user_hs_001",
        email: "demo@leadbay.ai",
        name: "Demo User",
        admin: false,
        manager: false,
        organization: {
          id: ORG_ID,
          name: "Leadbay Demo Org",
          ai_agent_enabled: true,
          computing_intelligence: false,
        },
        last_requested_lens: LENS_ID,
      },
    },
    // ── list_mappable_fields: GET /crm/custom_fields ──────────────────────
    {
      method: "GET",
      path: P(`/crm/custom_fields`),
      status: 200,
      body: [
        { id: 100, name: "Notes", kind: "TEXT" },
      ],
    },
    // ── resolve_import_rows: POST /leads/resolve ───────────────────────────
    {
      method: "POST",
      path: P(`/leads/resolve`),
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
    // ── create custom field for HubSpot URL: POST /crm/custom_fields ─────
    {
      method: "POST",
      path: P(`/crm/custom_fields`),
      status: 200,
      body: { id: 101, name: "HubSpot record", kind: "EXTERNAL_ID" },
    },
    // ── import_and_qualify: POST /imports?file_name=... (multipart upload) ─
    {
      method: "POST",
      path: /\/1\.5\/imports(\?.*)?$/,
      status: 200,
      body: {
        id: "imp_hs_001",
        status: "preprocessing",
        lead_ids: [],
      },
    },
    // ── import_and_qualify: GET /imports/{importId} (polling done) ────────
    {
      method: "GET",
      path: P(`/imports/imp_hs_001`),
      status: 200,
      body: {
        id: "imp_hs_001",
        status: "done",
        lead_ids: ["lead_001", "lead_003"],
      },
    },
    // ── import_and_qualify: GET /imports/{importId}/leads ─────────────────
    {
      method: "GET",
      path: P(`/imports/imp_hs_001/leads`),
      status: 200,
      body: {
        lead_ids: ["lead_001", "lead_003"],
      },
    },
    // ── import_and_qualify: GET /crm/custom_fields (catalog for mapping) ──
    {
      method: "GET",
      path: P(`/crm/custom_fields`),
      status: 200,
      body: [
        { id: 100, name: "Notes", kind: "TEXT" },
        { id: 101, name: "HubSpot record", kind: "EXTERNAL_ID" },
      ],
    },
    // ── qualify web_fetch fan-out ──────────────────────────────────────────
    {
      method: "POST",
      path: P(`/leads/lead_001/web_fetch?force_fetch=false`),
      status: 200,
      body: { in_progress: false, fetch_at: "2026-05-20T00:00:00Z", content: {} },
    },
    {
      method: "POST",
      path: P(`/leads/lead_003/web_fetch?force_fetch=false`),
      status: 200,
      body: { in_progress: false, fetch_at: "2026-05-20T00:00:00Z", content: {} },
    },
    // ── qualify ai_agent_responses ────────────────────────────────────────
    {
      method: "GET",
      path: P(`/leads/lead_001/ai_agent_responses`),
      status: 200,
      body: [
        { question: "Is this a strong B2B fit?", lead_id: "lead_001", score: 17,
          response: "Strong fit.", computed_at: "2026-05-01T00:00:00Z", question_created_at: "2026-01-01T00:00:00Z" },
      ],
    },
    {
      method: "GET",
      path: P(`/leads/lead_003/ai_agent_responses`),
      status: 200,
      body: [
        { question: "Is this a strong B2B fit?", lead_id: "lead_003", score: 14,
          response: "Moderate fit.", computed_at: "2026-05-01T00:00:00Z", question_created_at: "2026-01-01T00:00:00Z" },
      ],
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
