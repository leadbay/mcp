import type { LeadbayClient } from "../client.js";
import type {
  Tool,
  ToolContext,
  RequestMeta,
  CustomFieldDef,
  StandardCrmFieldType,
  FileImportPayloadV15,
} from "../types.js";
import {
  extractHintsAndCandidates,
  type MappingHint,
  type CustomFieldCandidate,
} from "../composite/_qualify-helpers.js";
import { escapeCsvCell } from "../composite/import-leads.js";

interface StandardFieldEntry {
  name: StandardCrmFieldType;
  description: string;
  // What to put in mappings.fields[col] for this target. Mirrors `name`.
  mapping_value: StandardCrmFieldType;
}

interface CustomFieldEntry {
  id: string;
  name: string;
  type: string;
  description: string;
  // What to put in mappings.fields[col] for this target — the "CUSTOM.<id>"
  // wire form the backend expects. Agents should pass this verbatim into
  // leadbay_import_leads / leadbay_import_and_qualify.
  mapping_value: `CUSTOM.${string}`;
}

interface ListMappableFieldsParams {
  // When provided, the tool runs the wizard's preprocess on a sample of
  // these rows (≤50) and attaches per-column hints to the response. Useful
  // for agents that want list_mappable_fields AND mapping suggestions in
  // a single call. Records that exceed 50 rows are truncated.
  for_records?: Array<Record<string, unknown>>;
}

interface ListMappableFieldsResult {
  standard_fields: StandardFieldEntry[];
  custom_fields: CustomFieldEntry[];
  // Populated only when `for_records` was passed.
  mapping_hints?: MappingHint[];
  custom_field_candidates?: CustomFieldCandidate[];
  sample_rows?: Array<Record<string, string>>;
  notes?: string[];
  region: "us" | "fr" | "custom";
  _meta: RequestMeta;
}

// Ordered descriptions for the StandardCrmFieldType enum. Order matters for
// LLM readability — most-used fields first. Sourced from backend
// CrmFieldType.kt (StandardCrmFieldType enum) plus user-facing copy.
const STANDARD_FIELDS: ReadonlyArray<{
  name: StandardCrmFieldType;
  description: string;
}> = [
  { name: "LEAD_NAME", description: "Company name. Required for fuzzy match." },
  { name: "LEAD_WEBSITE", description: "Company domain (preferred matcher; protocol/path auto-stripped)." },
  { name: "EMAIL", description: "Email — domain part used as a website-fallback matcher." },
  { name: "CRM_ID", description: "Your CRM's stable lead identifier (round-trips back as crm_id on the lead)." },
  { name: "LEADBAY_ID", description: "Leadbay UUID, if you already have one (matches by id, no fuzzy needed)." },
  { name: "DEAL_CRM_ID", description: "Your CRM's deal id (one deal per row; combined with LEAD_STATUS forms a sales record)." },
  { name: "LEAD_STATUS", description: "Free-form status string (use mappings.statuses to map per-status)." },
  { name: "LEAD_STATUS_DATE", description: "ISO date for the LEAD_STATUS transition (parsed permissively)." },
  { name: "LEAD_SECTOR", description: "Industry/sector free-text (matched against Leadbay's sector taxonomy)." },
  { name: "LEAD_SIZE", description: "Headcount or revenue range as free text." },
  { name: "LEAD_LOCATION", description: "Single-cell address (preferred when CSV has one column)." },
  { name: "LEAD_LOCATION_STREET_NUM", description: "Street number — combined with the other LEAD_LOCATION_* parts to form the address." },
  { name: "LEAD_LOCATION_STREET", description: "Street name." },
  { name: "LEAD_LOCATION_POSTCODE", description: "Postal/ZIP code." },
  { name: "LEAD_LOCATION_CITY", description: "City." },
  { name: "OWNER", description: "Free-text owner identifier (no auto-match against users)." },
  { name: "SCORE", description: "Free-text caller-supplied score (informational only — NOT Leadbay's ai_agent_lead_score)." },
  { name: "SIREN", description: "French SIREN registry number (9 digits) — auto-matches against the FR registry." },
  { name: "CONTACT_FIRST_NAME", description: "Contact first name (creates an org contact)." },
  { name: "CONTACT_LAST_NAME", description: "Contact last name." },
  { name: "CONTACT_EMAIL", description: "Contact email." },
  { name: "CONTACT_PHONE_NUMBER", description: "Contact phone (free-form)." },
  { name: "CONTACT_TITLE", description: "Contact job title." },
  { name: "CONTACT_LINKEDIN", description: "Contact LinkedIn URL." },
];

// Description is rendered to give the LLM a one-line explanation of what
// kind of values to expect for this custom field. Backend types map roughly:
//   TEXT — free-form string, no coercion
//   NUMBER — numeric (parseFloat); used for scoring / qty
//   PRICE — numeric, with config.currency (e.g. "USD")
//   DATE — ISO date or config.format
//   DATETIME — ISO datetime or config.format
//   EXTERNAL_ID — opaque string, with config.urlTemplate for deep-linking
function describeCustomField(f: CustomFieldDef): string {
  switch (f.type) {
    case "TEXT":
      return `Custom TEXT field — free-form string.`;
    case "NUMBER":
      return `Custom NUMBER field — numeric value (parseFloat coerced server-side).`;
    case "PRICE":
      return `Custom PRICE field${
        f.config?.currency ? ` (${f.config.currency})` : ""
      } — numeric.`;
    case "DATE":
      return `Custom DATE field${
        f.config?.format ? ` (format: ${f.config.format})` : " (ISO yyyy-MM-dd)"
      }.`;
    case "DATETIME":
      return `Custom DATETIME field${
        f.config?.format ? ` (format: ${f.config.format})` : " (ISO datetime)"
      }.`;
    case "EXTERNAL_ID":
      return `Custom EXTERNAL_ID field — opaque id${
        f.config?.urlTemplate ? ` (deep-link template configured)` : ""
      }.`;
    default:
      // Unknown kind — surface plainly without rejecting.
      return `Custom field of unrecognized type "${f.type}" — pass values as strings.`;
  }
}

