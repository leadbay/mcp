/**
 * outputSchema ↔ structuredContent conformance — the drift-catcher (iter17).
 *
 * Two prior bugs in this run had the same shape:
 *   - iter-13: research_lead.outputSchema declared one shape; live return had
 *     different keys at the top level. The SDK didn't notice. The
 *     fresh-context second-opinion subagent did, on a delay.
 *   - iter-16: report_outreach.outputSchema declared the dry-run shape; the
 *     live (non-dry) path returned different keys. Same defect class.
 *
 * This test enrolls every Tool with an outputSchema by walking the exported
 * composite catalogues, calls each via the in-process MCP client with mocked
 * HTTP, and asserts:
 *   1. structuredContent is emitted (server.ts only emits for plain-object,
 *      non-error returns — so we must trigger the success path).
 *   2. Every key listed in outputSchema.required is present in the return.
 *   3. Every key in the return is declared in outputSchema.properties.
 *   4. (Recursive demo: research_lead.engagement nested keys validated against
 *      the nested schema, proving the pattern extends.)
 *
 * The meta-test asserts every outputSchema-declarer has a registered mock —
 * adding a new outputSchema without a conformance mock fails the test.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import {
  LeadbayClient,
  compositeReadTools,
  compositeWriteTools,
  granularReadTools,
  granularWriteTools,
  type Tool,
} from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

async function connect() {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  // includeAdvanced=true so the granular declarers (iter-19) are exposed
  // for conformance walks. includeWrite=true for the write composites.
  const server = buildServer(lbClient, { includeWrite: true, includeAdvanced: true });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return { mcpClient };
}

beforeEach(() => {
  resetHttpMock();
});

// -----------------------------------------------------------------------
// Conformance asserter — minimal subset of JSON Schema validation focused
// on the bug class (top-level required + no-undeclared-keys).
//
// Why not Ajv? Ajv would handle the full spec (types, formats, pattern,
// oneOf, etc.) but the bug class is "wrong top-level keys" not "wrong type
// for a deeply nested int". A 30-LoC custom validator catches the class
// without taking a runtime dep. Future iters can promote to Ajv if needed.
// -----------------------------------------------------------------------

interface JSONSchemaLike {
  type?: string | string[];
  properties?: Record<string, JSONSchemaLike>;
  required?: string[];
  items?: JSONSchemaLike;
  description?: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function assertConforms(
  value: unknown,
  schema: JSONSchemaLike,
  path: string,
  errors: string[]
): void {
  // Top-level shape: schema.type may be "object" or ["object", "null"].
  if (value === null) {
    const allowsNull =
      schema.type === "null" ||
      (Array.isArray(schema.type) && schema.type.includes("null"));
    if (!allowsNull) errors.push(`${path}: null but schema disallows null`);
    return;
  }

  if (schema.type === "object" || schema.type === undefined) {
    if (!isPlainObject(value)) {
      // schema says object but we got something else
      errors.push(
        `${path}: expected object, got ${Array.isArray(value) ? "array" : typeof value}`
      );
      return;
    }

    // Required keys present?
    for (const reqKey of schema.required ?? []) {
      if (!(reqKey in value)) {
        errors.push(`${path}.${reqKey}: required key missing from return`);
      }
    }

    // No undeclared top-level keys (THE bug class).
    if (schema.properties) {
      const declared = new Set(Object.keys(schema.properties));
      for (const k of Object.keys(value)) {
        if (!declared.has(k)) {
          errors.push(
            `${path}.${k}: return contains key not declared in outputSchema.properties (drift)`
          );
        }
      }
      // Recurse into declared properties whose schema is an object with its
      // own properties — proves the pattern extends to nested validation.
      for (const [k, propSchema] of Object.entries(schema.properties)) {
        if (k in value) {
          const nested = (value as any)[k];
          if (
            propSchema.type === "object" &&
            propSchema.properties &&
            nested !== null &&
            nested !== undefined
          ) {
            assertConforms(nested, propSchema, `${path}.${k}`, errors);
          }
        }
      }
    }
  }
}

function expectConforms(structured: unknown, outputSchema: JSONSchemaLike): void {
  const errors: string[] = [];
  assertConforms(structured, outputSchema, "$", errors);
  expect(errors, errors.join("\n")).toEqual([]);
}

// -----------------------------------------------------------------------
// Per-tool conformance mocks. Each entry mocks the happy-path HTTP for one
// outputSchema-declarer and runs the conformance assertion against the live
// structuredContent. The MOCKED registry is what the meta-test enforces:
// every Tool with outputSchema must have an entry here.
// -----------------------------------------------------------------------

interface ConformanceCase {
  toolName: string;
  arguments: Record<string, unknown>;
  setupMocks: () => void;
}

const CASES: ConformanceCase[] = [
  {
    toolName: "leadbay_resolve_import_rows",
    arguments: {
      records: [{ Company: "Apple", Domain: "apple.com" }],
      identity_mappings: { name: "Company", website: "Domain" },
    },
    setupMocks: () => {
      mockHttp([
        {
          method: "POST",
          path: "/1.5/leads/resolve",
          status: 200,
          body: {
            type: "matched",
            lead_id: "lead-apple",
            matched_on: ["website_exact"],
          },
        },
      ]);
    },
  },
  {
    toolName: "leadbay_account_status",
    arguments: {},
    setupMocks: () => {
      mockHttp([
        {
          method: "GET",
          path: "/1.5/users/me",
          status: 200,
          body: {
            email: "test@example.com",
            name: "Test User",
            admin: true,
            manager: false,
            language: "en",
            organization: {
              id: "org-1",
              name: "Test Co",
              ai_agent_enabled: true,
              computing_intelligence: false,
              quota_plan: "PRO",
            },
            last_requested_lens: 42,
          },
        },
        {
          method: "GET",
          path: "/1.5/organizations/org-1/quota_status",
          status: 200,
          body: { plan: "PRO", windows: [] },
        },
      ]);
    },
  },
  {
    toolName: "leadbay_pull_leads",
    arguments: { count: 10 },
    setupMocks: () => {
      mockHttp([
        {
          method: "GET",
          path: "/1.5/users/me",
          status: 200,
          body: {
            id: "u",
            organization: { id: "org-1", name: "X" },
            last_requested_lens: 42,
          },
        },
        {
          method: "GET",
          path: /\/1\.5\/lenses\/42\/leads\/wishlist/,
          status: 200,
          body: {
            items: [
              {
                id: "lead-1",
                name: "Acme",
                score: 80,
                ai_agent_lead_score: 70,
                location: null,
                description: null,
                size: null,
                website: "acme.com",
                contacts_count: 0,
                org_contacts_count: 0,
                tags: [],
                phone_numbers: [],
                keywords: [],
                recommended_contact_title: null,
                recommended_contact: null,
                liked: false,
                disliked: false,
              },
            ],
            pagination: { page: 0, pages: 1, total: 1 },
            computing_wishlist: false,
            computing_scores: false,
          },
        },
        {
          method: "GET",
          path: "/1.5/leads/lead-1/ai_agent_responses",
          status: 200,
          body: [
            {
              question: "Q1",
              question_created_at: "2026-04-20T00:00:00Z",
              lead_id: "lead-1",
              score: 8,
              response: "good fit",
              computed_at: "2026-04-20T00:00:00Z",
            },
          ],
        },
      ]);
    },
  },
  {
    toolName: "leadbay_pull_followups",
    arguments: { count: 5 },
    setupMocks: () => {
      mockHttp([
        // /monitor/filter (read the stored filter; default-filtered path)
        {
          method: "GET",
          path: "/1.5/monitor/filter",
          status: 200,
          body: { criteria: [] },
        },
        // /monitor with filtered=true
        {
          method: "GET",
          path: /\/1\.5\/monitor\?/,
          status: 200,
          body: {
            items: [
              {
                id: "lead-99",
                name: "ACME FOLLOWUP",
                score: 75,
                website: "acme-fu.com",
                last_monitor_action: "PURCHASE_LEAD_CONTACT",
                last_monitor_action_at: "2026-05-12T00:00:00Z",
                last_prospecting_action: "PURCHASE_LEAD_CONTACT",
                last_prospecting_action_at: "2026-05-12T00:00:00Z",
                epilogue_status: "EPILOGUE_STILL_CHASING",
                split_ai_summary: {
                  worth_pursuing: "Yes — ...",
                  approach_angle: "Focus on ...",
                  next_step: "Draft a targeted email ...",
                },
                recommended_contact: {
                  contact_id: "c-1",
                  first_name: "A",
                  last_name: "B",
                  job_title: "CIO",
                  email: null,
                  phone_number: null,
                  linkedin_page: null,
                },
                org_contacts: [],
                pushback_status: null,
              },
            ],
            pagination: { page: 0, pages: 1, total: 1 },
          },
        },
      ]);
    },
  },
  {
    toolName: "leadbay_research_lead_by_id",
    arguments: { leadId: "lead-1", lensId: 42 },
    setupMocks: () => {
      mockHttp([
        // POST /interactions (fire-and-forget) — succeed silently.
        {
          method: "POST",
          path: "/1.5/interactions",
          status: 200,
          body: {},
        },
        // /lenses/42/leads/lead-1
        {
          method: "GET",
          path: /\/1\.5\/lenses\/42\/leads\/lead-1$/,
          status: 200,
          body: {
            id: "lead-1",
            name: "Acme",
            sector_id: 7,
            score: 80,
            ai_agent_lead_score: 70,
            tags: [],
            size: null,
            location: null,
            website: "acme.com",
            description: null,
            short_description: null,
            social: {},
            liked: false,
            disliked: false,
            contacts_count: 0,
            org_contacts_count: 0,
            notes_count: 0,
            epilogue_actions_count: 0,
            prospecting_actions_count: 0,
            recommended_contact_title: null,
            recommended_contact: null,
          },
        },
        {
          method: "GET",
          path: "/1.5/leads/lead-1/ai_agent_responses",
          status: 200,
          body: [
            {
              question: "Why this lead?",
              question_created_at: "2026-04-20T00:00:00Z",
              lead_id: "lead-1",
              score: 8,
              response: "good fit",
              computed_at: "2026-04-20T00:00:00Z",
            },
          ],
        },
        {
          method: "GET",
          path: /\/1\.5\/leads\/lead-1\/enrich\/contacts/,
          status: 200,
          body: [],
        },
        {
          method: "GET",
          path: "/1.5/leads/lead-1/web_fetch",
          status: 200,
          body: { signals: [], status: "complete" },
        },
      ]);
    },
  },
  {
    toolName: "leadbay_bulk_qualify_leads",
    arguments: { leadIds: ["lead-1"] },
    setupMocks: () => {
      mockHttp([
        // ensure_lens / resolve default lens
        {
          method: "GET",
          path: "/1.5/users/me",
          status: 200,
          body: {
            id: "u",
            organization: { id: "org-1", name: "X" },
            last_requested_lens: 42,
          },
        },
        // /lenses/42 — lens load
        {
          method: "GET",
          path: /\/1\.5\/lenses\/42$/,
          status: 200,
          body: { id: 42, name: "L", filter_definition: {}, scoring_definition: {} },
        },
        // POST /lenses/42/leads/qualify_for_review (the launcher)
        {
          method: "POST",
          path: /\/1\.5\/lenses\/42\/leads\/qualify_for_review$/,
          status: 202,
          body: { request_id: "req-1" },
        },
        // First poll — completes immediately.
        {
          method: "GET",
          path: /\/1\.5\/lenses\/42\/leads\/qualify_for_review\/req-1$/,
          status: 200,
          body: {
            status: "completed",
            results: [
              {
                lead_id: "lead-1",
                ai_agent_lead_score: 78,
                qualification: [],
              },
            ],
          },
        },
        // Per-lead ai_agent_responses fetch (some implementations fan out).
        {
          method: "GET",
          path: "/1.5/leads/lead-1/ai_agent_responses",
          status: 200,
          body: [],
        },
      ]);
    },
  },
  {
    toolName: "leadbay_report_outreach",
    arguments: {
      lead_id: "lead-1",
      what: "called the contact",
      verification: { source: "user_confirmed", ref: "user said yes" },
      dry_run: true,
    },
    setupMocks: () => {
      // dry_run path: no HTTP calls expected; the composite returns the
      // dry-run shape directly. This exercises the dry-run branch of the
      // schema — the live branch is exercised by report_outreach.test.ts
      // and is independently asserted by output-schema.test.ts.
      mockHttp([]);
    },
  },
  {
    toolName: "leadbay_recall_ordered_titles",
    arguments: { leadIds: ["lead-9"] },
    setupMocks: () => {
      mockHttp([
        // Selection lock + select
        { method: "POST", path: /\/1\.5\/leads\/selection\/select/, status: 200, body: {} },
        // 0-titles preview returns previously_enriched_titles populated → preview_field path
        {
          method: "POST",
          path: "/1.5/leads/selection/enrichment/preview",
          status: 200,
          body: {
            enrichable_contacts: 0,
            title_suggestions: ["CTO"],
            auto_included_titles: [],
            previously_enriched_titles: ["CEO"],
          },
        },
        // Selection clear
        { method: "POST", path: "/1.5/leads/selection/clear", status: 200, body: {} },
      ]);
    },
  },
  {
    toolName: "leadbay_list_mappable_fields",
    arguments: {},
    setupMocks: () => {
      mockHttp([
        { method: "GET", path: "/1.5/crm/custom_fields", status: 200, body: [] },
      ]);
    },
  },
  {
    toolName: "leadbay_create_custom_field",
    arguments: {
      name: "HubSpot Contact",
      type: "EXTERNAL_ID",
      config: {
        url_template: "https://app.hubspot.com/contacts/123/record/0-1/{value}",
      },
    },
    setupMocks: () => {
      mockHttp([
        { method: "GET", path: "/1.5/crm/custom_fields", status: 200, body: [] },
        {
          method: "POST",
          path: "/1.5/crm/custom_fields",
          status: 200,
          body: {
            id: "8",
            name: "HubSpot Contact",
            type: "EXTERNAL_ID",
            config: {
              url_template: "https://app.hubspot.com/contacts/123/record/0-1/{value}",
            },
          },
        },
      ]);
    },
  },
  {
    toolName: "leadbay_import_status",
    arguments: { importIds: ["imp-1"] },
    setupMocks: () => {
      mockHttp([
        {
          method: "GET",
          path: "/1.5/imports/imp-1",
          status: 200,
          body: {
            id: "imp-1",
            date: "2026-05-12T00:00:00Z",
            file_name: "mcp-import.csv",
            imported_records: 1,
            pending_imported_records: 0,
            total_records: 1,
            mappings: null,
            pre_processing: {
              finished: true,
              error: null,
              hints: null,
              samples: [],
              status_samples: null,
            },
            processing: {
              progress: 1,
              finished: true,
              error: null,
            },
          },
        },
      ]);
    },
  },
  {
    toolName: "leadbay_research_lead_by_name_fuzzy",
    arguments: { companyName: "Acme" },
    setupMocks: () => {
      mockHttp([
        // resolveDefaultLens → /me
        {
          method: "GET",
          path: "/1.5/users/me",
          status: 200,
          body: {
            id: "u",
            organization: { id: "org-1", name: "X" },
            last_requested_lens: 42,
          },
        },
        // discoverLeads wishlist fan-out for fuzzy resolution
        {
          method: "GET",
          path: /\/1\.5\/lenses\/42\/leads\/wishlist/,
          status: 200,
          body: {
            items: [
              { id: "lead-1", name: "Acme", score: 80 },
            ],
            pagination: { page: 0, pages: 1, total: 1 },
          },
        },
        // POST /interactions (fire-and-forget)
        {
          method: "POST",
          path: "/1.5/interactions",
          status: 200,
          body: {},
        },
        // research_lead_by_id main payload via lens-prefixed path
        {
          method: "GET",
          path: /\/1\.5\/lenses\/42\/leads\/lead-1$/,
          status: 200,
          body: {
            id: "lead-1",
            name: "Acme",
            score: 80,
            ai_agent_lead_score: 70,
            location: null,
            description: null,
            short_description: null,
            size: null,
            website: "acme.com",
            logo: null,
            ai_summary: null,
            split_ai_summary: null,
            tags: [],
            phone_numbers: [],
            keywords: [],
            contacts_count: 0,
            recommended_contact_title: null,
            recommended_contact: null,
            web_fetch_in_progress: false,
          },
        },
        {
          method: "GET",
          path: "/1.5/leads/lead-1/ai_agent_responses",
          status: 200,
          body: [],
        },
        // getLeadProfile contacts (org)
        {
          method: "GET",
          path: /\/1\.5\/leads\/lead-1\/contacts/,
          status: 200,
          body: [],
        },
        // getLeadProfile paid contacts
        {
          method: "GET",
          path: /\/1\.5\/leads\/lead-1\/enrich\/contacts/,
          status: 200,
          body: [],
        },
        // getLeadProfile web_fetch
        {
          method: "GET",
          path: "/1.5/leads/lead-1/web_fetch",
          status: 200,
          body: { content: null, fetch_at: null },
        },
        // getLeadActivities
        {
          method: "GET",
          path: /\/1\.5\/leads\/lead-1\/activities/,
          status: 200,
          body: { items: [] },
        },
      ]);
    },
  },
  {
    toolName: "leadbay_prepare_outreach",
    arguments: { leadId: "lead-1" },
    setupMocks: () => {
      mockHttp([
        // getContacts
        {
          method: "GET",
          path: /\/1\.5\/leads\/lead-1\/contacts/,
          status: 200,
          body: [],
        },
        // getLeadProfile fan-out (best-effort; if it 404s the tool soft-fails)
        {
          method: "GET",
          path: /\/1\.5\/leads\/lead-1$/,
          status: 404,
          body: {},
        },
      ]);
    },
  },
  {
    toolName: "leadbay_refine_prompt",
    arguments: { prompt: "focus on Spanish hospitals", dry_run: true },
    setupMocks: () => {
      mockHttp([
        {
          method: "GET",
          path: "/1.5/users/me",
          status: 200,
          body: {
            id: "u",
            admin: true,
            organization: { id: "org-1", name: "X" },
          },
        },
      ]);
    },
  },
  // Granular cases (iter-19)
  {
    toolName: "leadbay_list_lenses",
    arguments: {},
    setupMocks: () => {
      mockHttp([
        {
          method: "GET",
          path: "/1.5/lenses",
          status: 200,
          body: [
            { id: 1, name: "Default", is_last_active: true, description: null },
          ],
        },
      ]);
    },
  },
  {
    toolName: "leadbay_list_locations",
    arguments: { q: "Paris" },
    setupMocks: () => {
      mockHttp([
        {
          method: "GET",
          path: /\/1\.5\/geo\/search/,
          status: 200,
          body: {
            results: [
              { id: "416102", country: "US", level: 8, name: "Paris", parent_ids: ["416102", "416103"] },
            ],
            parents: [
              { id: "416103", country: "US", level: 6, name: "Edgar County", parent_ids: [] },
            ],
          },
        },
      ]);
    },
  },
  {
    toolName: "leadbay_get_quota",
    arguments: {},
    setupMocks: () => {
      mockHttp([
        {
          method: "GET",
          path: "/1.5/users/me",
          status: 200,
          body: { id: "u", organization: { id: "org-1", name: "X" } },
        },
        {
          method: "GET",
          path: "/1.5/organizations/org-1/quota_status",
          status: 200,
          body: { plan: "PRO", windows: [] },
        },
      ]);
    },
  },
  {
    toolName: "leadbay_get_user_prompt",
    arguments: {},
    setupMocks: () => {
      mockHttp([
        {
          method: "GET",
          path: "/1.5/users/me",
          status: 200,
          body: { id: "u", organization: { id: "org-1", name: "X" } },
        },
        {
          method: "GET",
          path: "/1.5/organizations/org-1/user_prompt",
          status: 204,
        },
      ]);
    },
  },
  {
    toolName: "leadbay_get_clarification",
    arguments: {},
    setupMocks: () => {
      mockHttp([
        {
          method: "GET",
          path: "/1.5/users/me",
          status: 200,
          body: { id: "u", organization: { id: "org-1", name: "X" } },
        },
        {
          method: "GET",
          path: "/1.5/organizations/org-1/clarifications",
          status: 204,
        },
      ]);
    },
  },
  {
    toolName: "leadbay_select_leads",
    arguments: { leadIds: ["lead-1", "lead-2"] },
    setupMocks: () => {
      mockHttp([
        {
          method: "POST",
          path: /\/1\.5\/leads\/selection\/select/,
          status: 200,
          body: {},
        },
      ]);
    },
  },
  {
    toolName: "leadbay_pick_clarification",
    arguments: { option_id: "opt-1" },
    setupMocks: () => {
      mockHttp([
        {
          method: "GET",
          path: "/1.5/users/me",
          status: 200,
          body: { id: "u", organization: { id: "org-1", name: "X" } },
        },
        {
          method: "POST",
          path: "/1.5/organizations/org-1/pick_clarification",
          status: 200,
          body: {},
        },
      ]);
    },
  },
  {
    toolName: "leadbay_add_note",
    arguments: { leadId: "lead-1", note: "Follow up next week." },
    setupMocks: () => {
      mockHttp([
        {
          method: "POST",
          path: "/1.5/leads/lead-1/notes",
          status: 200,
          body: {
            id: "note-1",
            note: "Follow up next week.",
            created_at: "2026-05-07T20:00:00Z",
          },
        },
      ]);
    },
  },
  {
    toolName: "leadbay_get_lead_activities",
    arguments: { leadId: "lead-1" },
    setupMocks: () => {
      mockHttp([
        {
          method: "GET",
          path: /\/1\.5\/leads\/lead-1\/activities/,
          status: 200,
          body: { items: [], pagination: { page: 0, pages: 0, total: 0 } },
        },
      ]);
    },
  },
  {
    toolName: "leadbay_get_web_fetch",
    arguments: { leadId: "lead-1" },
    setupMocks: () => {
      mockHttp([
        {
          method: "GET",
          path: "/1.5/leads/lead-1/web_fetch",
          status: 200,
          body: { content: null, fetch_at: null },
        },
      ]);
    },
  },
];

// -----------------------------------------------------------------------
// Per-tool conformance assertions.
// -----------------------------------------------------------------------

describe("structuredContent conformance — every outputSchema declarer (iter17)", () => {
  for (const c of CASES) {
    it(`${c.toolName} structuredContent matches outputSchema (no drift)`, async () => {
      c.setupMocks();
      const { mcpClient } = await connect();
      const result = await mcpClient.callTool({
        name: c.toolName,
        arguments: c.arguments,
      });
      expect(
        (result as any).isError,
        `${c.toolName} returned isError — happy-path mock incomplete: ${JSON.stringify((result as any).content)}`
      ).not.toBe(true);

      const structured = (result as any).structuredContent;
      expect(
        structured,
        `${c.toolName} did not emit structuredContent — server.ts only emits for plain-object, non-error returns`
      ).toBeDefined();
      expect(isPlainObject(structured), `${c.toolName} structuredContent is not a plain object`).toBe(true);

      // Pull the tool's own outputSchema from the catalogue (single source
      // of truth) and validate the live shape against it.
      const allTools: Tool[] = [
      ...compositeReadTools,
      ...compositeWriteTools,
      ...granularReadTools,
      ...granularWriteTools,
    ];
      const tool = allTools.find((t) => t.name === c.toolName);
      expect(tool, `${c.toolName} not found in catalogue`).toBeDefined();
      expect(tool!.outputSchema, `${c.toolName} has no outputSchema`).toBeDefined();

      expectConforms(structured, tool!.outputSchema as JSONSchemaLike);
    });
  }
});

// -----------------------------------------------------------------------
// Documented opt-outs — tools whose mock setup is complex enough that the
// per-tool conformance test would be high-maintenance for low marginal
// signal. Each entry needs a one-line justification. The drift-catcher
// asserts every outputSchema declarer is EITHER in CASES or in OPT_OUT
// (with reason) — a new declarer can't sneak in without explicit choice.
// -----------------------------------------------------------------------
const OPT_OUT: Record<string, string> = {
  // followups_map is a thin wrapper around pull_followups (same execute,
  // same input/output schema; the only delta is the ui.resourceUri
  // binding). pull_followups already has a conformance case; adding a
  // duplicate would just double-cover the same code path.
  leadbay_followups_map:
    "Delegates execute + input/output schemas to leadbay_pull_followups verbatim — only the ui.resourceUri differs (binding test covers it).",
  // Bulk-status pollers require a populated BulkTracker context to reach
  // the success path; the existing per-tool tests in core/test/unit
  // exercise the success shape. The schema is still asserted by tools/list
  // and reviewed at write-time.
  leadbay_bulk_enrich_status:
    "Requires BulkTracker context with a 'launched' record + per-lead contacts fan-out.",
  leadbay_qualify_status:
    "Requires BulkTracker context with a 'launched' qualify record + refreshLeadStates fan-out.",
  // Selection-lifecycle composites: discover-mode runs an end-to-end
  // selection + preview + clear cycle. Tractable but verbose; per-tool
  // tests in packages/core cover the success shape.
  leadbay_enrich_titles:
    "Discover/launch flow walks selection + preview + tracker; covered by composite-level tests.",
  // Lens-routing composite: success shape requires resolveMe + lens read
  // + filter read + filter write. Per-tool tests in packages/core cover.
  leadbay_adjust_audience:
    "Lens-routing flow (resolveMe + lens + filter + write) is asymmetric across user/org/default branches.",
  // Clarification composite: success shape requires admin /me + clarification
  // GET + pick_clarification POST. Per-tool tests cover the answered + no-pending paths.
  leadbay_answer_clarification:
    "Requires /me admin + /clarifications + /pick_clarification POST sequence.",
  // Heavy import composites: full preprocess + commit + qualify chain.
  // Per-tool tests in packages/core cover the success shape.
  leadbay_import_leads:
    "Full preprocess + commit + chunk + resolution chain — heavy mock.",
  leadbay_import_and_qualify:
    "Import + qualify chain across multiple phases — heavy mock; covered by composite-level tests.",
  // Granular OPT_OUTs (iter-19): each declares outputSchema but the
  // happy-path mock would replicate work already done in packages/core
  // unit tests. The schema is reviewed at write-time + asserted in
  // tools/list shape tests.
  leadbay_get_lead_profile:
    "Five-fan-out HTTP mocks (lead/lenses + responses + contacts + paid + web_fetch) duplicate composite mocks.",
  leadbay_get_taste_profile:
    "Requires resolveTasteProfile path with multi-call coordination; covered in composite paths.",
  leadbay_create_lens:
    "Returns full LensPayload — backend-shape mock larger than the conformance-signal warrants.",
  leadbay_create_topup_link:
    "Single-field {url} response from POST /stripe/topup_checkout; the conformance signal is trivially the URL string. Live-probed shape lives in the tool source comment.",
  leadbay_open_billing_portal:
    "Single-field {url} response from GET /stripe/portal; sibling of create_topup_link with identical conformance signal.",
  // Tour planning + campaign trio (added for #3630 US1/US3). Each composes
  // existing tools or wraps a single live-probed POST/GET — the conformance
  // signal would just re-assert pullFollowups/pullLeads or the snake_case
  // CampaignPayload shape, which is documented in
  // .context/campaigns-probe/API.md. Per-tool execution shapes are
  // exercised by the live smoke E2E (test/smoke/live.test.ts).
  leadbay_tour_plan:
    "Glue over pullFollowups + pullLeads — conformance signal duplicates those tools'.",
  leadbay_create_campaign:
    "Single POST /campaigns wrapping the live-probed CampaignPayload shape.",
  leadbay_add_leads_to_campaign:
    "Single POST /campaigns/{id}/leads with {added, already_present} response.",
  leadbay_list_campaigns:
    "Single GET /campaigns returning CampaignWithStatsPayload[]; envelope-level shape.",
  leadbay_campaign_progression:
    "Single GET /campaigns/{id}/leads — paginated CampaignLeadPayload items.",
  leadbay_campaign_call_sheet:
    "Joins GET /campaigns/{id}/contacts + /leads into a call-ready payload; per-contact shape exercised by live-campaigns smoke (test/smoke/live-campaigns.test.ts).",
};

// -----------------------------------------------------------------------
// Drift-catcher meta-test — adding outputSchema to a new tool fails this
// test until a corresponding CASES entry OR OPT_OUT entry is added.
// -----------------------------------------------------------------------

describe("structuredContent conformance — drift catcher (iter17)", () => {
  it("every Tool with outputSchema has a registered conformance case OR documented opt-out", () => {
    const allTools: Tool[] = [
      ...compositeReadTools,
      ...compositeWriteTools,
      ...granularReadTools,
      ...granularWriteTools,
    ];
    const declarers = allTools.filter((t) => t.outputSchema).map((t) => t.name);
    const cases = new Set(CASES.map((c) => c.toolName));
    const optOut = new Set(Object.keys(OPT_OUT));
    const missing = declarers.filter((name) => !cases.has(name) && !optOut.has(name));
    expect(
      missing,
      `Tools with outputSchema but no conformance case AND no OPT_OUT entry: ${missing.join(", ")}. Add to CASES (preferred) or OPT_OUT (with justification) in output-schema-conformance.test.ts.`
    ).toEqual([]);
  });

  it("OPT_OUT entries each carry a non-empty justification", () => {
    for (const [name, reason] of Object.entries(OPT_OUT)) {
      expect(reason.length, `${name} OPT_OUT reason is empty`).toBeGreaterThan(20);
    }
  });

  it("assertConforms catches an undeclared top-level key (positive control)", () => {
    const schema: JSONSchemaLike = {
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a"],
    };
    const errors: string[] = [];
    assertConforms({ a: "x", surprise: "drift" }, schema, "$", errors);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/drift/);
  });

  it("assertConforms catches a missing required key (positive control)", () => {
    const schema: JSONSchemaLike = {
      type: "object",
      properties: { a: { type: "string" }, b: { type: "string" } },
      required: ["a", "b"],
    };
    const errors: string[] = [];
    assertConforms({ a: "x" }, schema, "$", errors);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/required key missing/);
  });

  it("assertConforms recurses into nested objects (positive control)", () => {
    const schema: JSONSchemaLike = {
      type: "object",
      properties: {
        nested: {
          type: "object",
          properties: { ok: { type: "string" } },
          required: ["ok"],
        },
      },
    };
    const errors: string[] = [];
    assertConforms({ nested: { ok: "y", bad: "z" } }, schema, "$", errors);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/\$\.nested\.bad/);
  });
});
