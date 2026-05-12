import { createHash, randomUUID } from "node:crypto";
import type { LeadbayClient } from "../client.js";
import type {
  Tool,
  ToolContext,
  RequestMeta,
  FileImportPayloadV15,
  ImportRecordPayload,
  PaginatedResponse,
  MappingsPayload,
  CrmFieldMappingValue,
  CustomFieldDef,
} from "../types.js";

interface DomainInput {
  domain: string;
  name?: string;
}

// Caller-supplied custom-field shorthand: { CsvColumn: <id-or-name> }. The
// composite resolves the ergonomic value (numeric id OR field name) to the
// wire-format "CUSTOM.<id>" via /crm/custom_fields. Mutually exclusive with
// the same column also appearing in `mappings.fields`.
type CustomFieldShorthandValue = number | string;

interface RecordsMappings {
  // Standard mapping: column → StandardCrmFieldType OR the literal "CUSTOM.<id>"
  // wire-format value. Both shapes are accepted; the composite normalizes.
  fields: Record<string, CrmFieldMappingValue>;
  // Optional ergonomic shorthand for custom fields. Pass either the numeric id
  // (8) or the field's display name ("priority_test"). Resolved against the
  // org's /crm/custom_fields catalog before the import is committed. Useful
  // when the agent doesn't want to think about the "CUSTOM.<id>" wire format.
  custom_fields?: Record<string, CustomFieldShorthandValue>;
  statuses?: Record<string, string>;
  default_status?: string | null;
}

interface ImportLeadsParams {
  // Mode A (default): domain-list shortcut.
  domains?: DomainInput[];
  // Mode B: arbitrary CSV records + caller-supplied field mapping. Useful when
  // the caller has CRM-shaped rows ({Company, Site, Industry, ...}) and wants
  // to drive the same wizard the UI exposes — pick which CSV column maps to
  // which Leadbay CRM field.
  records?: Array<Record<string, unknown>>;
  mappings?: RecordsMappings;
  dry_run?: boolean;
  per_phase_budget_ms?: number;
  total_budget_ms?: number;
  wait_for_completion?: boolean;
}

type NotImportedReason =
  | "malformed"
  | "no_match"
  | "uncrawled"
  | "ambiguous"
  | "internal_error"
  | "dry_run";

// Domains-mode output shape (unchanged for backward compat with 0.1.x).
interface DomainsLeadEntry {
  domain: string;
  leadId: string;
  name: string | null;
}
interface DomainsNotImportedEntry {
  domain: string;
  reason: NotImportedReason;
}

// Records-mode output shape (new in 0.2.0). `rowId` always populated; `domain`
// only when LEAD_WEBSITE was mapped AND the cell parsed to a domain.
interface RecordsLeadEntry {
  rowId: string;
  domain?: string;
  leadId: string;
  name: string | null;
}
interface RecordsNotImportedEntry {
  rowId: string;
  domain?: string;
  reason: NotImportedReason;
}

export interface ImportLeadsResult {
  leads: Array<DomainsLeadEntry | RecordsLeadEntry>;
  not_imported: Array<DomainsNotImportedEntry | RecordsNotImportedEntry>;
  importIds: string[];
  region: "us" | "fr" | "custom";
  cancelled?: boolean;
  dry_run?: boolean;
  _meta: RequestMeta;
}

export interface ImportLeadsRunningResult {
  status: "running";
  handle_id: string;
  importIds: string[];
  progress: { phase: string; records_processed: number; records_total: number };
  region: "us" | "fr" | "custom";
  reused?: boolean;
  seconds_since_original?: number;
  _meta: RequestMeta;
}

export type ImportLeadsToolResult = ImportLeadsResult | ImportLeadsRunningResult;

export function isImportLeadsRunningResult(
  result: ImportLeadsToolResult
): result is ImportLeadsRunningResult {
  return "status" in result && result.status === "running";
}

const CHUNK_SIZE = 100;
const POLL_INTERVAL_MS = 2_000;
const DEFAULT_PER_PHASE_BUDGET_MS = 60_000;
const DEFAULT_TOTAL_BUDGET_MS = 300_000;
const STABILIZATION_POLLS = 2;
const MAX_COLUMN_NAME_LEN = 128;
const RESERVED_COLUMN_RE = /^mcp_row_id$/i;
// Backend wire format (CrmFieldType.kt:99) — the serializer expects literally
// "CUSTOM." followed by the bigint id of a row in the org's custom-fields
// table. Anything else under the same prefix would 400 server-side.
const CUSTOM_FIELD_RE = /^CUSTOM\.(\d+)$/;

export function isCustomFieldMappingValue(v: string): v is `CUSTOM.${number}` {
  return CUSTOM_FIELD_RE.test(v);
}

export function customFieldIdOf(v: string): string | null {
  const m = CUSTOM_FIELD_RE.exec(v);
  return m ? m[1] : null;
}

// Public mailbox / generic domains. We do NOT denylist these (per user
// decision in /autoplan CEO phase). The list lives here so the reconciler
// can label `no_match` records that are mailbox-y as `no_match`, while
// genuinely unknown company domains get `uncrawled`. This is a *labeling*
// distinction, not a *gating* one — the wizard sees every domain.
const PUBLIC_MAILBOX_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "tutanota.com",
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "mail.com",
  "yandex.com",
  "yandex.ru",
  "qq.com",
  "163.com",
  "126.com",
]);

