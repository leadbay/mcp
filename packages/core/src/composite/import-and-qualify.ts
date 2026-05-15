import type { LeadbayClient } from "../client.js";
import type {
  Tool,
  ToolContext,
  RequestMeta,
  CrmFieldMappingValue,
  CustomFieldDef,
  FileImportPayloadV15,
  ImportLeadsResponse,
} from "../types.js";
import { leadbay_import_and_qualify as IMPORT_AND_QUALIFY_DESCRIPTION } from "../tool-descriptions.generated.js";
import {
  importLeads,
  escapeCsvCell,
  isImportLeadsRunningResult,
} from "./import-leads.js";
import {
  fanOutWebFetchAndPoll,
  fingerprintMapping,
  extractHintsAndCandidates,
  buildQuestionOrder,
  type QualifyResult,
} from "./_qualify-helpers.js";

function escapeCsv(v: string): string {
  return escapeCsvCell(v);
}

function coerceCellToString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return ""; // arrays/objects/functions shouldn't reach preview's CSV
}

interface DomainInput {
  domain: string;
  name?: string;
}

interface RecordsMappings {
  fields: Record<string, CrmFieldMappingValue>;
  custom_fields?: Record<string, number | string>;
  statuses?: Record<string, string>;
  default_status?: string | null;
}

interface ImportAndQualifyParams {
  // Same input shape as leadbay_import_leads — pass exactly one of `domains`
  // or `records`.
  domains?: DomainInput[];
  records?: Array<Record<string, unknown>>;
  mappings?: RecordsMappings;
  // dry_run modes:
  //   - false (default): full import + qualify + return qualified[].
  //   - true: import wizard runs preprocess only — no commit, no qualify.
  //     Returns the existing leadbay_import_leads dry_run shape (mostly
  //     useful for input-validation dry-runs).
  //   - "preview": runs preprocess and returns the wizard's per-column
  //     mapping hints (AI confidence) + sample rows + custom-field
  //     candidates from the org's catalog matched against unmapped
  //     columns. Useful when the agent doesn't know the right mapping
  //     yet and wants to inspect before committing. NO ai_rescore quota
  //     consumed.
  dry_run?: boolean | "preview";
  // Budget knobs. Defaults are conservative for a 5–10 lead import; large
  // imports should pass total_budget_ms explicitly OR call qualify_status
  // after the inline call returns a qualify_id.
  per_lead_budget_ms?: number;
  total_budget_ms?: number;
  per_phase_budget_ms?: number;
  wait_for_completion?: boolean;
  // Lens id (for downstream wishlist / lead fetches). Defaults to active.
  lensId?: number;
  // When true (default), skip launching web_fetch on leads whose
  // ai_agent_lead_score is already non-null. Saves ai_rescore quota
  // on re-imports of the same companies. Set to false to force a fresh
  // qualification.
  skip_already_qualified?: boolean;
}

interface NotImportedEntry {
  rowId?: string;
  domain?: string;
  reason: string;
}

interface ChosenBudgets {
  per_lead_budget_ms: number;
  total_budget_ms: number;
  per_phase_budget_ms: number;
  wall_clock_estimate_ms: number;
  strategy: "small" | "default" | "large";
}

interface ImportAndQualifyResult {
  kind: "result";
  status?: "running";
  handle_id?: string;
  // True when the call was a dry_run input-validation (`dry_run: true`).
  // Top-level signal so the agent doesn't have to decode `not_imported[].reason`.
  dry_run?: boolean;
  // Populated when the composite picked budgets adaptively (caller passed
  // neither per_lead_budget_ms nor total_budget_ms). Lets the agent know
  // what wall-clock to communicate to the human user. Absent when the
  // caller specified budgets explicitly.
  chosen_budgets?: ChosenBudgets;
  // Composite-level handle. Persists in ~/.leadbay/bulks.json. Pass to
  // leadbay_qualify_status to resume after the response timed out.
  qualify_id: string | null;
  // Underlying file-import handles (one per chunk). Useful if the agent
  // wants to inspect the wizard's record-level diagnostics directly.
  import_ids: string[];

  // What the import returned.
  imported: Array<{ leadId: string; domain?: string; name: string | null; rowId?: string }>;
  not_imported: NotImportedEntry[];

  // What the qualify phase returned.
  qualified: QualifyResult[];
  still_running: Array<{ lead_id: string }>;
  failed: Array<{ lead_id: string; error: string }>;
  quota_exceeded: boolean;
  // Lead ids that were already qualified before this call and got skipped
  // from the web_fetch fan-out (still appear in qualified[] via refresh).
  skipped_already_qualified: string[];
  // Lead ids that exist in the org (the wizard imported them) but are NOT
  // in the active lens — backend's queueAiRescoreForLead is a no-op for
  // these. The agent should NOT poll qualify_status for them; they will
  // never appear in qualified[]. To get answers, either change the active
  // lens or accept the lead won't be qualified. Surfaced as a distinct
  // partition (not still_running) so the agent's poll loop terminates.
  // Real bug from iter-17 e2e: 2 of 4 imported leads sat in still_running[]
  // forever because they weren't in lens 21580.
  not_in_lens: string[];

  // Idempotency: when the same records+mapping are re-imported within 5 min,
  // the qualify_id is the same and `reused: true`.
  reused?: boolean;
  seconds_since_original?: number;

