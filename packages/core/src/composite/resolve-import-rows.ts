import type { LeadbayClient } from "../client.js";
import type {
  CrmFieldMappingValue,
  MappingsPayload,
  RequestMeta,
  ResolvePayload,
  ResolveResult,
  Tool,
} from "../types.js";

import { leadbay_resolve_import_rows as RESOLVE_IMPORT_ROWS_DESCRIPTION } from "../tool-descriptions.generated.js";
interface IdentityMappings {
  leadbay_id?: string;
  crm_id?: string;
  name?: string;
  website?: string;
  phone?: string;
  email?: string;
  registry_number?: string;
  registry_type?: string;
  address?: string;
  city?: string;
  postcode?: string;
  country?: string;
  linkedin?: string;
  facebook?: string;
  instagram?: string;
  twitter?: string;
  tiktok?: string;
}

interface ResolveImportRowsParams {
  records: Array<Record<string, unknown>>;
  identity_mappings?: IdentityMappings;
  include_candidate_profiles?: boolean;
  candidate_profile_limit?: number;
  lensId?: number;
}

interface ResolveImportRowsResult {
  rows: Array<{
    index: number;
    type: ResolveResult["type"];
    resolver_payload: ResolvePayload;
    lead_id?: string;
    matched_on?: string[];
    candidates?: Extract<ResolveResult, { type: "ambiguous" }>["candidates"];
    candidate_profiles?: CandidateProfile[];
    would_help?: Extract<ResolveResult, { type: "none" }>["would_help"];
    reason?: string;
    import_record: Record<string, string>;
  }>;
  records_for_import: Array<Record<string, string>>;
  mappings_for_import: MappingsPayload;
  identity_mappings_used: IdentityMappings;
  mapping_guidance: string[];
  disambiguation_policy: string[];
  summary: {
    total: number;
    matched: number;
    ambiguous: number;
    none: number;
    unidentifiable: number;
    ready_for_import: boolean;
  };
  next_action: string;
  region: "us" | "fr" | "custom";
  _meta: RequestMeta;
}

interface CandidateProfile {
  lead_id: string;
  name?: string | null;
  website?: string | null;
  location?: {
    full?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
  } | null;
  phone_numbers?: unknown[];
  description?: string | null;
}

const SOCIAL_FIELDS = new Set(["linkedin", "facebook", "instagram", "twitter", "tiktok"]);
const RESOLVER_TARGETS = new Set(["LEADBAY_ID", "CRM_ID", "LEAD_NAME", "LEAD_WEBSITE", "SIREN"]);
const DEFAULT_CANDIDATE_PROFILE_LIMIT = 5;

function coerceCell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v) ?? "";
}

function compactMappings(mappings: IdentityMappings): IdentityMappings {
  const out: IdentityMappings = {};
  for (const [k, v] of Object.entries(mappings) as Array<[keyof IdentityMappings, string | undefined]>) {
    if (v) out[k] = v;
  }
  return out;
}

function payloadForRecord(
  row: Record<string, string>,
  mappings: IdentityMappings
): ResolvePayload {
  const payload: ResolvePayload = {};
  const socials: NonNullable<ResolvePayload["socials"]> = {};
  for (const [field, column] of Object.entries(mappings) as Array<[keyof IdentityMappings, string]>) {
    const value = (row[column] ?? "").trim();
    if (!value) continue;
    if (SOCIAL_FIELDS.has(field)) {
      socials[field as keyof typeof socials] = value;
    } else {
      (payload as any)[field] = value;
    }
  }
  if (Object.keys(socials).length > 0) payload.socials = socials;
  return payload;
}