// Strip protocol/path/trailing slash; lowercase. Returns null for clearly
// malformed input. The TLD shape check is intentionally loose — Leadbay
// supports unusual TLDs (.io, .ai, .gov.uk, etc.) so we only require: at
// least one dot, at least 2 chars on each side of the rightmost dot, no
// whitespace, no scheme leftovers.
export function normalizeDomain(input: string): string | null {
  if (!input || typeof input !== "string") return null;
  let v = input.trim().toLowerCase();
  if (!v) return null;
  v = v.replace(/^https?:\/\//, "");
  v = v.replace(/^www\./, "");
  v = v.split("/")[0].split("?")[0].split("#")[0];
  v = v.replace(/\.+$/, "");
  if (!v) return null;
  if (/\s/.test(v)) return null;
  if (!v.includes(".")) return null;
  if (v.startsWith(".") || v.endsWith(".")) return null;
  const parts = v.split(".");
  if (parts.length < 2) return null;
  if (parts.some((p) => p.length === 0)) return null;
  const tld = parts[parts.length - 1];
  if (!/^[a-z]{2,}$/.test(tld) && !tld.startsWith("xn--")) return null;
  if (!/^[a-z0-9-]+$/.test(parts[parts.length - 2])) return null;
  return v;
}

// CSV cell escaping: RFC 4180 + formula-injection guard.
// Spreadsheet apps trim/strip leading whitespace before parsing the first
// character, so " =HYPERLINK(...)" or "\n=..." is just as exploitable as
// "=HYPERLINK(...)". Strip leading whitespace before the first-char check,
// then prefix a single-quote if the first non-whitespace char triggers.
// Wrap in "..." if the cell contains , or " or \n or \r and double any
// inner quotes.
export function escapeCsvCell(raw: string): string {
  if (raw == null) return "";
  let s = String(raw);
  const trimmed = s.replace(/^[\s\r\n\t]+/, "");
  if (trimmed.length > 0) {
    const first = trimmed[0];
    if (first === "=" || first === "+" || first === "-" || first === "@") {
      s = "'" + s;
    }
  }
  if (/[",\n\r]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Build a CSV from a header array + array of row maps. Both header and cell
// values are escaped via `escapeCsvCell` (formula-injection guard + RFC 4180).
// Missing cells default to "". Caller is responsible for putting MCP_ROW_ID at
// header[0] and ensuring each row's MCP_ROW_ID slot is populated.
export function synthesizeCsv(
  header: string[],
  rows: Array<Record<string, string>>
): string {
  const headerLine = header.map(escapeCsvCell).join(",");
  const dataLines = rows.map((r) =>
    header.map((col) => escapeCsvCell(r[col] ?? "")).join(",")
  );
  return [headerLine, ...dataLines].join("\n") + "\n";
}

function chunkAt100<T>(items: T[]): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    chunks.push(items.slice(i, i + CHUNK_SIZE));
  }
  return chunks;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

function importFingerprint(params: ImportLeadsParams, prep: PreparedImport): string {
  const payload = {
    mode: prep.mode,
    rows: prep.validInputs.map((i) => ({
      domain: i.domain,
      outputDomain: i.outputDomain,
      row: i.row,
    })),
    malformed: prep.malformedDomains,
    header: prep.header,
    mappings: prep.mappings,
    dry_run: Boolean(params.dry_run),
  };
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw Object.assign(new Error("aborted"), { name: "AbortError" });
  }
}

async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await new Promise<void>((r) => setTimeout(r, ms));
    return;
  }
  if (signal.aborted) {
    checkAborted(signal);
  }
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      signal.removeEventListener("abort", onAbort);
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// Pull a column value by name (case-insensitive) from a record's records[]
// array. Live wire format (probed 2026-04-28): each entry is
// { column_name, value, field? }. Some test mocks use the older
// { cells: { ColumnName: value } } shape; tolerate both.
function readCell(record: ImportRecordPayload, key: string): string | null {
  const want = key.toLowerCase();
  const arr: any = (record as any).records;
  if (Array.isArray(arr)) {
    for (const c of arr) {
      const k = (c?.column_name ?? c?.key ?? c?.field ?? "").toString().toLowerCase();
      if (k === want) {
        const v = c?.value ?? null;
        return v != null ? String(v) : null;
      }
    }
  }
  const cells = (record as any).cells;
  if (cells && typeof cells === "object" && !Array.isArray(cells)) {
    for (const [k, v] of Object.entries(cells)) {
      if (k.toLowerCase() === want) {
        return v != null ? String(v) : null;
      }
    }
  }
  if (Array.isArray(cells)) {
    for (const c of cells) {
      const k = (c?.key ?? c?.field ?? c?.column_name ?? "").toString().toLowerCase();
      if (k === want) {
        const v = c?.value ?? null;
        return v != null ? String(v) : null;
      }
    }
  }
  return null;
}

// ─── input prep ────────────────────────────────────────────────────────────

type Mode = "domains" | "records";

interface ValidInput {
  index: number;
  rowId: string;
  // The CSV row's data, keyed by user-visible column name. Includes MCP_ROW_ID.
  row: Record<string, string>;
  // Domain extracted from row (LEAD_WEBSITE column, normalized) — null in
  // records mode if no LEAD_WEBSITE column or unparseable. Used for domain
  // fallback reconciliation in domains mode.
  domain: string | null;
  // Original input.domain (domains mode) — used for output's `domain` field.
  // Records mode: derived from LEAD_WEBSITE if mapped+parseable, else undefined.
  outputDomain: string | undefined;
}

interface PreparedImport {
  mode: Mode;
  validInputs: ValidInput[];
  malformedDomains: string[]; // domains mode only
  byDomain: Map<string, number>; // domains mode only (rowId fallback)
  byRowId: Map<string, number>;
  // CSV column order. header[0] === "MCP_ROW_ID". Shared across all chunks.
  header: string[];
  // What we POST to /update_mappings.
  mappings: MappingsPayload;
}

function validateColumnName(client: LeadbayClient, name: string, path: string): void {
  if (typeof name !== "string" || name.length === 0) {
    throw client.makeError(
      "IMPORT_INVALID_COLUMN_NAME",
      `Column name at ${path} must be a non-empty string`,
      `Use a plain string column name (1-${MAX_COLUMN_NAME_LEN} chars).`,
      "POST /imports"
    );
  }
  if (name.length > MAX_COLUMN_NAME_LEN) {
    throw client.makeError(
      "IMPORT_INVALID_COLUMN_NAME",
      `Column name at ${path} exceeds ${MAX_COLUMN_NAME_LEN} chars`,
      `Shorten the column name to ${MAX_COLUMN_NAME_LEN} chars or fewer.`,
      "POST /imports"
    );
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(name)) {
    throw client.makeError(
      "IMPORT_INVALID_COLUMN_NAME",
      `Column name at ${path} contains control characters`,
      `Strip control characters (e.g. \\n, \\t, \\x00) from column names.`,
      "POST /imports"
    );
  }
}

// Coerce a user-supplied cell value to a CSV string. null/undefined → "";
// number/boolean → String(v). Arrays/objects/functions reject with
// IMPORT_INVALID_CELL_TYPE — caller should stringify before passing.
function coerceCell(client: LeadbayClient, v: unknown, path: string): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  throw client.makeError(
    "IMPORT_INVALID_CELL_TYPE",
    `Cell at ${path} is ${Array.isArray(v) ? "an array" : typeof v}, expected string|number|boolean|null`,
    `Convert the value to a string before passing.`,
    "POST /imports"
  );
}

// Domains-mode prep: each domain becomes a {LEAD_NAME, LEAD_WEBSITE} row.
// Mappings are the legacy hardcoded pair. Output stays domain-shaped.
function prepareDomainsMode(client: LeadbayClient, inputs: DomainInput[]): PreparedImport {
  const validInputs: ValidInput[] = [];
  const malformedDomains: string[] = [];
  const byDomain = new Map<string, number>();
  const byRowId = new Map<string, number>();

  for (const inp of inputs) {
    const norm = normalizeDomain(inp?.domain ?? "");
    if (!norm) {
      malformedDomains.push(inp?.domain ?? "");
      continue;
    }
    if (byDomain.has(norm)) continue; // dedupe
    const rowId = randomUUID();
    const idx = validInputs.length;
    const name = inp.name?.trim() || norm;
    validInputs.push({
      index: idx,
      rowId,
      row: { MCP_ROW_ID: rowId, LEAD_NAME: name, LEAD_WEBSITE: norm },
      domain: norm,
      outputDomain: norm,
    });
    byDomain.set(norm, idx);
    byRowId.set(rowId, idx);
  }

  return {
    mode: "domains",
    validInputs,
    malformedDomains,
    byDomain,
    byRowId,
    header: ["MCP_ROW_ID", "LEAD_NAME", "LEAD_WEBSITE"],
    mappings: {
      fields: { LEAD_NAME: "LEAD_NAME", LEAD_WEBSITE: "LEAD_WEBSITE" },
      statuses: {},
      default_status: null,
    },
  };
}