  // Lifecycle flags. The agent should treat ANY of these as "you have leads
  // in still_running[] but the composite has stopped trying for a reason —
  // either resume later (budget) or stop polling (cancelled / quota_blocked)".
  cancelled?: boolean;
  budget_exhausted?: boolean;
  // Set when 429 mid-fanout left leads in still_running[]. Distinct from
  // budget_exhausted because the wall clock had time left — the QUOTA ran
  // out, not the time. Mutually-non-exclusive; both can be true on a
  // long-running call that ran out of clock AND quota.
  quota_blocked?: boolean;

  region: "us" | "fr" | "custom";
  _meta: RequestMeta;
}

// Preview-mode return shape — no leads imported, no quota consumed.
interface MappingPreviewResult {
  kind: "preview";
  // The wizard's per-column AI mapping hints. Each entry: target field type
  // (StandardCrmFieldType or "CUSTOM.<id>") and confidence 0–100.
  mapping_hints: Array<{
    column: string;
    suggested_field: string;
    ai_confidence: number | null;
  }>;
  // Custom fields from the org catalog that case-insensitive-match an
  // unmapped column name. Useful when the wizard doesn't auto-suggest
  // (e.g., user-defined "priority" column).
  custom_field_candidates: Array<{
    column: string;
    candidates: Array<{
      id: string;
      name: string;
      type: string;
      mapping_value: `CUSTOM.${string}`;
      reason:
        | "exact_name_match"
        | "case_insensitive_match"
        | "fuzzy_substring_match";
    }>;
  }>;
  // First N sample rows from the upload (echoed by the wizard).
  sample_rows: Array<Record<string, string>>;
  // Status string from the wizard (PROCESSING / DONE / etc.).
  notes: string[];
  // Underlying import id (for diagnostics; do NOT call update_mappings on
  // it — preview leaves the row "incomplete").
  import_id: string;
  region: "us" | "fr" | "custom";
  _meta: RequestMeta;
}

const DEFAULT_PER_LEAD_BUDGET_MS = 90_000;
// 15 min by default — covers a 5-lead import (~2 min import + ~5 min×3
// concurrent qualify) with headroom under typical queue load.
const DEFAULT_TOTAL_BUDGET_MS = 15 * 60_000;
// Per-phase budget for the import wizard. Higher than import-leads' 60s
// default because under api-us queue load the process phase has been
// observed at 100s+ for even a 2-row import; under-shooting it kills the
// qualify phase before it starts. Capped by total_budget at runtime via
// runOneChunk's min(perPhase, totalDeadline-now).
const DEFAULT_PER_PHASE_BUDGET_MS = 5 * 60_000;

// Pick budgets based on input size when the caller passes none. The
// wall-clock estimate is a conservative upper bound — the actual time is
// often faster (skip-already-qualified leads return immediately).
//
// Strategy buckets (educated guesses based on observed live latencies):
//   small  (≤ 5 leads): inline-blocking, ~3 min total. Agent is likely
//                       in conversation; speed matters more than coverage.
//   default (6–20):     ~10 min total. Default's existing constants.
//   large  (> 20):      ~25 min total. Encourages handle-mode return; the
//                       agent should call qualify_status later anyway.
//
// Caller can always pass explicit budgets to override. The chosen_budgets
// field on the response makes the heuristic visible.
function pickAdaptiveBudgets(inputSize: number): ChosenBudgets {
  if (inputSize <= 5) {
    return {
      per_lead_budget_ms: 60_000,
      total_budget_ms: 3 * 60_000,
      per_phase_budget_ms: 90_000,
      wall_clock_estimate_ms: Math.max(60_000, inputSize * 60_000),
      strategy: "small",
    };
  }
  if (inputSize <= 20) {
    return {
      per_lead_budget_ms: 90_000,
      total_budget_ms: 10 * 60_000,
      per_phase_budget_ms: 3 * 60_000,
      wall_clock_estimate_ms: Math.min(10 * 60_000, inputSize * 60_000),
      strategy: "default",
    };
  }
  return {
    per_lead_budget_ms: 120_000,
    total_budget_ms: 25 * 60_000,
    per_phase_budget_ms: 5 * 60_000,
    // For >20 leads, expect handle-mode return. Estimate is the clip.
    wall_clock_estimate_ms: 25 * 60_000,
    strategy: "large",
  };
}

function inputSizeOf(params: ImportAndQualifyParams): number {
  if (Array.isArray(params.domains)) return params.domains.length;
  if (Array.isArray(params.records)) return params.records.length;
  return 0;
}

// Build the input for `fingerprintMapping` from the caller's mappings. Includes
// BOTH `fields` and `custom_fields` so two calls with the same `fields` but
// different custom-field targets get distinct fingerprints (and therefore
// distinct qualify_ids). Defensive: tolerates missing `fields` (now schema-legal
// since iter-5 relaxed the schema) by treating it as an empty map.
// Normalize an importLeads not_imported entry to the composite's shape.
// Crucially uses conditional spread to avoid emitting `rowId: undefined` /
// `domain: undefined` keys for domains-mode entries (matches the parallel
// `imported` mapping ~30 lines below). JSON.stringify drops undefined keys
// anyway, but the in-memory shape is the contract callers consume via
// structuredClone / typed validators.
function toNotImportedEntry(n: any): NotImportedEntry {
  const out: NotImportedEntry = { reason: n.reason };
  if (n.rowId !== undefined) out.rowId = n.rowId;
  if (n.domain !== undefined) out.domain = n.domain;
  return out;
}