function identityMappingsForImport(
  records: Array<Record<string, string>>,
  identityMappings: IdentityMappings
): MappingsPayload {
  const fields: Record<string, CrmFieldMappingValue> = {};
  if (records.some((r) => (r.LEADBAY_ID ?? "").trim() !== "")) {
    fields.LEADBAY_ID = "LEADBAY_ID";
  }
  const add = (field: keyof IdentityMappings, target: CrmFieldMappingValue) => {
    const column = identityMappings[field];
    if (!column || fields[column]) return;
    if (!records.some((r) => (r[column] ?? "").trim() !== "")) return;
    fields[column] = target;
  };
  add("leadbay_id", "LEADBAY_ID");
  add("crm_id", "CRM_ID");
  add("registry_number", "SIREN");
  add("name", "LEAD_NAME");
  add("website", "LEAD_WEBSITE");
  return { fields, statuses: {}, default_status: null };
}

function disambiguationPolicy(): string[] {
  return [
    "Use `matched` lead_id values directly; the tool already writes those into LEADBAY_ID.",
    "For `ambiguous` rows, do not choose a candidate from score alone. Score is a tied evidence-band, not a confidence percentage.",
    "For every ambiguous row you resolve, keep a short decision note: selected candidate id, evidence used, conflicting evidence checked, or why LEADBAY_ID stayed blank. Report counts and examples to the user.",
    "Try to disambiguate relentlessly before giving up: rerun the row with include_candidate_profiles=true and a larger candidate_profile_limit if candidate facts are truncated, and include every trustworthy source signal available (website, full address, postcode, city, phone, registry/CRM id, source URL path, neighborhood/location words).",
    "Compare addresses intelligently as a human would. Recognize ordinary formatting, abbreviation, spelling, punctuation, casing, accent, direction, ordinal, and suite/unit differences without treating address comparison as a rigid rule checklist. A clear same-place street address match is strong evidence.",
    "Auto-select an ambiguous candidate when hydrated candidate facts uniquely agree with the source row on strong evidence: exact registry number, exact CRM ID, exact canonical website/domain with only one candidate, exact phone, or name plus clear same-place address match with postcode/city and no conflicting evidence.",
    "If several candidates share the same website/domain, do not fail fast. Treat it as a chain/multi-location problem: use source street address, postcode, city/neighborhood, phone, source URL path/location slug, and location words in the source name to pick the specific location when exactly one candidate matches.",
    "Postcode/city alone is not enough, and brand/root-domain alone is not enough for multi-location sources. If several candidates remain plausible after checking location/phone/path evidence, leave LEADBAY_ID blank.",
    "A domain derived from a contact email is useful only when it is a business domain (not gmail/hotmail/outlook/yahoo/icloud/proton/aol/etc.) and the company/contact context agrees with the candidate. If the domain looks like a POS/vendor/agency/group domain or conflicts with row notes, do not use it for LEADBAY_ID selection.",
    "If evidence is name-only, fuzzy-name-only, generic directory website, or multiple candidates remain plausible after exhausting location/phone/path evidence, leave LEADBAY_ID blank and import with website/name so Leadbay can crawl or late-match later.",
    "When the user asked for qualification after import, qualify only the lead IDs that the import returns. Late website matches may appear later via leadbay_import_status.",
  ];
}