// Records-mode prep: validate inputs, coerce cells, compute header from union
// of all keys, build mappings payload from caller's spec. Custom fields
// (`mappings.custom_fields` ergonomic shorthand or "CUSTOM.<id>" raw values)
// are resolved against `customFieldCatalog` if provided — caller's
// responsibility to fetch GET /crm/custom_fields beforehand.
function prepareRecordsMode(
  client: LeadbayClient,
  records: Array<Record<string, unknown>>,
  mappings: RecordsMappings | undefined,
  customFieldCatalog: CustomFieldDef[] | null
): PreparedImport {
  if (!mappings || !mappings.fields || typeof mappings.fields !== "object") {
    throw client.makeError(
      "IMPORT_MAPPING_REQUIRED",
      "records[] requires a mappings.fields object",
      "Pass `mappings: { fields: { CsvColumn: 'LEAD_NAME', ... } }`.",
      "POST /imports"
    );
  }

  // Resolve `mappings.custom_fields` shorthand into the wire format and merge
  // into a single normalized map. Conflicts (same column appearing in both)
  // are caller errors — fail loudly.
  const normalizedFields = normalizeFieldsAndCustomShorthand(
    client,
    mappings.fields,
    mappings.custom_fields,
    customFieldCatalog
  );

  const fieldEntries = Object.entries(normalizedFields);
  if (fieldEntries.length === 0) {
    throw client.makeError(
      "IMPORT_MAPPING_REQUIRED",
      "mappings.fields must contain at least one column → CRM field entry",
      "Map at least one CSV column to LEAD_NAME or LEAD_WEBSITE.",
      "POST /imports"
    );
  }

  // Resolver requires LEAD_NAME or LEAD_WEBSITE for the wizard to find leads.
  const targets = new Set(fieldEntries.map(([, v]) => v));
  if (!targets.has("LEAD_NAME") && !targets.has("LEAD_WEBSITE")) {
    throw client.makeError(
      "IMPORT_MAPPING_NO_RESOLVER",
      "mappings.fields must include LEAD_NAME or LEAD_WEBSITE",
      "The wizard needs at least one of those fields to match a lead. Map a CSV column to one of them.",
      "POST /imports"
    );
  }

  // E7: same StandardCrmFieldType target mapped from >1 column. The wizard
  // accepts this silently (last-write-wins on its column scan), which leads
  // to imports that look successful but lose data from the masked column.
  // Reject loudly with the conflicting column names. Custom fields
  // (CUSTOM.<id>) are excluded from this check — multiple columns into the
  // same custom field is an explicit user choice (e.g., concatenate).
  const targetCounts = new Map<string, string[]>();
  for (const [col, target] of fieldEntries) {
    if (typeof target !== "string") continue;
    if (target.startsWith("CUSTOM.")) continue;
    const cols = targetCounts.get(target) ?? [];
    cols.push(col);
    targetCounts.set(target, cols);
  }
  for (const [target, cols] of targetCounts) {
    if (cols.length > 1) {
      throw client.makeError(
        "IMPORT_MAPPING_CONFLICT_TARGET",
        `Multiple columns map to the same target ${target}: ${cols.map((c) => JSON.stringify(c)).join(", ")}`,
        `Each StandardCrmFieldType can be the destination of only one column (the wizard would silently keep one and drop the others). Pick the column you want and remove the duplicates.`,
        "POST /imports"
      );
    }
  }

  // Validate mapping keys (column-name shape + reserved-name + control chars).
  for (const [colName] of fieldEntries) {
    validateColumnName(client, colName, `mappings.fields[${JSON.stringify(colName)}]`);
    if (RESERVED_COLUMN_RE.test(colName)) {
      throw client.makeError(
        "IMPORT_RESERVED_COLUMN",
        `mappings.fields key '${colName}' collides with reserved synthetic column MCP_ROW_ID`,
        `Rename the column. MCP_ROW_ID (any case) is reserved for tool-internal reconciliation.`,
        "POST /imports"
      );
    }
  }

  // Validate records shape, coerce cells, compute key union.
  const headerSet = new Set<string>();
  const coercedRecords: Array<Record<string, string>> = [];
  records.forEach((rec, i) => {
    if (rec == null || typeof rec !== "object" || Array.isArray(rec)) {
      throw client.makeError(
        "IMPORT_INVALID_CELL_TYPE",
        `records[${i}] must be a plain object`,
        `Pass each record as { ColumnName: value, ... }.`,
        "POST /imports"
      );
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(rec)) {
      validateColumnName(client, k, `records[${i}] key`);
      if (RESERVED_COLUMN_RE.test(k)) {
        throw client.makeError(
          "IMPORT_RESERVED_COLUMN",
          `records[${i}] key '${k}' collides with reserved synthetic column MCP_ROW_ID`,
          `Rename the column in your records (any case variant of MCP_ROW_ID is reserved).`,
          "POST /imports"
        );
      }
      out[k] = coerceCell(client, v, `records[${i}].${k}`);
      headerSet.add(k);
    }
    coercedRecords.push(out);
  });

  // Every mapping key must exist in the union of record keys (else the wizard
  // silently ignores it — surface it instead).
  for (const [colName] of fieldEntries) {
    if (!headerSet.has(colName)) {
      throw client.makeError(
        "IMPORT_MAPPING_KEY_UNKNOWN",
        `mappings.fields key '${colName}' is not present in any record`,
        `Add a value for '${colName}' to at least one record, or remove it from mappings.`,
        "POST /imports"
      );
    }
  }

  const userKeys = [...headerSet].sort();
  const header = ["MCP_ROW_ID", ...userKeys];

  // Find the column (if any) that the caller mapped to LEAD_WEBSITE — used
  // when populating the optional `domain` field on records-mode output.
  const websiteCol = fieldEntries.find(([, v]) => v === "LEAD_WEBSITE")?.[0];

  const validInputs: ValidInput[] = [];
  const byDomain = new Map<string, number>();
  const byRowId = new Map<string, number>();

  coercedRecords.forEach((row) => {
    const rowId = randomUUID();
    const idx = validInputs.length;
    let normDomain: string | null = null;
    if (websiteCol) {
      normDomain = normalizeDomain(row[websiteCol] ?? "");
    }
    const fullRow = { MCP_ROW_ID: rowId, ...row };
    validInputs.push({
      index: idx,
      rowId,
      row: fullRow,
      domain: normDomain,
      outputDomain: normDomain ?? undefined,
    });
    byRowId.set(rowId, idx);
    if (normDomain && !byDomain.has(normDomain)) byDomain.set(normDomain, idx);
  });

  return {
    mode: "records",
    validInputs,
    malformedDomains: [],
    byDomain,
    byRowId,
    header,
    mappings: {
      fields: { ...normalizedFields },
      statuses: mappings.statuses ?? {},
      default_status: mappings.default_status ?? null,
    },
  };
}