const PREVIEW_SAMPLE_CAP = 50;
const PREPROCESS_BUDGET_MS = 60_000;

export const listMappableFields: Tool<
  ListMappableFieldsParams,
  ListMappableFieldsResult
> = {
  name: "leadbay_list_mappable_fields",
  description:
    "List every CRM field the agent can target when calling leadbay_import_leads or leadbay_import_and_qualify. " +
    "Returns two arrays: `standard_fields` (Leadbay's built-in StandardCrmFieldType enum — LEAD_NAME, LEAD_WEBSITE, " +
    "LEAD_STATUS, contact + location + sector fields) and `custom_fields` (this org's user-defined fields — id, " +
    "name, type, and the literal `mapping_value` you pass in `mappings.fields`). For custom fields, `mapping_value` " +
    "is the wire-format string `CUSTOM.<id>` — pass it verbatim.\n\n" +
    "Optional `for_records` param: pass a sample of CSV-shaped rows and the tool also runs the wizard's preprocess " +
    "on them, attaching `mapping_hints` (per-column AI-confidence suggestions) and `custom_field_candidates` " +
    "(custom fields that match unmapped columns by exact / case-insensitive / fuzzy name) to the response. " +
    "Saves a separate preview round-trip when the agent already has data in hand.\n\n" +
    "When to use: before authoring an import mapping, especially when the CSV has columns that aren't obvious " +
    "matches for standard fields. When NOT to use: when you already know the mapping — this call is cheap " +
    "(~50ms with no for_records, ~5–10s with) but unnecessary if the agent has already cached the catalog " +
    "within the same conversation.",
  inputSchema: {
    type: "object",
    properties: {
      for_records: {
        type: "array",
        items: { type: "object" },
        description:
          "Optional sample of CSV-shaped rows (objects). When provided, the tool runs the wizard's preprocess " +
          "on the first 50 rows and attaches mapping_hints + custom_field_candidates to the response.",
      },
    },
    additionalProperties: false,
  },
  execute: async (
    client: LeadbayClient,
    params: ListMappableFieldsParams,
    ctx?: ToolContext
  ): Promise<ListMappableFieldsResult> => {
    const signal = ctx?.signal;
    const customs = await client.request<CustomFieldDef[]>(
      "GET",
      "/crm/custom_fields"
    );
    const standard_fields: StandardFieldEntry[] = STANDARD_FIELDS.map((s) => ({
      name: s.name,
      description: s.description,
      mapping_value: s.name,
    }));
    const catalog = customs ?? [];
    const custom_fields: CustomFieldEntry[] = catalog.map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      description: describeCustomField(f),
      mapping_value: `CUSTOM.${f.id}` as `CUSTOM.${string}`,
    }));

    const result: ListMappableFieldsResult = {
      standard_fields,
      custom_fields,
      region: client.region,
      _meta: client.lastMeta ?? {
        region: client.region,
        endpoint: "GET /crm/custom_fields",
        latency_ms: null,
        retry_after: null,
      },
    };

    if (Array.isArray(params.for_records) && params.for_records.length > 0) {
      const notes: string[] = [];
      try {
        const sample = params.for_records.slice(0, PREVIEW_SAMPLE_CAP);
        const headerSet = new Set<string>();
        for (const r of sample)
          if (r && typeof r === "object")
            for (const k of Object.keys(r)) headerSet.add(k);
        const header = [...headerSet];
        const lines = [header.map(escapeCsvCell).join(",")];
        for (const r of sample) {
          lines.push(
            header
              .map((c) => escapeCsvCell(coerceCsvValue((r as any)[c])))
              .join(",")
          );
        }
        const csv = lines.join("\n") + "\n";
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const fileName = `mcp-preview-${ts}.csv`;
        const upload = await client.requestRawBinary<FileImportPayloadV15>(
          "POST",
          `/imports?file_name=${encodeURIComponent(fileName)}`,
          "text/csv",
          csv
        );
        const importId = upload.id;
        const deadline = Date.now() + PREPROCESS_BUDGET_MS;
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
            break;
          }
          // Abort-aware sleep — match pattern in import-and-qualify.ts:759-770.
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
          if (signal?.aborted) {
            throw Object.assign(new Error("aborted"), { name: "AbortError" });
          }
        }
        if (!fileImport) {
          notes.push(
            `for_records preprocess did not finish within ${PREPROCESS_BUDGET_MS}ms — hints omitted`
          );
        } else if (fileImport.pre_processing?.error) {
          notes.push(
            `for_records preprocess failed: ${fileImport.pre_processing.error}`
          );
        } else {
          const extracted = extractHintsAndCandidates(fileImport, catalog);
          result.mapping_hints = extracted.mapping_hints;
          result.custom_field_candidates = extracted.custom_field_candidates;
          result.sample_rows = extracted.sample_rows;
        }
      } catch (err: any) {
        notes.push(
          `for_records preprocess error: ${err?.code ?? err?.message ?? "unknown"} — hints omitted`
        );
      }
      if (notes.length > 0) result.notes = notes;
    }

    return result;
  },
};

function coerceCsvValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}