function mappingGuidance(): string[] {
  return [
    "Treat mappings_for_import as a safe identity starting point, not a complete CRM mapping.",
    "Before importing, inspect every user column and sample values, then make a preservation plan: standard field, CONTACT_* field, Leadbay note, custom field, derived helper, or skip with a reason. The model, not this helper, should decide the complete mapping.",
    "Default to preserving client-provided business data. For meaningful columns with no standard Leadbay field, call leadbay_list_mappable_fields and create/reuse custom fields instead of silently dropping them. Skip only blank placeholders, duplicate plumbing, raw unparsed blobs after useful values are extracted, or values that would actively harm data quality.",
    "Always include LEADBAY_ID when records_for_import contains it; it makes deterministic matches import immediately.",
    "Also map the best available source identity columns: website/domain/url -> LEAD_WEBSITE, company/account/restaurant name -> LEAD_NAME, CRM/system id -> CRM_ID, registry/SIREN/SIRET/company number -> SIREN.",
    "For contact-only or HubSpot contact exports, derive a separate company_domain/company_website column from CONTACT_EMAIL only when the email domain is a real business domain and agrees with the company/deal/brand context. Do not use POS/vendor/group domains that conflict with the row, and do not derive company identity from private mailbox domains such as gmail.com, hotmail.com, outlook.com, yahoo.com, icloud.com, proton.me/protonmail.com, aol.com, or similar consumer email providers.",
    "Map contact-person columns when the file contains people: first_name -> CONTACT_FIRST_NAME, last_name -> CONTACT_LAST_NAME, job_title/title -> CONTACT_TITLE, contact email -> CONTACT_EMAIL, contact phone -> CONTACT_PHONE_NUMBER, contact LinkedIn -> CONTACT_LINKEDIN. If a company/restaurant row contains structured owners, decision makers, or contact lists, expand those people into additional import rows that repeat the parent lead identity and contain one CONTACT_* person per row. Multiple rows may point to the same LEADBAY_ID/company; import them as separate contacts on that lead.",
    "Preserve valuable source-system links. For HubSpot URLs, prefer extracting the stable object id into a clean column and mapping it to an existing or newly created EXTERNAL_ID custom field. Reuse an existing HubSpot linked-id field when present. Preserve raw source identifiers such as hubspot_id and associated_deal in custom fields when they are not already represented by a better standard/custom field. Use TEXT only when no stable id/template can be recovered.",
    "Clean source-system deal names before using them as LEAD_NAME: strip import campaign suffixes such as BYOC, BYOC only, DD, Uber, trailing separators, and duplicate pipeline labels, while preserving the original associated deal/source value in a custom field when it is meaningful to the user's workflow.",
    "Drop blank-header columns and placeholder values like `couldn't find`, `yes`, empty arrays, and raw JSON blobs unless you first extract meaningful scalar fields.",
    "Leadbay has CONTACT_PHONE_NUMBER but no standard LEAD_PHONE field in this surface. Preserve establishment/company phone only via an intentional custom field, not by pretending it is a contact phone.",
    "Preserve meaningful client notes, data-quality warnings that affect outreach, source record links, and owner/evidence URLs when they help the user's workflow. Do not map noisy scraper plumbing, duplicate blank columns, placeholder values, or long reasoning text.",
    "If the file contains meaningful per-lead notes/context, keep that text aside during import and add it to the imported/resolved leads with leadbay_add_note after import when that tool is available. For dry runs, report which notes would be written. If notes cannot be written and the user asked to preserve the text, create/reuse an import-notes custom field.",
    "For scraped owner/email JSON columns, extract the best scalar values into new clean columns before import; do not pass raw JSON blobs as core CRM fields.",
    "If no confident standard/custom mapping exists for a meaningful user column, create or reuse a custom field unless the column is blank/noisy/duplicate and record why it was skipped.",
  ];
}

async function hydrateCandidateProfiles(
  client: LeadbayClient,
  candidates: Extract<ResolveResult, { type: "ambiguous" }>["candidates"],
  lensId: number,
  limit: number
): Promise<CandidateProfile[]> {
  const selected = candidates.slice(0, Math.max(0, limit));
  const settled = await Promise.allSettled(
    selected.map((c) =>
      client.request<any>("GET", `/lenses/${lensId}/leads/${c.lead_id}`)
    )
  );
  const out: CandidateProfile[] = [];
  settled.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    const lead = r.value;
    out.push({
      lead_id: selected[i].lead_id,
      name: lead.name ?? null,
      website: lead.website ?? null,
      location: lead.location
        ? {
            full: lead.location.full ?? null,
            city: lead.location.city ?? null,
            state: lead.location.state ?? null,
            country: lead.location.country ?? null,
          }
        : null,
      phone_numbers: Array.isArray(lead.phone_numbers) ? lead.phone_numbers : [],
      description: typeof lead.description === "string" ? lead.description.slice(0, 400) : null,
    });
  });
  return out;
}

function hasResolverTarget(mappings: MappingsPayload): boolean {
  return Object.values(mappings.fields).some((v) => RESOLVER_TARGETS.has(v));
}