// Merge `mappings.fields` (raw — may contain "CUSTOM.<id>" wire form) with
// `mappings.custom_fields` shorthand (id or name → resolved against catalog),
// and validate every CUSTOM.<id> reference exists. Returns the wire-form-only
// map ready to send to /imports/{id}/update_mappings.
//
// Errors raised:
// - IMPORT_INVALID_CUSTOM_MAPPING — value matches CUSTOM.<not-digits>
// - IMPORT_CUSTOM_FIELD_UNKNOWN — id refers to a field not on this org
// - IMPORT_CUSTOM_FIELD_NAME_AMBIGUOUS — name matches >1 custom field
// - IMPORT_MAPPING_DUPLICATE_CUSTOM — column appears in both fields[] and custom_fields[]
function normalizeFieldsAndCustomShorthand(
  client: LeadbayClient,
  fields: Record<string, CrmFieldMappingValue>,
  customShorthand: Record<string, CustomFieldShorthandValue> | undefined,
  catalog: CustomFieldDef[] | null
): Record<string, CrmFieldMappingValue> {
  const out: Record<string, CrmFieldMappingValue> = {};
  const seenColumns = new Set<string>();

  // Pass 1: caller's raw `fields` map. Validate any CUSTOM.<id> well-formed,
  // and (if catalog supplied) confirm id exists.
  for (const [col, raw] of Object.entries(fields)) {
    if (typeof raw !== "string") {
      throw client.makeError(
        "IMPORT_INVALID_CUSTOM_MAPPING",
        `mappings.fields[${JSON.stringify(col)}] must be a string (got ${typeof raw})`,
        "Pass a StandardCrmFieldType name (e.g. 'LEAD_NAME') or 'CUSTOM.<id>'.",
        "POST /imports"
      );
    }
    if (raw.startsWith("CUSTOM.")) {
      if (!isCustomFieldMappingValue(raw)) {
        throw client.makeError(
          "IMPORT_INVALID_CUSTOM_MAPPING",
          `mappings.fields[${JSON.stringify(col)}] = ${JSON.stringify(raw)} is not a well-formed custom mapping`,
          "Custom field mappings must look like 'CUSTOM.<digits>'. Call leadbay_list_mappable_fields to see valid ids.",
          "POST /imports"
        );
      }
      if (catalog !== null) {
        const id = customFieldIdOf(raw)!;
        const found = catalog.find((c) => c.id === id);
        if (!found) {
          throw client.makeError(
            "IMPORT_CUSTOM_FIELD_UNKNOWN",
            `mappings.fields[${JSON.stringify(col)}] = ${JSON.stringify(raw)} references custom field id ${id}, not present on this org`,
            `Org has ${catalog.length} custom field(s): ${
              catalog.length === 0
                ? "none — create one in the Leadbay web UI first"
                : catalog.map((c) => `${c.id}=${c.name} (${c.type})`).join(", ")
            }`,
            "POST /imports"
          );
        }
      }
    }
    out[col] = raw;
    seenColumns.add(col);
  }

  // Pass 2: ergonomic shorthand. Resolve to wire form. Catalog is required
  // here — without it we can't resolve names; reject early.
  if (customShorthand && Object.keys(customShorthand).length > 0) {
    if (catalog === null) {
      throw client.makeError(
        "IMPORT_CUSTOM_FIELD_CATALOG_REQUIRED",
        "mappings.custom_fields shorthand requires the org's custom-field catalog",
        "This is an internal error — the composite should have fetched /crm/custom_fields. Retry, or use raw 'CUSTOM.<id>' in mappings.fields.",
        "POST /imports"
      );
    }
    for (const [col, val] of Object.entries(customShorthand)) {
      if (seenColumns.has(col)) {
        throw client.makeError(
          "IMPORT_MAPPING_DUPLICATE_CUSTOM",
          `Column ${JSON.stringify(col)} is in BOTH mappings.fields and mappings.custom_fields`,
          "Each column maps to exactly one field. Drop the duplicate from one of the two maps.",
          "POST /imports"
        );
      }
      let resolved: CustomFieldDef | undefined;
      // Accept either a numeric id, a string-shaped numeric id ("8"), or a
      // field display name. The string-as-id branch is the more permissive
      // interpretation when both forms could plausibly match — backend ids
      // round-trip as strings (LongAsStringSerializer) so callers naturally
      // hand them back as strings.
      const numericVal =
        typeof val === "number"
          ? val
          : typeof val === "string" && /^\d+$/.test(val)
          ? Number(val)
          : null;
      if (numericVal !== null) {
        const idStr = String(numericVal);
        resolved = catalog.find((c) => c.id === idStr);
        if (!resolved) {
          throw client.makeError(
            "IMPORT_CUSTOM_FIELD_UNKNOWN",
            `mappings.custom_fields[${JSON.stringify(col)}] = ${val} is not a custom field on this org`,
            `Org has ${catalog.length} custom field(s): ${
              catalog.length === 0
                ? "none — create one in the Leadbay web UI first"
                : catalog.map((c) => `${c.id}=${c.name} (${c.type})`).join(", ")
            }`,
            "POST /imports"
          );
        }
      } else if (typeof val === "string") {
        const matches = catalog.filter((c) => c.name === val);
        if (matches.length === 0) {
          // Fallback to case-insensitive — humans don't always casing-match.
          const ci = catalog.filter(
            (c) => c.name.toLowerCase() === val.toLowerCase()
          );
          if (ci.length === 0) {
            throw client.makeError(
              "IMPORT_CUSTOM_FIELD_UNKNOWN",
              `mappings.custom_fields[${JSON.stringify(col)}] = ${JSON.stringify(val)} doesn't match any custom field name`,
              `Org has ${catalog.length} custom field(s): ${
                catalog.length === 0
                  ? "none — create one in the Leadbay web UI first"
                  : catalog.map((c) => `${c.id}=${c.name} (${c.type})`).join(", ")
              }`,
              "POST /imports"
            );
          }
          if (ci.length > 1) {
            throw client.makeError(
              "IMPORT_CUSTOM_FIELD_NAME_AMBIGUOUS",
              `mappings.custom_fields[${JSON.stringify(col)}] = ${JSON.stringify(val)} matches ${ci.length} custom fields case-insensitively`,
              `Pass the numeric id instead. Candidates: ${ci.map((c) => `${c.id}=${c.name}`).join(", ")}`,
              "POST /imports"
            );
          }
          resolved = ci[0];
        } else if (matches.length > 1) {
          throw client.makeError(
            "IMPORT_CUSTOM_FIELD_NAME_AMBIGUOUS",
            `mappings.custom_fields[${JSON.stringify(col)}] = ${JSON.stringify(val)} matches ${matches.length} custom fields exactly`,
            `Pass the numeric id instead. Candidates: ${matches.map((c) => `${c.id}=${c.name}`).join(", ")}`,
            "POST /imports"
          );
        } else {
          resolved = matches[0];
        }
      } else {
        throw client.makeError(
          "IMPORT_INVALID_CUSTOM_MAPPING",
          `mappings.custom_fields[${JSON.stringify(col)}] must be a number (id) or string (name); got ${typeof val}`,
          "Pass either the numeric id (e.g. 8) or the field name (e.g. 'priority').",
          "POST /imports"
        );
      }
      out[col] = `CUSTOM.${resolved.id}`;
      seenColumns.add(col);
    }
  }

  return out;
}

interface ChunkRunOutput {
  importId: string;
  records: ImportRecordPayload[];
}

interface UploadedChunk {
  importId: string;
  chunk: ValidInput[];
  chunkIdx: number;
  totalChunks: number;
}

async function pollUntil<T>(
  fn: () => Promise<T>,
  done: (r: T) => boolean,
  budgetMs: number,
  signal: AbortSignal | undefined,
  ctx: ToolContext | undefined,
  label: string
): Promise<T> {
  const deadline = Date.now() + budgetMs;
  let last: T;
  while (true) {
    checkAborted(signal);
    last = await fn();
    if (done(last)) return last;
    if (Date.now() >= deadline) {
      ctx?.logger?.warn?.(`import-leads: ${label} budget exhausted (${budgetMs}ms)`);
      return last;
    }
    await sleepWithAbort(POLL_INTERVAL_MS, signal);
  }
}

async function pollPreprocess(
  client: LeadbayClient,
  importId: string,
  budgetMs: number,
  ctx: ToolContext | undefined,
  signal: AbortSignal | undefined
): Promise<FileImportPayloadV15> {
  const result = await pollUntil<FileImportPayloadV15>(
    () => client.request<FileImportPayloadV15>("GET", `/imports/${importId}`),
    (r) => Boolean(r.pre_processing?.finished),
    budgetMs,
    signal,
    ctx,
    "preprocess"
  );
  if (!result.pre_processing?.finished) {
    throw client.makeError(
      "IMPORT_BUDGET_EXHAUSTED",
      `Preprocess phase did not finish within ${budgetMs}ms`,
      `Increase per_phase_budget_ms (current: ${budgetMs}) or split the batch. importId=${importId}.`,
      `GET /imports/${importId}`
    );
  }
  if (result.pre_processing.error) {
    throw client.makeError(
      "IMPORT_PREPROCESS_FAILED",
      `Preprocess failed: ${result.pre_processing.error}`,
      `Check the input domains. importId=${importId} for backend debugging.`,
      `GET /imports/${importId}`
    );
  }
  return result;
}

async function pollProcess(
  client: LeadbayClient,
  importId: string,
  budgetMs: number,
  ctx: ToolContext | undefined,
  signal: AbortSignal | undefined
): Promise<FileImportPayloadV15> {
  const result = await pollUntil<FileImportPayloadV15>(
    () => client.request<FileImportPayloadV15>("GET", `/imports/${importId}`),
    (r) => Boolean(r.processing?.finished),
    budgetMs,
    signal,
    ctx,
    "process"
  );
  if (!result.processing?.finished) {
    throw client.makeError(
      "IMPORT_BUDGET_EXHAUSTED",
      `Process phase did not finish within ${budgetMs}ms`,
      `Increase per_phase_budget_ms (current: ${budgetMs}) or split the batch. importId=${importId}.`,
      `GET /imports/${importId}`
    );
  }
  if (result.processing.error != null) {
    throw client.makeError(
      "IMPORT_PROCESSING_FAILED",
      `Backend processing failed: ${result.processing.error}`,
      `importId=${importId}.`,
      `GET /imports/${importId}`
    );
  }
  return result;
}