function buildFingerprintInput(
  mappings: RecordsMappings | undefined
): Record<string, string> {
  if (!mappings) return { LEAD_NAME: "LEAD_NAME", LEAD_WEBSITE: "LEAD_WEBSITE" };
  const out: Record<string, string> = {};
  const fields = mappings.fields;
  if (fields && typeof fields === "object") {
    for (const [k, v] of Object.entries(fields)) {
      out[k] = String(v);
    }
  }
  const cf = mappings.custom_fields;
  if (cf && typeof cf === "object") {
    for (const [k, v] of Object.entries(cf)) {
      // Prefix to disambiguate from `fields[k]` if the same column name appears
      // in both (which is itself an IMPORT_MAPPING_DUPLICATE_CUSTOM error
      // already, but defensive).
      out[`__cf__${k}`] = String(v);
    }
  }
  return out;
}

export const importAndQualify: Tool<
  ImportAndQualifyParams,
  ImportAndQualifyResult | MappingPreviewResult
> = {
  name: "leadbay_import_and_qualify",
  annotations: {
    title: "Import + qualify leads",
    readOnlyHint: false,
    destructiveHint: true,
    // Composite of import (idempotent against domain hash) + qualify (which
    // is silent no-op for already-qualified leads). bulk-store + import
    // hashes return same handles on retry.
    idempotentHint: true,
    openWorldHint: true,
  },
  description: IMPORT_AND_QUALIFY_DESCRIPTION,
  write: true,
  version: "0.2.0",
  inputSchema: {
    type: "object",
    properties: {
      // Pass exactly one of `domains` or `records`. Schema doesn't enforce
      // XOR (JSON Schema 7 has limited oneOf support); execute() validates.
      domains: {
        type: "array",
        description:
          "Mode A: list of company domains to map to Leadbay leadIds. Mutually exclusive with `records`.",
        items: {
          type: "object",
          properties: {
            domain: {
              type: "string",
              description: "Company domain (e.g. 'apple.com'). Protocol/path are stripped.",
            },
            name: {
              type: "string",
              description: "Optional display name override; defaults to the domain.",
            },
          },
          required: ["domain"],
          // Closed shape — extra keys silently no-op, so reject explicitly.
          // Parallel surface to import_leads.domains[] (iter 13). Per second-
          // opinion #2 finding #3.
          additionalProperties: false,
        },
      },
      records: {
        type: "array",
        description:
          "Mode B: arbitrary CSV-shaped rows. Each record is an object whose keys are column names and " +
          "values are scalar (string/number/boolean/null). Mutually exclusive with `domains`. Accompany with " +
          "`mappings` UNLESS using `dry_run: 'preview'` — preview returns the wizard's mapping suggestions " +
          "without requiring a mapping up front.",
        items: { type: "object" },
      },
      mappings: {
        type: "object",
        description:
          "How each CSV column maps to Leadbay's CRM field schema. Required for records-mode WITHOUT " +
          "`dry_run: 'preview'`; ignored otherwise. The `fields` sub-property is REQUIRED only when at " +
          "least one column maps to a StandardCrmFieldType target; pure custom-field mappings can be " +
          "supplied via `custom_fields` shorthand alone.",
        properties: {
          fields: {
            type: "object",
            description:
              "Object whose keys are CSV column names and whose values are either StandardCrmFieldType " +
              "(LEAD_NAME, LEAD_WEBSITE, ..., CONTACT_TITLE) or 'CUSTOM.<id>'. Discover via " +
              "leadbay_list_mappable_fields. At least one entry must target LEADBAY_ID, CRM_ID, SIREN, " +
              "LEAD_NAME, or LEAD_WEBSITE. Use leadbay_resolve_import_rows to prepare LEADBAY_ID values " +
              "from messy user files. Contact exports and embedded owner/contact lists should map CONTACT_EMAIL/PHONE/TITLE/name fields " +
              "while preserving parent lead identity; expand structured people into repeated parent rows. HubSpot/source links should map to CUSTOM.<id> " +
              "fields created or discovered before import.",
          },
          custom_fields: {
            type: "object",
            description:
              "Ergonomic shorthand: `{CsvColumn: <number-id>}` or `{CsvColumn: '<field-name>'}` for " +
              "custom-field mappings. Resolved against /crm/custom_fields catalog.",
          },
          statuses: { type: "object", description: "Optional status string mapping." },
          default_status: { type: ["string", "null"], description: "Optional default status." },
        },
        // mappings has a closed shape (fields/custom_fields/statuses/default_status).
        // Inner objects (fields, custom_fields, statuses) keep open shapes
        // because their keys are user-defined CSV column names.
        additionalProperties: false,
      },
      per_lead_budget_ms: {
        type: "number",
        description: `Polling budget per lead in ms (default ${DEFAULT_PER_LEAD_BUDGET_MS}).`,
      },
      total_budget_ms: {
        type: "number",
        description:
          `Total wall-clock budget across import + qualify in ms (default ${DEFAULT_TOTAL_BUDGET_MS}). ` +
          `When exhausted, the response returns qualify_id for resume via leadbay_qualify_status.`,
      },
      per_phase_budget_ms: {
        type: "number",
        description:
          `Per-phase budget for the import wizard (default ${DEFAULT_PER_PHASE_BUDGET_MS}); ` +
          `mirrors leadbay_import_leads.`,
      },
      wait_for_completion: {
        type: "boolean",
        description:
          "When false, enqueue the import phase and return `{kind:'result', status:'running', handle_id}` immediately. Poll leadbay_import_status. Default is true for 0.6.x backwards compatibility.",
      },
      lensId: {
        type: "number",
        description: "Lens id (escape hatch — defaults to active).",
      },
      dry_run: {
        description:
          "Optional. `true` runs preprocess only (no commit, no qualify). " +
          "`'preview'` runs preprocess and returns the wizard's per-column AI " +
          "mapping hints + sample rows + custom-field candidates from the org " +
          "catalog so the agent can choose a mapping. Default: false (full flow).",
      },
      skip_already_qualified: {
        type: "boolean",
        description:
          "When true (default), skips web_fetch launch on leads whose " +
          "ai_agent_lead_score is already non-null. Saves quota. Set false " +
          "to force fresh re-qualification.",
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    description:
      "Two return shapes: kind:'preview' (when dry_run='preview') with mapping hints; kind:'result' (default) with imported + qualified leads + qualify_id handle.",
    properties: {
      kind: {
        type: "string",
        description: "'result' (full flow) or 'preview' (dry_run='preview' mapping diagnostics).",
      },
      status: {
        type: "string",
        description: "`running` when wait_for_completion=false.",
      },
      handle_id: {
        type: "string",
        description: "Import handle to pass to leadbay_import_status when wait_for_completion=false.",
      },
      // preview-shape keys
      mapping_hints: {
        type: "array",
        description: "Per-column AI-confidence suggestions (preview shape).",
        items: { type: "object" },
      },
      custom_field_candidates: {
        type: "array",
        description: "Org custom fields that match unmapped columns (preview shape).",
        items: { type: "object" },
      },
      sample_rows: {
        type: "array",
        description: "First few rows of the preprocessed sample (preview shape).",
        items: { type: "object" },
      },
      notes: {
        type: "array",
        description: "Operator notes (e.g., catalog fetch errors).",
        items: { type: "string" },
      },
      import_id: {
        type: "string",
        description: "Backend file-import handle (preview shape).",
      },
      // result-shape keys
      dry_run: { type: "boolean", description: "True when dry_run:true was passed." },
      chosen_budgets: {
        type: "object",
        description: "Adaptive budgets the composite selected (when caller didn't override): {per_lead_budget_ms, total_budget_ms, per_phase_budget_ms, wall_clock_estimate_ms, strategy}.",
      },
      qualify_id: {
        type: ["string", "null"],
        description: "UUIDv4 handle for polling via leadbay_qualify_status. Null when no leads were qualified.",
      },
      import_ids: {
        type: "array",
        description: "Backend file-import handles (one per chunk).",
        items: { type: "string" },
      },
      imported: {
        type: "array",
        description: "Leads that landed in CRM. Each: {leadId, domain?, name, rowId?}.",
        items: { type: "object" },
      },
      not_imported: {
        type: "array",
        description: "Inputs that didn't land. Each has a `reason` plus the input echo.",
        items: { type: "object" },
      },
      qualified: {
        type: "array",
        description: "Leads whose qualification settled within budgets.",
        items: { type: "object" },
      },
      still_running: {
        type: "array",
        description: "Leads still being qualified at deadline; agent calls leadbay_qualify_status with qualify_id.",
        items: { type: "object" },
      },
      failed: {
        type: "array",
        description: "Per-lead errors observed during qualification.",
        items: { type: "object" },
      },
      quota_exceeded: { type: "boolean" },
      skipped_already_qualified: {
        type: "array",
        description: "Lead ids skipped because ai_agent_lead_score was already non-null (skip_already_qualified=true).",
        items: { type: "string" },
      },
      not_in_lens: {
        type: "array",
        description: "Lead ids that aren't members of the active lens — backend won't qualify them.",
        items: { type: "string" },
      },
      reused: {
        type: "boolean",
        description: "True when an identical qualify_id was launched within the idempotency window.",
      },
      seconds_since_original: { type: "number" },
      cancelled: { type: "boolean", description: "True when ctx.signal aborted mid-flight." },
      budget_exhausted: { type: "boolean", description: "True when total_budget_ms hit before all leads finished." },
      quota_blocked: { type: "boolean", description: "True when quota was exhausted before launching all leads." },
      region: { type: "string" },
      _meta: { type: "object" },
    },
    required: ["kind", "region", "_meta"],
  },
  execute: async (
    client: LeadbayClient,
    params: ImportAndQualifyParams,
    ctx?: ToolContext
  ): Promise<ImportAndQualifyResult | MappingPreviewResult> => {
    const signal = ctx?.signal;
    // Adaptive budgets when caller supplies none (and not in preview mode).
    let chosenBudgets: ChosenBudgets | undefined;
    if (
      params.dry_run !== "preview" &&
      params.per_lead_budget_ms === undefined &&
      params.total_budget_ms === undefined &&
      params.per_phase_budget_ms === undefined
    ) {
      chosenBudgets = pickAdaptiveBudgets(inputSizeOf(params));
    }
    const perLeadBudget =
      params.per_lead_budget_ms ?? chosenBudgets?.per_lead_budget_ms ?? DEFAULT_PER_LEAD_BUDGET_MS;
    const totalBudget =
      params.total_budget_ms ?? chosenBudgets?.total_budget_ms ?? DEFAULT_TOTAL_BUDGET_MS;
    const perPhaseBudget =
      params.per_phase_budget_ms ?? chosenBudgets?.per_phase_budget_ms ?? DEFAULT_PER_PHASE_BUDGET_MS;
    const totalDeadline = Date.now() + totalBudget;
    const skipAlreadyQualified = params.skip_already_qualified ?? true;

    // Preview mode short-circuits before bulk-store / qualify-fanout. We
    // upload the CSV in dry_run=true mode (the wizard runs preprocess but
    // the row is left "incomplete" — no committed leads, no qualify quota).
    if (params.dry_run === "preview") {
      return await runPreview(client, params, ctx, perPhaseBudget, totalBudget);
    }

    if (!ctx?.bulkTracker) {
      throw client.makeError(
        "BULK_TRACKER_UNAVAILABLE",
        "No BulkTracker configured on this MCP instance",
        "leadbay_import_and_qualify needs a BulkTracker (qualify_id persistence). " +
          "Upgrade to @leadbay/mcp ≥0.5.0 or set LEADBAY_BULK_STORE_ALLOW_MEMORY=1.",
        ""
      );
    }

    if (params.wait_for_completion === false) {
      const queued = await importLeads.execute(
        client,
        {
          domains: params.domains,
          records: params.records,
          mappings: params.mappings,
          per_phase_budget_ms: perPhaseBudget,
          total_budget_ms: totalBudget,
          ...(params.dry_run === true ? { dry_run: true } : {}),
          wait_for_completion: false,
        },
        ctx
      );
      if (!isImportLeadsRunningResult(queued)) {
        return {
          kind: "result",
          ...(chosenBudgets ? { chosen_budgets: chosenBudgets } : {}),
          qualify_id: null,
          import_ids: queued.importIds,
          imported: queued.leads.map((l: any) => ({
            leadId: l.leadId,
            ...(l.domain ? { domain: l.domain } : {}),
            name: l.name ?? null,
            ...(l.rowId ? { rowId: l.rowId } : {}),
          })),
          not_imported: queued.not_imported.map(toNotImportedEntry),
          qualified: [],
          still_running: [],
          failed: [],
          quota_exceeded: false,
          skipped_already_qualified: [],
          not_in_lens: [],
          region: client.region,
          _meta: queued._meta,
        };
      }
      return {
        kind: "result",
        status: "running",
        handle_id: queued.handle_id,
        ...(chosenBudgets ? { chosen_budgets: chosenBudgets } : {}),
        qualify_id: null,
        import_ids: queued.importIds,
        imported: [],
        not_imported: [],
        qualified: [],
        still_running: [],
        failed: [],
        quota_exceeded: false,
        skipped_already_qualified: [],
        not_in_lens: [],
        region: client.region,
        _meta: queued._meta,
      };
    }

    // Phase 1 — IMPORT. Re-uses the existing composite end-to-end (chunking,
    // mapping preflight, custom-field validation, polling, AbortSignal).
    // Per second-opinion #2 finding #2: progress emit lifted from runPreview
    // (preview-only branch) to the live main path so users get the full
    // 3-phase stream during real imports.
    ctx?.progress?.({
      progress: 1,
      total: 3,
      message: "Importing leads (phase 1/3 — preprocess + commit)",
    });
    const importResultRaw = await importLeads.execute(
      client,
      {
        domains: params.domains,
        records: params.records,
        mappings: params.mappings,
        per_phase_budget_ms: perPhaseBudget,
        total_budget_ms: totalBudget,
        ...(params.dry_run === true ? { dry_run: true } : {}),
        wait_for_completion: true,
      },
      ctx
    );
    if (isImportLeadsRunningResult(importResultRaw)) {
      throw client.makeError(
        "IMPORT_ASYNC_UNEXPECTED",
        "Import returned an async handle while import_and_qualify was waiting for completion",
        "Retry with wait_for_completion=false and poll leadbay_import_status, or retry the blocking call.",
        "POST /imports"
      );
    }
    const importResult = importResultRaw;

    if (importResult.cancelled) {
      // import phase aborted before producing leadIds — surface immediately.
      return {
        kind: "result",
        ...(params.dry_run === true ? { dry_run: true } : {}),
        ...(chosenBudgets ? { chosen_budgets: chosenBudgets } : {}),
        qualify_id: null,
        import_ids: importResult.importIds,
        imported: [],
        not_imported: importResult.not_imported.map(toNotImportedEntry),
        qualified: [],
        still_running: [],
        failed: [],
        quota_exceeded: false,
        skipped_already_qualified: [],
        not_in_lens: [],
        cancelled: true,
        region: client.region,
        _meta: client.lastMeta ?? {
          region: client.region,
          endpoint: "POST /imports",
          latency_ms: null,
          retry_after: null,
        },
      };
    }

    const imported = importResult.leads.map((l) => {
      const out: { leadId: string; domain?: string; name: string | null; rowId?: string } = {
        leadId: l.leadId,
        name: l.name,
      };
      if ((l as any).domain) out.domain = (l as any).domain;
      if ((l as any).rowId) out.rowId = (l as any).rowId;
      return out;
    });

    const not_imported: NotImportedEntry[] = importResult.not_imported.map(toNotImportedEntry);

    if (imported.length === 0) {
      // No matched leads → no qualify phase, no qualify_id (no point persisting an
      // empty handle). Return the import shape unchanged. dry_run flag surfaces
      // the validation-only path distinctly from "all malformed".
      return {
        kind: "result",
        ...(params.dry_run === true ? { dry_run: true } : {}),
        ...(chosenBudgets ? { chosen_budgets: chosenBudgets } : {}),
        qualify_id: null,
        import_ids: importResult.importIds,
        imported,
        not_imported,
        qualified: [],
        still_running: [],
        failed: [],
        quota_exceeded: false,
        skipped_already_qualified: [],
        not_in_lens: [],
        region: client.region,
        _meta: client.lastMeta ?? {
          region: client.region,
          endpoint: "POST /imports",
          latency_ms: null,
          retry_after: null,
        },
      };
    }

    // Phase 2 — register the qualify handle BEFORE launching web_fetch so the
    // bulk record exists on disk if the launch fans out and crashes.
    ctx?.progress?.({
      progress: 2,
      total: 3,
      message: "Import committed; preparing qualification (phase 2/3)",
    });
    const lensId = params.lensId ?? (await client.resolveDefaultLens());

    // Source-of-truth for "leads to qualify": GET /imports/{id}/leads (added
    // backend-side in PR #1801, 2026-05-06). Returns distinct lead ids that
    // the import touched (matched-existing AND newly-created), which is what
    // downstream qualify/enrich workflows want — see the imports-mcp wrapper
    // spec §2.2 ("Use matchedLeadIds, not importedLeadIds").
    //
    // Falls back to the per-record reconciled set (`imported.map(l => l.leadId)`)
    // when the endpoint is unavailable (e.g. 404 on older backends, 400
    // in_progress if processing finished but the row hasn't flipped yet —
    // tolerate both).
    const leadIdsFromImported = imported.map((l) => l.leadId);
    const leadIdSet = new Set<string>(leadIdsFromImported);
    // Parallel fan-out across all chunk importIds — for the "large" strategy
    // bucket (chunked at 100) this is up to 5 concurrent GETs, bounded by
    // the client semaphore. Sequential `for` would 5x the wall-clock cost.
    const leadsResults = await Promise.allSettled(
      importResult.importIds.map((importId) =>
        client.request<ImportLeadsResponse>(
          "GET",
          `/imports/${importId}/leads`
        )
      )
    );
    leadsResults.forEach((r, i) => {
      if (r.status === "fulfilled" && Array.isArray(r.value?.lead_ids)) {
        for (const id of r.value.lead_ids) leadIdSet.add(id);
      } else if (r.status === "rejected") {
        const err: any = r.reason;
        ctx?.logger?.warn?.(
          `import_and_qualify: /imports/${importResult.importIds[i]}/leads unavailable (${err?.code ?? err?.message ?? "unknown"}) — using per-record reconciliation`
        );
      }
    });
    const leadIds = [...leadIdSet];
    const mappingFp = fingerprintMapping(
      // For domains-mode the mapping is the canonical {LEAD_NAME, LEAD_WEBSITE}.
      // For records-mode include BOTH `fields` and `custom_fields` shorthand
      // so two calls with the same `fields` but different custom-field
      // targets do NOT collide on the same qualify_id.
      buildFingerprintInput(params.mappings)
    );

    const reservation = await ctx.bulkTracker.findOrCreatePendingQualify({
      lead_ids: leadIds,
      import_ids: importResult.importIds,
      lens_id: lensId,
      mapping_fingerprint: mappingFp,
      per_lead_budget_ms: perLeadBudget,
      total_budget_ms: totalBudget,
    });

    if (reservation.reused) {
      ctx?.logger?.info?.(
        `import_and_qualify: reusing qualify_id=${reservation.record.bulk_id} ` +
          `(seconds_since_original=${reservation.seconds_since_original})`
      );
    }

    // Mark launched even before fan-out — the qualify_id is persisted with the
    // lead set, so a status call can recover even if the rest of this composite
    // crashes. `markLaunched` flips status pending→launched. We retry once
    // before swallowing because if the launch DOES happen but the bit doesn't
    // flip, qualify_status will trap immediate calls with BULK_PENDING and
    // hint the agent to relaunch — burning extra ai_rescore quota redundantly.
    let launchMarked = false;
    for (const attempt of [1, 2]) {
      try {
        await ctx.bulkTracker.markLaunched(reservation.record.bulk_id);
        launchMarked = true;
        break;
      } catch (err) {
        ctx?.logger?.warn?.(
          `import_and_qualify: markLaunched attempt ${attempt} failed: ${(err as Error)?.message ?? err}`
        );
      }
    }
    if (!launchMarked) {
      ctx?.logger?.warn?.(
        `import_and_qualify: markLaunched failed twice — qualify_status may BULK_PENDING-trap immediate retrieval; agent should poll, not relaunch`
      );
    }

    // Resolve the org's qualification-question catalog so qualifications[]
    // can be sorted by stable ordinal (instead of backend-determined order).
    // Cached for 10min by client.resolveTasteProfile — cheap.
    let questionOrder = undefined;
    try {
      const taste = await client.resolveTasteProfile();
      questionOrder = buildQuestionOrder(taste.qualificationQuestions ?? []);
    } catch (err: any) {
      ctx?.logger?.warn?.(
        `qualify: question order unavailable (${err?.code ?? err?.message ?? "unknown"}) — falling back to alphabetical`
      );
    }

    // Phase 3 — fan-out web_fetch + poll until budget. The lens-id preflight
    // ALWAYS runs (not gated on skip_already_qualified) because the helper
    // ALSO uses it to detect not_in_lens leads — backend won't qualify those.
    // The separate `skipAlreadyQualifiedLaunch` flag controls whether
    // already-qualified leads bypass the web_fetch POST.
    ctx?.progress?.({
      progress: 3,
      total: 3,
      message: `Qualifying ${leadIds.length} lead${leadIds.length === 1 ? "" : "s"} (phase 3/3)`,
    });
    const fanOut = await fanOutWebFetchAndPoll(client, leadIds, {
      perLeadBudgetMs: perLeadBudget,
      totalDeadlineMs: totalDeadline,
      signal,
      ctx,
      skipAlreadyQualifiedLensId: lensId,
      skipAlreadyQualifiedLaunch: skipAlreadyQualified,
      ...(questionOrder ? { questionOrder } : {}),
    });

    // iter-21: when the qualify fan-out was cancelled (ctx.signal aborted),
    // mark the bulk-store record cancelled so a subsequent qualify_status
    // returns BULK_CANCELLED instead of "still launched". Best-effort —
    // the operational cancel already happened; only the record needs the bit.
    if (fanOut.cancelled) {
      try {
        await ctx.bulkTracker.markCancelled(reservation.record.bulk_id);
      } catch (err: any) {
        ctx?.logger?.warn?.(
          `import_and_qualify: tracker.markCancelled failed: ${err?.message ?? err}`
        );
      }
    }

    const qualified = fanOut.results
      .filter((r) => !r._stillRunning)
      .map(({ _stillRunning, ...rest }) => rest);

    // still_running = launched-but-not-done + not_launched (we have the
    // qualify_id so the agent can resume). Failed leads (404, etc.) go into
    // `failed[]`. Excludes not_in_lens (those are surfaced separately).
    const notInLensSet = new Set<string>(fanOut.not_in_lens);
    const stillRunningIds = new Set<string>(
      [
        ...fanOut.results.filter((r) => r._stillRunning).map((r) => r.lead_id),
        ...fanOut.not_launched,
      ].filter((id) => !notInLensSet.has(id))
    );
    const still_running = [...stillRunningIds].map((lead_id) => ({ lead_id }));

    const budgetExhausted = Date.now() >= totalDeadline && still_running.length > 0;
    // quota_blocked: 429 mid-fanout left leads in still_running BEFORE the
    // wall-clock ran out. Lets the agent distinguish "come back later" (budget)
    // from "stop polling, your quota is gone" (quota).
    const quotaBlocked = fanOut.quota_exceeded && still_running.length > 0 && !budgetExhausted;

    // Skipped-already-qualified leads are launched-but-no-fetch-fired. We
    // recover the set by diffing imported vs leadIds-launched-fresh; the
    // refresh step inside fanOut already populated their qualifications[].
    const skipped_already_qualified =
      skipAlreadyQualified && fanOut.skipped_already_qualified
        ? [...fanOut.skipped_already_qualified]
        : [];

    return {
      kind: "result",
      ...(chosenBudgets ? { chosen_budgets: chosenBudgets } : {}),
      qualify_id: reservation.record.bulk_id,
      import_ids: importResult.importIds,
      imported,
      not_imported,
      qualified,
      still_running,
      failed: fanOut.failed,
      quota_exceeded: fanOut.quota_exceeded,
      skipped_already_qualified,
      not_in_lens: fanOut.not_in_lens,
      ...(reservation.reused
        ? {
            reused: true,
            seconds_since_original: reservation.seconds_since_original,
          }
        : {}),
      ...(fanOut.cancelled ? { cancelled: true } : {}),
      ...(budgetExhausted ? { budget_exhausted: true } : {}),
      ...(quotaBlocked ? { quota_blocked: true } : {}),
      region: client.region,
      _meta: client.lastMeta ?? {
        region: client.region,
        endpoint: "POST /imports → /web_fetch",
        latency_ms: null,
        retry_after: null,
      },
    };
  },
};

// Preview-mode runner: upload a small sample CSV directly via the wizard's
// preprocess phase, fetch the hints + samples, and return a
// MappingPreviewResult. We don't go through importLeads.execute because
// preview is precisely the case where the agent doesn't have a mapping yet.
async function runPreview(
  client: LeadbayClient,
  params: ImportAndQualifyParams,
  ctx: ToolContext | undefined,
  perPhaseBudget: number,
  _totalBudget: number
): Promise<MappingPreviewResult> {
  const me = await client.resolveMe();
  if (!me.admin) {
    throw client.makeError(
      "IMPORT_ADMIN_REQUIRED",
      "Preview mode requires admin role on the Leadbay account",
      "Ask the account owner to grant import permission, or use a token from an admin user.",
      "POST /imports"
    );
  }

  // Build a CSV from the first 50 records (or all if fewer) — the wizard's
  // hints don't need the full set; large CSVs would needlessly slow preview.
  const PREVIEW_SAMPLE_CAP = 50;
  let csv: string;
  if (Array.isArray(params.domains) && params.domains.length > 0) {
    const sample = params.domains.slice(0, PREVIEW_SAMPLE_CAP);
    const lines = ["LEAD_NAME,LEAD_WEBSITE"];
    for (const d of sample) {
      const dom = (d.domain ?? "").replace(/[",\n\r]/g, " ").trim();
      const name = (d.name ?? dom).replace(/[",\n\r]/g, " ").trim();
      lines.push(`${escapeCsv(name)},${escapeCsv(dom)}`);
    }
    csv = lines.join("\n") + "\n";
  } else if (Array.isArray(params.records) && params.records.length > 0) {
    const sample = params.records.slice(0, PREVIEW_SAMPLE_CAP);
    const headerSet = new Set<string>();
    for (const r of sample) for (const k of Object.keys(r)) headerSet.add(k);
    const header = [...headerSet];
    const lines = [header.map(escapeCsv).join(",")];
    for (const r of sample) {
      lines.push(
        header.map((c) => escapeCsv(coerceCellToString(r[c]))).join(",")
      );
    }
    csv = lines.join("\n") + "\n";
  } else {
    throw client.makeError(
      "IMPORT_EMPTY_INPUT",
      "Preview mode requires `domains` or `records`",
      "Pass at least one row to preview against.",
      "POST /imports"
    );
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `mcp-preview-${ts}.csv`;
  ctx?.logger?.info?.(
    `import_and_qualify(preview): uploading sample (${csv.length}B) for hints`
  );
  const upload = await client.requestRawBinary<FileImportPayloadV15>(
    "POST",
    `/imports?file_name=${encodeURIComponent(fileName)}`,
    "text/csv",
    csv
  );
  const importId = upload.id;

  // Poll preprocess. Honors ctx.signal so a caller-issued abort lands within
  // 2s instead of holding the call open for the full per_phase_budget.
  // Streams a phase-1 progress event ("preprocessing") to capable clients.
  const signal = ctx?.signal;
  // The composite has 3 phases the user can perceive: preprocess (this loop),
  // commit, qualify. Two of those can be slow under queue load — emit at
  // phase entry so the UI shows movement.
  ctx?.progress?.({
    progress: 1,
    total: 3,
    message: "Preprocessing import (phase 1/3)",
  });
  const deadline = Date.now() + perPhaseBudget;
  let fileImport: FileImportPayloadV15 | null = null;
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }
    const r = await client.request<FileImportPayloadV15>(
      "GET",
      `/imports/${importId}`
    );
    if (r.pre_processing?.finished) {
      fileImport = r;
      ctx?.progress?.({
        progress: 2,
        total: 3,
        message: "Preprocess complete; committing import (phase 2/3)",
      });
      break;
    }
    await new Promise<void>((res) => {
      const t = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        res();
      }, 2_000);
      const onAbort = () => {
        clearTimeout(t);
        signal?.removeEventListener("abort", onAbort);
        res();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
  if (signal?.aborted) {
    throw Object.assign(new Error("aborted"), { name: "AbortError" });
  }
  if (!fileImport) {
    throw client.makeError(
      "IMPORT_BUDGET_EXHAUSTED",
      `Preview preprocess did not finish within ${perPhaseBudget}ms`,
      "Increase per_phase_budget_ms or shrink the input. The wizard row will eventually be cleaned up.",
      `GET /imports/${importId}`
    );
  }
  if (fileImport.pre_processing?.error) {
    throw client.makeError(
      "IMPORT_PREPROCESS_FAILED",
      `Preview preprocess failed: ${fileImport.pre_processing.error}`,
      "Inspect the input rows for encoding / shape issues.",
      `GET /imports/${importId}`
    );
  }

  const notes: string[] = [];
  if (Array.isArray(params.domains)) {
    notes.push(
      "domains-mode: hints reflect the synthesized LEAD_NAME/LEAD_WEBSITE columns only."
    );
  }

  let catalog: CustomFieldDef[] = [];
  try {
    catalog = (await client.request<CustomFieldDef[]>(
      "GET",
      "/crm/custom_fields"
    )) ?? [];
  } catch (err: any) {
    notes.push(
      `custom-field catalog unavailable: ${err?.code ?? err?.message ?? "unknown"}`
    );
  }
  const { mapping_hints, custom_field_candidates, sample_rows } =
    extractHintsAndCandidates(fileImport, catalog);

  return {
    kind: "preview",
    mapping_hints,
    custom_field_candidates,
    sample_rows,
    notes,
    import_id: importId,
    region: client.region,
    _meta: client.lastMeta ?? {
      region: client.region,
      endpoint: `GET /imports/${importId}`,
      latency_ms: null,
      retry_after: null,
    },
  };
}