export const resolveImportRows: Tool<ResolveImportRowsParams, ResolveImportRowsResult> = {
  name: "leadbay_resolve_import_rows",
  annotations: {
    title: "Resolve import row identities",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: RESOLVE_IMPORT_ROWS_DESCRIPTION,
  write: false,
  version: "0.6.4",
  inputSchema: {
    type: "object",
    properties: {
      records: {
        type: "array",
        description:
          "CSV-shaped rows from the user file. Values may be strings, numbers, booleans, null, arrays, or objects; non-scalars are JSON-stringified for resolver/import preparation.",
        items: { type: "object" },
      },
      identity_mappings: {
        type: "object",
        description:
          "Resolver field -> source column map chosen by the agent after inspecting the file, e.g. {website:'company_domain', name:'Company', crm_id:'Salesforce ID', registry_number:'SIREN'}. May point to clean columns the agent derived before calling this tool. This tool does not infer mappings from header names.",
        properties: {
          leadbay_id: { type: "string" },
          crm_id: { type: "string" },
          name: { type: "string" },
          website: { type: "string" },
          phone: { type: "string" },
          email: { type: "string" },
          registry_number: { type: "string" },
          registry_type: { type: "string" },
          address: { type: "string" },
          city: { type: "string" },
          postcode: { type: "string" },
          country: { type: "string" },
          linkedin: { type: "string" },
          facebook: { type: "string" },
          instagram: { type: "string" },
          twitter: { type: "string" },
          tiktok: { type: "string" },
        },
        additionalProperties: false,
      },
      include_candidate_profiles: {
        type: "boolean",
        description:
          "When true, hydrate ambiguous candidate IDs with lightweight lead facts from the active lens. Use on small batches or rerun on only ambiguous rows; large ambiguous files can return many candidates.",
      },
      candidate_profile_limit: {
        type: "number",
        description: `Maximum candidates to hydrate per ambiguous row when include_candidate_profiles=true (default ${DEFAULT_CANDIDATE_PROFILE_LIMIT}).`,
      },
      lensId: {
        type: "number",
        description: "Lens ID used for candidate profile hydration. Defaults to the user's active lens.",
      },
    },
    required: ["records"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      rows: {
        type: "array",
        description:
          "Per-input resolution result. Matched rows include lead_id; ambiguous rows include candidates; none/unidentifiable rows explain what extra signal would help.",
        items: { type: "object" },
      },
      records_for_import: {
        type: "array",
        description:
          "Import-ready records. Matched rows include LEADBAY_ID. Ambiguous/unresolved rows preserve user data and rely on website/name/CRM fields for normal or late matching.",
        items: { type: "object" },
      },
      mappings_for_import: {
        type: "object",
        description:
          "Safe identity-only mapping starter. The agent should review/extend this using mapping_guidance and leadbay_list_mappable_fields before importing.",
      },
      identity_mappings_used: { type: "object" },
      mapping_guidance: {
        type: "array",
        description: "Instructions for building the final import mappings from the source columns.",
        items: { type: "string" },
      },
      disambiguation_policy: {
        type: "array",
        description: "Rules the agent should follow before writing LEADBAY_ID onto ambiguous rows.",
        items: { type: "string" },
      },
      summary: { type: "object" },
      next_action: { type: "string" },
      region: { type: "string" },
      _meta: { type: "object" },
    },
    required: [
      "rows",
      "records_for_import",
      "mappings_for_import",
      "identity_mappings_used",
      "mapping_guidance",
      "disambiguation_policy",
      "summary",
      "next_action",
      "region",
      "_meta",
    ],
  },
  execute: async (
    client: LeadbayClient,
    params: ResolveImportRowsParams
  ): Promise<ResolveImportRowsResult> => {
    if (!Array.isArray(params.records) || params.records.length === 0) {
      throw client.makeError(
        "RESOLVE_IMPORT_EMPTY_INPUT",
        "records[] must contain at least one row",
        "Pass the rows from the user file, then import records_for_import.",
        "POST /leads/resolve"
      );
    }

    const rows = params.records.map((rec, i) => {
      if (rec == null || typeof rec !== "object" || Array.isArray(rec)) {
        throw client.makeError(
          "RESOLVE_IMPORT_INVALID_ROW",
          `records[${i}] must be a plain object`,
          "Pass each input row as { ColumnName: value, ... }.",
          "POST /leads/resolve"
        );
      }
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(rec)) out[k] = coerceCell(v);
      return out;
    });

    const identityMappings = compactMappings(params.identity_mappings ?? {});

    const allColumns = new Set(rows.flatMap((r) => Object.keys(r)));
    for (const [field, column] of Object.entries(identityMappings)) {
      if (!allColumns.has(column)) {
        throw client.makeError(
          "RESOLVE_IMPORT_MAPPING_KEY_UNKNOWN",
          `identity_mappings.${field} points to missing column ${JSON.stringify(column)}`,
          "Use a source column that exists in at least one input record.",
          "POST /leads/resolve"
        );
      }
    }

    const outputs: ResolveImportRowsResult["rows"] = [];
    const recordsForImport: Array<Record<string, string>> = [];

    const results = await Promise.all(
      rows.map(async (row) => {
        const payload = payloadForRecord(row, identityMappings);
        const result = await client.request<ResolveResult>("POST", "/leads/resolve", payload);
        return { payload, result };
      })
    );

    let matched = 0;
    let ambiguous = 0;
    let none = 0;
    let unidentifiable = 0;

    const hydrateProfiles = params.include_candidate_profiles === true;
    const candidateProfileLimit =
      params.candidate_profile_limit ?? DEFAULT_CANDIDATE_PROFILE_LIMIT;
    const hydrationLensId =
      hydrateProfiles ? params.lensId ?? (await client.resolveDefaultLens()) : null;

    for (let index = 0; index < results.length; index++) {
      const { payload, result } = results[index];
      const importRecord = { ...rows[index] };
      const rowOut: ResolveImportRowsResult["rows"][number] = {
        index,
        type: result.type,
        resolver_payload: payload,
        import_record: importRecord,
      };

      if (result.type === "matched") {
        matched++;
        importRecord.LEADBAY_ID = result.lead_id;
        rowOut.lead_id = result.lead_id;
        rowOut.matched_on = result.matched_on;
      } else if (result.type === "ambiguous") {
        ambiguous++;
        rowOut.candidates = result.candidates;
        if (hydrateProfiles && hydrationLensId !== null) {
          rowOut.candidate_profiles = await hydrateCandidateProfiles(
            client,
            result.candidates,
            hydrationLensId,
            candidateProfileLimit
          );
        }
      } else if (result.type === "none") {
        none++;
        rowOut.would_help = result.would_help;
      } else {
        unidentifiable++;
        rowOut.reason = result.reason;
      }

      recordsForImport.push(importRecord);
      outputs.push(rowOut);
    }

    const mappingsForImport = identityMappingsForImport(recordsForImport, identityMappings);
    const readyForImport = hasResolverTarget(mappingsForImport);

    return {
      rows: outputs,
      records_for_import: recordsForImport,
      mappings_for_import: mappingsForImport,
      identity_mappings_used: identityMappings,
      mapping_guidance: mappingGuidance(),
      disambiguation_policy: disambiguationPolicy(),
      summary: {
        total: rows.length,
        matched,
        ambiguous,
        none,
        unidentifiable,
        ready_for_import: readyForImport,
      },
      next_action: readyForImport
        ? "Review ambiguous candidates using disambiguation_policy. Build the final mapping from mappings_for_import plus mapping_guidance, then call leadbay_import_leads or leadbay_import_and_qualify with records_for_import and the reviewed mapping."
        : "Add or map at least one import resolver column (LEADBAY_ID, CRM_ID, LEAD_NAME, LEAD_WEBSITE, or SIREN), then call leadbay_import_leads.",
      region: client.region,
      _meta: client.lastMeta ?? {
        region: client.region,
        endpoint: "POST /leads/resolve",
        latency_ms: null,
        retry_after: null,
      },
    };
  },
};