async function pollRecordsToTerminal(
  client: LeadbayClient,
  importId: string,
  budgetMs: number,
  expectedRowCount: number,
  ctx: ToolContext | undefined,
  signal: AbortSignal | undefined
): Promise<ImportRecordPayload[]> {
  const deadline = Date.now() + budgetMs;
  const maxPagesPerPoll = Math.max(2, Math.ceil(expectedRowCount / 100) * 2 + 4);
  let stableCounts = 0;
  let lastSnapshot: { total: number; transient: number } | null = null;

  while (true) {
    checkAborted(signal);
    let total = 0;
    let transient = 0;
    let pagesFetched = 0;
    let exhaustedPagination = false;
    const records: ImportRecordPayload[] = [];

    for (let page = 0; page < maxPagesPerPoll; page++) {
      checkAborted(signal);
      const qs =
        `count=100&page=${page}` +
        `&automatic_match=true&manual_match=true&no_match=true` +
        `&matching=true&importing=true&imported=true`;
      const res = await client.request<PaginatedResponse<ImportRecordPayload>>(
        "GET",
        `/imports/${importId}/records?${qs}`
      );
      pagesFetched++;
      records.push(...res.items);
      total = res.pagination.total ?? records.length;
      for (const r of res.items) {
        const status = (r.status ?? "").toString().toUpperCase();
        const matchType =
          ((r as any).match_type ?? (r as any).matchType ?? "").toString().toUpperCase();
        const isTerminal = matchType === "NO_MATCH" || status === "IMPORTED";
        if (!isTerminal) transient++;
      }
      const totalPages = res.pagination.pages ?? 0;
      if (page + 1 >= totalPages) {
        exhaustedPagination = true;
        break;
      }
    }
    if (!exhaustedPagination) {
      throw client.makeError(
        "IMPORT_PAGINATION_RUNAWAY",
        `Records pagination exceeded ${maxPagesPerPoll} pages`,
        `importId=${importId}. Please file a bug at https://github.com/leadbay/leadclaw/issues.`,
        `GET /imports/${importId}/records`
      );
    }

    const snapshot = { total, transient };
    const settled = transient === 0;
    const stableVsLast =
      lastSnapshot != null &&
      lastSnapshot.total === snapshot.total &&
      lastSnapshot.transient === snapshot.transient;
    if (settled && stableVsLast) {
      stableCounts++;
    } else if (settled) {
      stableCounts = 1;
    } else {
      stableCounts = 0;
    }
    lastSnapshot = snapshot;

    if (settled && stableCounts >= STABILIZATION_POLLS) {
      return records;
    }
    if (Date.now() >= deadline) {
      ctx?.logger?.warn?.(
        `import-leads: records did not stabilize (transient=${transient}, total=${total}); returning best-effort`
      );
      throw client.makeError(
        "IMPORT_NOT_TERMINAL",
        `Backend hasn't fully settled records within ${budgetMs}ms`,
        `Retry leadbay_import_leads with the same input in 30s, or split the batch. importId=${importId}.`,
        `GET /imports/${importId}/records`
      );
    }
    await sleepWithAbort(POLL_INTERVAL_MS, signal);
  }
}

async function runOneChunk(
  client: LeadbayClient,
  chunk: ValidInput[],
  chunkIdx: number,
  totalChunks: number,
  header: string[],
  mappings: MappingsPayload,
  dryRun: boolean,
  perPhaseBudgetMs: number,
  totalDeadline: number,
  ctx: ToolContext | undefined,
  signal: AbortSignal | undefined,
  // Called the moment POST /imports succeeds, so the caller can record the
  // importId before any polling happens. If polling later throws (abort,
  // budget, etc.) the caller still has the importId for diagnostics + retry.
  onImportId: (id: string) => void
): Promise<ChunkRunOutput> {
  const upload = await uploadOneChunk(
    client,
    chunk,
    chunkIdx,
    totalChunks,
    header,
    ctx,
    onImportId
  );
  return completeUploadedChunk(
    client,
    upload,
    mappings,
    dryRun,
    perPhaseBudgetMs,
    totalDeadline,
    ctx,
    signal
  );
}

async function uploadOneChunk(
  client: LeadbayClient,
  chunk: ValidInput[],
  chunkIdx: number,
  totalChunks: number,
  header: string[],
  ctx: ToolContext | undefined,
  onImportId: (id: string) => void
): Promise<UploadedChunk> {
  const csv = synthesizeCsv(
    header,
    chunk.map((c) => c.row)
  );
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `mcp-import-${ts}-${chunkIdx}.csv`;
  ctx?.logger?.info?.(
    `import-leads: uploading chunk ${chunkIdx + 1}/${totalChunks} (${chunk.length} rows, ${csv.length}B)`
  );

  const upload = await client.requestRawBinary<FileImportPayloadV15>(
    "POST",
    `/imports?file_name=${encodeURIComponent(fileName)}`,
    "text/csv",
    csv
  );
  const importId = upload.id;
  onImportId(importId);
  return { importId, chunk, chunkIdx, totalChunks };
}

async function completeUploadedChunk(
  client: LeadbayClient,
  upload: UploadedChunk,
  mappings: MappingsPayload,
  dryRun: boolean,
  perPhaseBudgetMs: number,
  totalDeadline: number,
  ctx: ToolContext | undefined,
  signal: AbortSignal | undefined
): Promise<ChunkRunOutput> {
  const { importId, chunk } = upload;
  const phaseBudget = Math.min(perPhaseBudgetMs, Math.max(1, totalDeadline - Date.now()));

  await pollPreprocess(client, importId, phaseBudget, ctx, signal);
  ctx?.logger?.info?.(`import-leads: preprocess done for importId=${importId}`);

  if (dryRun) {
    return { importId, records: [] };
  }

  await client.requestVoid(
    "POST",
    `/imports/${importId}/update_mappings`,
    mappings
  );
  ctx?.logger?.info?.(`import-leads: mappings committed for importId=${importId}`);

  const phaseBudget2 = Math.min(perPhaseBudgetMs, Math.max(1, totalDeadline - Date.now()));
  await pollProcess(client, importId, phaseBudget2, ctx, signal);
  ctx?.logger?.info?.(`import-leads: process done for importId=${importId}`);

  const phaseBudget3 = Math.min(perPhaseBudgetMs, Math.max(1, totalDeadline - Date.now()));
  const records = await pollRecordsToTerminal(
    client,
    importId,
    phaseBudget3,
    chunk.length,
    ctx,
    signal
  );
  ctx?.logger?.info?.(
    `import-leads: ${records.length} records terminal for importId=${importId}`
  );

  return { importId, records };
}

interface MatchEntry {
  domain: string | undefined;
  leadId: string;
  name: string | null;
}
interface NotImportedEntry {
  domain: string | undefined;
  reason: NotImportedReason;
}

function reconcileOneChunk(
  prep: PreparedImport,
  chunk: ChunkRunOutput,
  matched: Map<number, MatchEntry>,
  notImported: Map<number, NotImportedEntry>
): void {
  const seenInputIndex = new Set<number>();

  // Sort so matched records (lead.id present) come first.
  const sortedRecords = [...chunk.records].sort((a, b) => {
    const aHasLead = a.lead?.id ? 0 : 1;
    const bHasLead = b.lead?.id ? 0 : 1;
    return aHasLead - bHasLead;
  });

  for (const rec of sortedRecords) {
    let inputIdx: number | undefined;
    const rowIdCell = readCell(rec, "MCP_ROW_ID");
    if (rowIdCell && prep.byRowId.has(rowIdCell)) {
      inputIdx = prep.byRowId.get(rowIdCell);
    }
    // Domain fallback only meaningful when we have a domain index (domains
    // mode, or records mode where caller mapped LEAD_WEBSITE).
    if (inputIdx === undefined) {
      const websiteCell = readCell(rec, "LEAD_WEBSITE");
      if (websiteCell) {
        const norm = normalizeDomain(websiteCell);
        if (norm && prep.byDomain.has(norm)) {
          inputIdx = prep.byDomain.get(norm);
        }
      }
    }
    if (inputIdx === undefined && rec.lead?.website) {
      const norm = normalizeDomain(rec.lead.website);
      if (norm && prep.byDomain.has(norm)) {
        inputIdx = prep.byDomain.get(norm);
      }
    }
    if (inputIdx === undefined) continue;

    if (seenInputIndex.has(inputIdx)) {
      if (!matched.has(inputIdx) && !notImported.has(inputIdx)) {
        const inp = prep.validInputs[inputIdx];
        notImported.set(inputIdx, { domain: inp.outputDomain, reason: "ambiguous" });
      }
      continue;
    }
    seenInputIndex.add(inputIdx);

    const inp = prep.validInputs[inputIdx];
    const matchType =
      ((rec as any).match_type ?? (rec as any).matchType ?? "").toString();
    if (rec.lead?.id) {
      matched.set(inputIdx, {
        domain: inp.outputDomain,
        leadId: rec.lead.id,
        name: rec.lead.name ?? null,
      });
    } else if (matchType === "NO_MATCH") {
      const reason: NotImportedReason =
        inp.domain && PUBLIC_MAILBOX_DOMAINS.has(inp.domain) ? "no_match" : "uncrawled";
      notImported.set(inputIdx, { domain: inp.outputDomain, reason });
    } else {
      notImported.set(inputIdx, { domain: inp.outputDomain, reason: "internal_error" });
    }
  }
}

function buildImportLeadsResult(
  client: LeadbayClient,
  prep: PreparedImport,
  importIds: string[],
  matched: Map<number, MatchEntry>,
  notImported: Map<number, NotImportedEntry>,
  dryRun: boolean,
  cancelled: boolean
): ImportLeadsResult {
  const leads: Array<DomainsLeadEntry | RecordsLeadEntry> = [];
  const not_imported: Array<DomainsNotImportedEntry | RecordsNotImportedEntry> = [];
  if (dryRun) {
    for (const inp of prep.validInputs) {
      if (prep.mode === "domains") {
        not_imported.push({ domain: inp.outputDomain!, reason: "dry_run" });
      } else {
        const entry: RecordsNotImportedEntry = { rowId: inp.rowId, reason: "dry_run" };
        if (inp.outputDomain) entry.domain = inp.outputDomain;
        not_imported.push(entry);
      }
    }
  } else {
    for (const inp of prep.validInputs) {
      const m = matched.get(inp.index);
      if (m) {
        if (prep.mode === "domains") {
          leads.push({
            domain: inp.outputDomain!,
            leadId: m.leadId,
            name: m.name,
          });
        } else {
          const e: RecordsLeadEntry = {
            rowId: inp.rowId,
            leadId: m.leadId,
            name: m.name,
          };
          if (m.domain ?? inp.outputDomain) e.domain = m.domain ?? inp.outputDomain;
          leads.push(e);
        }
        continue;
      }
      const ni = notImported.get(inp.index);
      if (ni) {
        if (prep.mode === "domains") {
          not_imported.push({ domain: inp.outputDomain!, reason: ni.reason });
        } else {
          const e: RecordsNotImportedEntry = { rowId: inp.rowId, reason: ni.reason };
          if (ni.domain ?? inp.outputDomain) e.domain = ni.domain ?? inp.outputDomain;
          not_imported.push(e);
        }
        continue;
      }
      if (prep.mode === "domains") {
        not_imported.push({ domain: inp.outputDomain!, reason: "internal_error" });
      } else {
        const e: RecordsNotImportedEntry = { rowId: inp.rowId, reason: "internal_error" };
        if (inp.outputDomain) e.domain = inp.outputDomain;
        not_imported.push(e);
      }
    }
  }
  // Domains-mode malformed entries (rejected before the wizard saw them).
  for (const m of prep.malformedDomains) {
    not_imported.push({ domain: m, reason: "malformed" } as DomainsNotImportedEntry);
  }

  return {
    leads,
    not_imported,
    importIds,
    region: client.region,
    cancelled: cancelled || undefined,
    dry_run: dryRun || undefined,
    _meta: client.lastMeta ?? {
      region: client.region,
      endpoint: "POST /imports",
      latency_ms: null,
      retry_after: null,
    },
  };
}

export const importLeads: Tool<ImportLeadsParams, ImportLeadsToolResult> = {
  name: "leadbay_import_leads",
  annotations: {
    title: "Import leads from list/file",
    readOnlyHint: false,
    destructiveHint: true,
    // Backend dedupes by domain/registry id; same input set ⇒ same lead set
    // (no duplicate leads are created). bulk-store also keys on the
    // input-hash → returns the same importId on retry.
    idempotentHint: true,
    openWorldHint: true,
  },
  description:
    "Import leads into Leadbay's CRM via the file-import wizard. Returns stable Leadbay leadIds for downstream chaining " +
    "into leadbay_bulk_qualify_leads / leadbay_research_lead. For MCP clients with short transport timeouts, pass " +
    "`wait_for_completion:false` to return quickly with `{status:'running', handle_id}`; poll `leadbay_import_status` " +
    "with that handle for progress and the final `{leads, not_imported, importIds}` result.\n\n" +
    "TWO MODES:\n" +
    "  A) Domain-list shortcut — pass `domains: [{domain, name?}]`. The tool builds a 2-column CSV " +
    "(LEAD_NAME, LEAD_WEBSITE) and imports with the default mapping. Output: { leads: [{domain, leadId, name}], " +
    "not_imported: [{domain, reason}], importIds, _meta }.\n" +
    "  B) Custom records + mapping — pass `records: [{Col1, Col2, ...}]` plus `mappings.fields: {Col1: 'LEAD_NAME', Col2: 'LEAD_WEBSITE', ...}`. " +
    "The tool synthesizes a CSV from the union of record keys (deterministic order) and POSTs the " +
    "caller-supplied mapping to the wizard. mappings.fields must include LEAD_NAME or LEAD_WEBSITE " +
    "(the resolver needs at least one). Output: { leads: [{rowId, domain?, leadId, name}], " +
    "not_imported: [{rowId, domain?, reason}], importIds, _meta }. `rowId` round-trips your input order.\n\n" +
    "Pass exactly one of `domains` / `records`. Reserved column MCP_ROW_ID (any case) cannot appear in " +
    "records or mappings — the tool injects it for stable reconciliation.\n\n" +
    "⚠️ MUTATES USER STATE. Each call:\n" +
    "  - creates a row in the user's CRM-imports list (visible in the web UI)\n" +
    "  - touches onboarding state (startFileless, onboarding step → PROCESSING)\n" +
    "Suitable for occasional automation. NOT suitable for high-cadence (>5 calls/day) — wait for " +
    "the backend programmatic endpoint (issue: leadbay/backend prolonged-import-with-crawl).\n\n" +
    "ℹ️ Monitor-tab membership: imported leads are NOT auto-promoted to the user's Monitor view. " +
    "Lens-scoring decides — only above-threshold leads get `in_monitor: true` server-side.\n\n" +
    "When to use: you have a list of company domains from another system (CRM, analytics, email " +
    "correspondents) and need stable Leadbay leadIds; or you have CRM-shaped rows with custom " +
    "columns (sector, location, status, etc.) and want to drive the wizard with explicit field mappings.\n" +
    "When NOT to use: for prospect discovery (use leadbay_pull_leads); for one specific company's " +
    "profile (use leadbay_research_company); when you can't tolerate the side effects above.\n\n" +
    "Custom fields: pass org-defined custom field mappings as 'CUSTOM.<id>' (raw wire format) in " +
    "`mappings.fields`, OR use the ergonomic `mappings.custom_fields` shorthand: `{ColName: 8}` " +
    "(numeric id) or `{ColName: 'priority_test'}` (field name). Discover available custom fields " +
    "via leadbay_list_mappable_fields.\n\n" +
    "Requires: LEADBAY_MCP_WRITE=1 (MCP) or exposeWrite=true (OpenClaw); admin role on the " +
    "Leadbay account; active billing.",
  write: true,
  version: "0.3.0",
  inputSchema: {
    type: "object",
    properties: {
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
          // Domain entries are a closed shape — agents passing extra keys
          // (e.g., `leadId: "..."`) would silently no-op. Reject explicitly.
          additionalProperties: false,
        },
      },
      records: {
        type: "array",
        description:
          "Mode B: arbitrary CSV-shaped rows. Each record is an object whose keys are column names and " +
          "values are scalar (string/number/boolean/null). Mutually exclusive with `domains`. Must be " +
          "accompanied by `mappings.fields`. The tool synthesizes a CSV from the union of all record keys.",
        items: { type: "object" },
      },
      mappings: {
        type: "object",
        description:
          "Mode B: how each CSV column maps to Leadbay's CRM field schema. " +
          "Required when `records` is supplied; ignored otherwise.",
        properties: {
          fields: {
            type: "object",
            description:
              "Object whose keys are CSV column names (matching keys in `records`) and whose values are " +
              "either Leadbay's StandardCrmFieldType (LEAD_NAME, LEAD_WEBSITE, LEAD_STATUS, " +
              "LEAD_LOCATION, LEAD_LOCATION_*, LEAD_SECTOR, LEAD_SIZE, CRM_ID, LEADBAY_ID, EMAIL, " +
              "DEAL_CRM_ID, CONTACT_FIRST_NAME, CONTACT_LAST_NAME, CONTACT_EMAIL, CONTACT_PHONE_NUMBER, " +
              "CONTACT_TITLE, CONTACT_LINKEDIN, LEAD_STATUS_DATE, OWNER, SCORE, SIREN) or the wire-format " +
              "string 'CUSTOM.<id>' for org-defined custom fields. At least one entry must target " +
              "LEAD_NAME or LEAD_WEBSITE — the wizard needs that to find leads. Use " +
              "leadbay_list_mappable_fields to discover the org's custom fields.",
          },
          custom_fields: {
            type: "object",
            description:
              "Ergonomic shorthand: `{CsvColumn: <number-id>}` or `{CsvColumn: '<field-name>'}` for " +
              "custom-field mappings. Resolved against the org's /crm/custom_fields catalog before the " +
              "import is committed. Mutually exclusive with `fields[col] = 'CUSTOM.<id>'` for the same " +
              "column. Useful when the agent doesn't want to deal with the 'CUSTOM.<id>' wire format.",
          },
          statuses: {
            type: "object",
            description: "Optional status string mapping (rarely needed). Defaults to {}.",
          },
          default_status: {
            type: ["string", "null"],
            description: "Optional default status. Defaults to null.",
          },
        },
        required: ["fields"],
      },
      dry_run: {
        type: "boolean",
        description:
          "If true, run preprocess only — do NOT commit lead-CRM linking. Note: an import row " +
          "still appears in the user's CRM-imports list as 'incomplete'. Use to verify input " +
          "format / wizard reachability without polluting the CRM.",
      },
      per_phase_budget_ms: {
        type: "number",
        description: `Single poll-loop cap (default ${DEFAULT_PER_PHASE_BUDGET_MS}ms).`,
      },
      total_budget_ms: {
        type: "number",
        description: `Overall cap across all phases (default ${DEFAULT_TOTAL_BUDGET_MS}ms).`,
      },
      wait_for_completion: {
        type: "boolean",
        description:
          "When false, validate and enqueue the import in the background, then return `{status:'running', handle_id}` immediately. " +
          "Poll leadbay_import_status(handle_id). Default is true for 0.6.x backwards compatibility.",
      },
    },
    // Neither field is "required" at the schema level; xor + presence is
    // enforced in execute() so we can produce specific error codes.
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      leads: {
        type: "array",
        description:
          "Imported leads. Domains mode: [{domain, leadId, name}]. Records mode: [{rowId, domain?, leadId, name}].",
        items: { type: "object" },
      },
      status: {
        type: "string",
        description: "`running` when wait_for_completion=false; absent on the legacy blocking result.",
      },
      handle_id: {
        type: "string",
        description: "Persisted UUID handle to pass to leadbay_import_status.",
      },
      progress: {
        type: "object",
        description: "Current async import progress when wait_for_completion=false.",
      },
      not_imported: {
        type: "array",
        description:
          "Inputs that did NOT yield a leadId. Each entry has a `reason` ('malformed', 'NO_MATCH', 'TIMEOUT', etc.) plus the input echo.",
        items: { type: "object" },
      },
      importIds: {
        type: "array",
        description: "Backend file-import handles (one per chunk of ≤100 rows).",
        items: { type: "string" },
      },
      region: { type: "string" },
      cancelled: {
        type: "boolean",
        description: "True when ctx.signal aborted the call mid-flight.",
      },
      dry_run: {
        type: "boolean",
        description: "True when dry_run:true was passed (preprocess only, no CRM commit).",
      },
      _meta: { type: "object" },
    },
    required: ["importIds", "region", "_meta"],
    anyOf: [
      { required: ["leads", "not_imported", "importIds", "region", "_meta"] },
      { required: ["status", "handle_id", "importIds", "progress", "region", "_meta"] },
    ],
  },
  execute: async (
    client: LeadbayClient,
    params: ImportLeadsParams,
    ctx?: ToolContext
  ): Promise<ImportLeadsToolResult> => {
    const signal = ctx?.signal;
    const dryRun = Boolean(params.dry_run);
    const perPhaseBudget = params.per_phase_budget_ms ?? DEFAULT_PER_PHASE_BUDGET_MS;
    const totalBudget = params.total_budget_ms ?? DEFAULT_TOTAL_BUDGET_MS;
    const totalDeadline = Date.now() + totalBudget;
    const waitForCompletion = params.wait_for_completion ?? true;

    const hasDomains = Array.isArray(params.domains) && params.domains.length > 0;
    const hasRecords = Array.isArray(params.records) && params.records.length > 0;

    if (hasDomains && hasRecords) {
      throw client.makeError(
        "IMPORT_INPUT_CONFLICT",
        "Pass exactly one of `domains` or `records`, not both",
        "Use `domains` for the simple shortcut, or `records`+`mappings` for arbitrary CSV input.",
        "POST /imports"
      );
    }
    if (!hasDomains && !hasRecords) {
      throw client.makeError(
        "IMPORT_EMPTY_INPUT",
        "domains[] or records[] must contain at least one entry",
        "Pass at least one entry. See the tool description for the two input modes.",
        "POST /imports"
      );
    }

    // Preflight admin check. The /imports route is admin-gated server-side
    // and would 403 ~30s into polling otherwise — bad DX. resolveMe() is
    // cached (60s TTL).
    const me = await client.resolveMe();
    if (!me.admin) {
      throw client.makeError(
        "IMPORT_ADMIN_REQUIRED",
        "This tool requires admin role on the Leadbay account",
        "Ask the account owner to grant import permission, or use a token from an admin user.",
        "POST /imports"
      );
    }

    // Preflight org custom-field catalog when records-mode mapping references
    // custom fields (raw "CUSTOM.<id>" or `mappings.custom_fields` shorthand).
    // Catches typos client-side instead of letting the wizard 400 mid-process.
    let customFieldCatalog: CustomFieldDef[] | null = null;
    if (hasRecords) {
      const m = params.mappings;
      const referencesCustom =
        (m?.custom_fields && Object.keys(m.custom_fields).length > 0) ||
        (m?.fields &&
          Object.values(m.fields).some(
            (v) => typeof v === "string" && v.startsWith("CUSTOM.")
          ));
      if (referencesCustom) {
        try {
          customFieldCatalog = await client.request<CustomFieldDef[]>(
            "GET",
            "/crm/custom_fields"
          );
        } catch (err: any) {
          // Read failure on catalog isn't fatal — but we won't catch typos
          // until the wizard chokes. Surface a clean error rather than going
          // half-blind.
          throw client.makeError(
            "IMPORT_CUSTOM_FIELD_CATALOG_UNAVAILABLE",
            `Failed to fetch /crm/custom_fields for preflight: ${err?.message ?? err?.code ?? "unknown"}`,
            "Custom field references can't be validated. Retry, or remove custom-field mappings.",
            "GET /crm/custom_fields"
          );
        }
      }
    }

    const prep: PreparedImport = hasDomains
      ? prepareDomainsMode(client, params.domains!)
      : prepareRecordsMode(client, params.records!, params.mappings, customFieldCatalog);

    if (prep.validInputs.length === 0) {
      // Domains mode with all-malformed input.
      const not_imported = prep.malformedDomains.map((d) => ({
        domain: d,
        reason: "malformed" as const,
      }));
      return {
        leads: [],
        not_imported,
        importIds: [],
        region: client.region,
        dry_run: dryRun || undefined,
        _meta: client.lastMeta ?? {
          region: client.region,
          endpoint: "POST /imports",
          latency_ms: null,
          retry_after: null,
        },
      };
    }

    const chunks = chunkAt100(prep.validInputs);

    if (!waitForCompletion) {
      if (!ctx?.bulkTracker) {
        throw client.makeError(
          "BULK_TRACKER_UNAVAILABLE",
          "No BulkTracker configured on this MCP instance",
          "leadbay_import_leads wait_for_completion=false needs a BulkTracker so the handle survives restart.",
          ""
        );
      }
      const reservation = await ctx.bulkTracker.findOrCreatePendingImport({
        import_fingerprint: importFingerprint(params, prep),
        mode: prep.mode,
        dry_run: dryRun,
        records_total: prep.validInputs.length,
      });
      const importIds = [...reservation.record.import_ids];
      const uploadedChunks: UploadedChunk[] = [];
      if (!reservation.reused || reservation.record.import_ids.length === 0) {
        try {
          for (let i = 0; i < chunks.length; i++) {
            const upload = await uploadOneChunk(
              client,
              chunks[i],
              i,
              chunks.length,
              prep.header,
              ctx,
              (id) => {
                if (!importIds.includes(id)) importIds.push(id);
              }
            );
            uploadedChunks.push(upload);
            await ctx.bulkTracker.setImportIds(reservation.record.bulk_id, importIds);
          }
          await ctx.bulkTracker.setImportProgress(reservation.record.bulk_id, {
            phase: "preprocess",
            records_processed: 0,
            records_total: prep.validInputs.length,
          });
        } catch (err: any) {
          await ctx.bulkTracker.markImportFailed(
            reservation.record.bulk_id,
            err?.message ?? err?.code ?? "unknown"
          );
          throw err;
        }
      }
      if (uploadedChunks.length > 0) {
        void runImportInBackground(
          client,
          prep,
          uploadedChunks,
          {
            dryRun,
            perPhaseBudget,
            totalBudget,
          },
          ctx,
          reservation.record.bulk_id
        );
      }
      return {
        status: "running",
        handle_id: reservation.record.bulk_id,
        importIds,
        progress: {
          phase:
            reservation.record.status === "complete"
              ? "complete"
              : importIds.length > 0
              ? "preprocess"
              : "queued",
          records_processed:
            reservation.record.status === "complete"
              ? reservation.record.records_total
              : 0,
          records_total: reservation.record.records_total,
        },
        region: client.region,
        ...(reservation.reused
          ? {
              reused: true,
              seconds_since_original: reservation.seconds_since_original,
            }
          : {}),
        _meta: client.lastMeta ?? {
          region: client.region,
          endpoint: "POST /imports",
          latency_ms: null,
          retry_after: null,
        },
      };
    }

    ctx?.logger?.info?.(
      `import-leads(${prep.mode}): ${prep.validInputs.length} rows → ${chunks.length} chunk(s); ` +
        `dry_run=${dryRun}, totalBudgetMs=${totalBudget}`
    );

    const importIds: string[] = [];
    const matched = new Map<number, MatchEntry>();
    const notImported = new Map<number, NotImportedEntry>();

    let cancelled = false;
    const recordImportId = (id: string) => {
      if (!importIds.includes(id)) importIds.push(id);
    };
    try {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const out = await runOneChunk(
          client,
          chunk,
          i,
          chunks.length,
          prep.header,
          prep.mappings,
          dryRun,
          perPhaseBudget,
          totalDeadline,
          ctx,
          signal,
          recordImportId
        );
        if (!dryRun) {
          reconcileOneChunk(prep, out, matched, notImported);
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        cancelled = true;
        ctx?.logger?.info?.(`import-leads: aborted via signal; importIds=${importIds.join(",")}`);
      } else if (err?.error === true) {
        if (err.code === "FORBIDDEN") {
          throw client.makeError(
            "IMPORT_ADMIN_REQUIRED",
            err.message || "Insufficient permissions for /imports",
            "This tool requires admin role on the Leadbay account. Ask the account owner.",
            err._meta?.endpoint
          );
        }
        if (err.code === "BILLING_SUSPENDED") {
          throw client.makeError(
            "IMPORT_BILLING_REQUIRED",
            err.message || "Active billing required for imports",
            "Upgrade at https://app.leadbay.ai/billing, then retry.",
            err._meta?.endpoint
          );
        }
        throw err;
      } else {
        throw err;
      }
    }

    return buildImportLeadsResult(
      client,
      prep,
      importIds,
      matched,
      notImported,
      dryRun,
      cancelled
    );
  },
};

async function runImportInBackground(
  client: LeadbayClient,
  prep: PreparedImport,
  uploadedChunks: UploadedChunk[],
  opts: {
    dryRun: boolean;
    perPhaseBudget: number;
    totalBudget: number;
  },
  ctx: ToolContext,
  handleId: string
): Promise<void> {
  const tracker = ctx.bulkTracker;
  if (!tracker) return;
  void tracker
    .setImportProgress(handleId, {
      phase: "preprocess",
      records_processed: 0,
      records_total: prep.validInputs.length,
    })
    .catch(() => {});
  setTimeout(() => {
    void (async () => {
      const bgCtx: ToolContext = { logger: ctx.logger, bulkTracker: tracker };
      const importIds = uploadedChunks.map((chunk) => chunk.importId);
      const matched = new Map<number, MatchEntry>();
      const notImported = new Map<number, NotImportedEntry>();
      try {
        const totalDeadline = Date.now() + opts.totalBudget;
        for (const upload of uploadedChunks) {
          const out = await completeUploadedChunk(
            client,
            upload,
            prep.mappings,
            opts.dryRun,
            opts.perPhaseBudget,
            totalDeadline,
            bgCtx,
            undefined
          );
          if (!opts.dryRun) {
            reconcileOneChunk(prep, out, matched, notImported);
          }
        }
        const result = buildImportLeadsResult(
          client,
          prep,
          importIds,
          matched,
          notImported,
          opts.dryRun,
          false
        );
        await tracker.markImportComplete(handleId, {
          leads: result.leads,
          not_imported: result.not_imported,
          importIds: result.importIds,
        });
      } catch (err: any) {
        await tracker.markImportFailed(
          handleId,
          err?.message ?? err?.code ?? "unknown"
        );
      }
    })();
  }, 0);
}
