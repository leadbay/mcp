// All interfaces use snake_case to match the Leadbay API (JsonNamingStrategy.SnakeCase)
import type { LeadbayClient } from "./client.js";

// Metadata propagated through every request — composites and the MCP error
// formatter use this so the agent can see WHICH region the call hit, what
// endpoint, how long it took, and (on 429) when to retry. There is no
// request-id header on the Leadbay backend (probed 2026-04-20), so we don't
// pretend there is one.
export interface RequestMeta {
  region: "us" | "fr" | "custom";
  endpoint: string;
  latency_ms: number | null;
  retry_after: number | null;
  // HTTP status of the upstream response when the error originated from a
  // non-2xx (set by mapErrorResponse). Absent for errors that didn't go
  // through the HTTP layer (NOT_AUTHENTICATED, MOCK_NOT_FOUND, composite-
  // synthesized codes like LEAD_NOT_FOUND).
  http_status?: number;
}

export interface LeadbayError {
  error: true;
  code: string;
  message: string;
  hint: string;
  _meta?: RequestMeta;
}

export interface LensPayload {
  id: number;
  name: string;
  description?: string | null;
  user_id?: string | null;
  is_last_active?: boolean;
  is_default?: boolean;
  default?: boolean;
  draft_of?: number | null;
  multi_product_mode?: boolean;
  use_hq_only?: boolean;
}

export interface LocationPayload {
  city?: string | null;
  state?: string | null;
  country?: string | null;
  full?: string | null;
  // Backend axis order is not pinned in the wiki (backend ask #4 of the
  // MCP Apps plan tracks confirmation). The map widget detects the order
  // heuristically — if one component is clearly outside latitude range
  // (|lat| > 90) it's treated as longitude. Servers MUST emit MapLibre's
  // native [lng, lat] when possible; otherwise the widget still renders
  // sanely thanks to the heuristic.
  pos?: [number, number] | null;
}

export interface SizePayload {
  low?: number | null;
  high?: number | null;
  min?: number | null;
  max?: number | null;
  label?: string | null;
}

export interface SplitAiSummary {
  worth_pursuing: string | null;
  approach_angle: string | null;
  next_step: string | null;
}

// Tags carry a confidence score from the lead-summary API.
export interface LeadTag {
  id?: number;
  display_name?: string;
  tag: string;
  score: number;
}

export interface RecommendedContactPayload {
  contact_id?: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  email?: string | null;
  phone_number?: string | null;
}

export interface SocialPresence {
  crunchbase?: boolean;
  facebook?: boolean;
  instagram?: boolean;
  linkedin?: boolean;
  tiktok?: boolean;
  twitter?: boolean;
}

export interface LeadPayload {
  id: string;
  name: string;
  /**
   * Similarity score: how closely this lead matches the user's ideal-customer
   * profile (the active lens). Combined with `ai_agent_lead_score` and
   * normalized server-side to a 0-100 scale before display.
   */
  score: number | null;
  /**
   * Deep AI qualification adjustment, computed after running web searches and
   * lead intelligence lookups. Acts as a boost/penalty on top of `score`;
   * the two are combined and normalized server-side to a 0-100 scale.
   */
  ai_agent_lead_score: number | null;
  location: LocationPayload | null;
  description: string | null;
  short_description?: string | null;
  size: SizePayload | null;
  website: string | null;
  logo?: string | null;
  contacts_count: number;
  org_contacts_count: number;
  notes_count?: number;
  epilogue_actions_count?: number;
  prospecting_actions_count?: number;
  ai_summary?: string | null;
  split_ai_summary?: SplitAiSummary | null;
  liked: boolean;
  disliked: boolean;
  new?: boolean;
  exported?: boolean;
  // CRM custom-field values stored on this lead. Self-describing entries
  // (see LeadCustomFieldEntry). Empty array when the org has no custom fields
  // or none are set on this lead. Surfaced by leadbay_get_lead_custom_fields.
  custom_fields?: LeadCustomFieldEntry[];
  tags: LeadTag[];
  phone_numbers?: string[];
  keywords?: Array<{ keyword: string; score: number }>;
  recommended_contact_title?: string | null;
  recommended_contact?: RecommendedContactPayload | null;
  web_fetch_in_progress?: boolean;
  enrichment_in_progress?: boolean;
  social_presence?: SocialPresence;
  has_phone?: boolean;
  in_monitor?: boolean;
  in_discover?: boolean;
  need_attention?: boolean;
  need_attention_today?: boolean;
}

export interface PaginationPayload {
  page: number;
  pages: number;
  total: number;
}

export interface WishlistResponse {
  items: LeadPayload[];
  pagination: PaginationPayload;
  computing_wishlist: boolean;
  computing_scores: boolean;
}

// AI-rescore answers — the highest-signal payload Leadbay produces per lead.
// Per-question qualification boost from the AI agent. Discrete values:
// -10 (negative signal), 0 (neutral / no signal), 10 (positive signal),
// 20 (strong positive signal). These boosts are summed and combined with
// the lead's similarity `score`, then normalized server-side to the 0-100
// lead-level scale before display. NOT a 0-10 scale despite legacy naming.
export interface AiAgentResponse {
  question: string;
  question_created_at: string;
  lead_id: string;
  /** Discrete boost: -10, 0, 10, or 20. See interface comment above. */
  score: number | null;
  response: string | null;
  computed_at: string | null;
  outdated_at?: string | null;
}

export interface ContactEnrichment {
  done: boolean;
  credits_used?: number;
  email_requested?: boolean;
  phone_requested?: boolean;
}

export interface ContactPayload {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_number: string | null;
  linkedin_page: string | null;
  job_title: string | null;
  recommended: boolean;
  enrichment: ContactEnrichment | null;
}

export interface BillingStatePayload {
  status: string;
  ai_credits: number | null;
  ai_credits_quota: number | null;
  // Seat count. The backend hard-codes this to 100_000 when the org has
  // disable_billing=true (OrgPayload.kt) — the wire signal that billing is
  // OFF and the org is genuinely unlimited (product#3851). A normally-billed
  // org (freemium or paid) reports its real, small seat count.
  seats?: number | null;
  freemium?: { daily_quota: number; monthly_quota: number };
}

export interface OrgPayload {
  id: string;
  name: string;
  description?: string;
  website?: string;
  location?: string;
  completed?: boolean;
  ai_agent_enabled?: boolean;
  computing_intelligence?: boolean;
  quota_plan?: string;
  billing?: BillingStatePayload | null;
}

export interface NotePayload {
  id: string;
  note: string;
  created_at: string;
  user_id?: string;
}

export interface LoginResponse {
  token: string;
  verified: boolean;
}

// Web-fetch content is a dynamic dict keyed by emoji-prefixed section labels
// (e.g. "🏢 company profile", "📈 business signals"). Composites that return
// this to the agent reshape it into an ordered array — see WebFetchSignals.
export interface WebFetchEntry {
  hot?: boolean;
  source: string;
  date?: string;
  description: string;
}

export type WebFetchContent = Record<string, WebFetchEntry[]>;

export interface LeadWebFetchPayload {
  lead_id: string;
  content: WebFetchContent | null;
  fetch_at: string | null;
  in_progress: boolean;
}

// Composite-side reshaped form (avoids dynamic-key typing in agent payloads).
export interface WebFetchSignalsSection {
  section_label: string;
  section_emoji: string | null;
  entries: WebFetchEntry[];
}

export interface IdealBuyerProfilePayload {
  summary?: string;
  key_characteristics?: string[];
  anti_patterns?: string[];
  generated_at?: string;
}

export interface PurchaseIntentTagPayload {
  id?: number;
  display_name: string;
  tag: string;
  description?: string | null;
  score?: number | null;
  reasoning?: string | null;
}

export interface AiAgentQuestionPayload {
  question: string;
  created_at: string;
  lang: string;
}

export interface UserMePayload {
  id: string;
  email?: string;
  name?: string;
  verified?: boolean;
  admin?: boolean;
  manager?: boolean;
  organization: OrgPayload;
  // Backend sends lens ids as STRINGS (e.g. "40005"); older callers treated
  // this as a number, so accept both and normalize at the use site.
  last_requested_lens?: string | number | null;
  language?: string;
  free_ai_credits?: number;
}

export interface PaidContactPayload {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_number: string | null;
  linkedin_page: string | null;
  job_title: string | null;
  enrichment: ContactEnrichment | null;
  recommended: boolean;
}

export interface ActivityItem {
  lead_id: string;
  type: string;
  date: string;
}

export interface PaginatedActivities {
  items: ActivityItem[];
  pagination: PaginationPayload;
}

// ─── Lens filter (criteria-based, type discriminator) ─────────────────────

export type FilterCriterion =
  | { type: "sector_ids"; is_excluded: boolean; sectors: string[] }
  | { type: "location_ids"; is_excluded: boolean; locations: string[] }
  | { type: "size"; is_excluded: boolean; sizes: Array<{ min?: number; max?: number }> }
  | { type: string; is_excluded: boolean; [k: string]: unknown };

// /1.6/geo/search response shape. `level` is the admin hierarchy depth
// (5=region, 6=county, 7=township-area, 8=city/town). `parent_ids` traces
// the lead's location up the admin tree.
export interface GeoMatch {
  id: string;
  country: string;
  level: number;
  name: string;
  parent_ids: string[];
}

export interface GeoSearchResponse {
  results: GeoMatch[];
  parents: GeoMatch[];
}

// Surface shape for city ambiguity — mirrors SectorAmbiguity (see
// composite/adjust-audience.ts) so the picker widget handles both with
// the same render path.
export interface LocationAmbiguity {
  location_text: string;
  matches: Array<{ id: string; name: string; country: string; level: number; score: number }>;
}

export interface LensFilterItem {
  criteria: FilterCriterion[];
}

export interface LocationsBlock {
  results: unknown[];
  parents: unknown[];
}

export interface FilterPayload {
  lens_filter: { items: LensFilterItem[] };
  locations: LocationsBlock;
}

// ─── Sectors taxonomy ─────────────────────────────────────────────────────

export interface SectorPayload {
  id: string;
  // The backend can (and does) return entries with a null/missing name — the
  // taxonomy is not guaranteed clean. Typed honestly so callers must guard.
  name?: string | null;
  // The /sectors/all endpoint may also surface aliases / parent ids — kept
  // permissive.
  [k: string]: unknown;
}

// ─── Selection / bulk enrichment ──────────────────────────────────────────

export interface BulkEnrichPreview {
  selected_leads: number;
  enriched_contacts: number;
  enrichable_contacts: number;
  title_suggestions: string[];
  // Newer field — will be populated once the backend ships it. Falls back to
  // live aggregation in `recall_ordered_titles` if absent.
  previously_enriched_titles?: string[];
  auto_included_titles?: string[];
}

// ─── Org user_prompt + clarifications ─────────────────────────────────────

export interface UserPromptPayload {
  prompt: string;
}

export interface ClarificationOption {
  id?: string;
  label: string;
  prompt_fragment?: string;
}

export interface ClarificationPayload {
  id?: string;
  question: string;
  options?: ClarificationOption[];
  created_at?: string;
}

// ─── Epilogue ─────────────────────────────────────────────────────────────

export type EpilogueStatusType =
  | "EPILOGUE_INTEREST_VALIDATED_OR_MEETING_PLANED"
  | "EPILOGUE_COULD_NOT_REACH_STILL_TRYING"
  | "EPILOGUE_NOT_INTERESTED_LOST"
  | "EPILOGUE_STILL_CHASING";

export interface EpilogueResponseItem {
  lead_id: string;
  status: EpilogueStatusType;
  set_at: string;
  set_by?: string;
}

export interface EpilogueResponsesPayload {
  items: EpilogueResponseItem[];
  pagination: PaginationPayload;
}

// ─── Pushback (snooze a lead for 3 / 6 / 12 months) ───────────────────────

export type PushbackStatusType =
  | "PUSHBACK_3"
  | "PUSHBACK_6"
  | "PUSHBACK_12";

// ─── Monitor filter (server-persisted; see GET/POST /monitor/filter) ─────

// `FilterCriterion` is an anyOf over 10 typed criteria. The MCP just passes
// the criterion objects through verbatim — the backend validates each one.
export interface MonitorFilterItem {
  criteria: Array<Record<string, unknown>>;
}

export interface ProspectingActionItem {
  lead_id: string;
  type: string;
  date: string;
  user_id?: string;
}

export interface ProspectingActionsPayload {
  items: ProspectingActionItem[];
  pagination: PaginationPayload;
}

// ─── Quota status (live endpoint) ─────────────────────────────────────────

export type QuotaWindow = "daily" | "weekly" | "monthly";
export type QuotaResource =
  | "llm_completion"
  | "ai_rescore"
  | "web_fetch"
  | "lens_extra_refill"
  | "contact_enrichment_phone"
  | "contact_enrichment_email"
  | string;

// The per-window SPEND gauge — this is the numerator/denominator the frontend
// quota widget renders as a percentage. Both fields are in dollar_cents, so the
// dollar figure is `/100` and the % used is `current_units / max_units`. Only
// populated when the org has an OVERALL_SPEND (COST_CENTS) quota provisioned;
// internal / free orgs return an empty `spend[]` and fall back to `resources[]`.
export interface QuotaSpend {
  current_units: number;
  max_units: number;
  window_type: QuotaWindow;
  resets_at: string;
}

export interface QuotaResourceUsage {
  resource_type: QuotaResource;
  // Amount USED in this window — not remaining. The per-resource cap, when a
  // count-quota is provisioned, is `max_units` (below); it is null/absent when
  // no such quota exists — never infer "unlimited / no quota" from its absence.
  count: number;
  // The per-resource cap for this window, or null when no count-quota is
  // provisioned for this resource. Present on the wire (ResourceEntry.maxUnits).
  max_units?: number | null;
  window_type: QuotaWindow;
  resets_at: string;
}

export interface QuotaStatusPayload {
  plan: string | null;
  // ORG-scope group is only populated for admin users; null otherwise. Prefer
  // the `user` group (present for every caller) for the caller's own view.
  org: {
    spend: QuotaSpend[];
    resources: QuotaResourceUsage[];
  } | null;
  user?: {
    spend?: QuotaSpend[];
    resources?: QuotaResourceUsage[];
  } | null;
  // Top-up balance (dollar_cents). Present only when the org has an active
  // top-up; null otherwise. Clears throttles immediately, outside the windows.
  topup?: { remaining_cents: number; total_credit_cents: number } | null;
}

// ─── File-import wizard payloads (POST /1.6/imports/...) ──────────────────
// Wire format probed live 2026-04-28. The Leadbay backend serializes with
// kotlinx.serialization JsonNamingStrategy.SnakeCase, so all field names are
// snake_case. The mapping keys for `fields` are column-header names from the
// uploaded CSV (e.g. "LEAD_NAME"), NOT column indices.

export type StandardCrmFieldType =
  | "LEAD_NAME"
  | "LEAD_WEBSITE"
  | "LEAD_STATUS"
  | "LEAD_LOCATION"
  | "LEAD_LOCATION_STREET_NUM"
  | "LEAD_LOCATION_STREET"
  | "LEAD_LOCATION_POSTCODE"
  | "LEAD_LOCATION_CITY"
  | "LEAD_SECTOR"
  | "LEAD_SIZE"
  | "CRM_ID"
  | "LEADBAY_ID"
  | "EMAIL"
  | "DEAL_CRM_ID"
  | "CONTACT_FIRST_NAME"
  | "CONTACT_LAST_NAME"
  | "CONTACT_EMAIL"
  | "CONTACT_PHONE_NUMBER"
  | "CONTACT_TITLE"
  | "CONTACT_LINKEDIN"
  | "LEAD_STATUS_DATE"
  | "OWNER"
  | "SCORE"
  | "SIREN";

// Custom-field mapping is encoded as the literal string "CUSTOM.<id>" where
// <id> is the numeric CustomCrmField.id from /crm/custom_fields. The backend
// serializer (CrmFieldType.kt) deserializes both StandardCrmFieldType names
// and "CUSTOM.<digits>" into the same `Map<String, CrmFieldType>`.
export type CustomFieldMappingValue = `CUSTOM.${number}`;

// Wire-format value for an entry in MappingsPayload.fields. The wizard
// tolerates unknown CSV columns; leadbay_import_leads attaches an MCP_ROW_ID
// column for stable reconciliation but does NOT include it in the mappings
// payload (would 400). String escape hatch retained for forward compat.
export type CrmFieldMappingValue =
  | StandardCrmFieldType
  | CustomFieldMappingValue
  | (string & {});

export interface MappingsPayload {
  fields: Record<string, CrmFieldMappingValue>;
  statuses: Record<string, string>;
  default_status: string | null;
}

// Mirrors backend CustomCrmFieldKind (CustomCrmFieldKind.kt). The org admin
// picks one when creating a custom field. Field-typed callers (NUMBER, PRICE)
// are coerced from strings to typed values server-side at import time.
export type CustomCrmFieldKind =
  | "TEXT"
  | "NUMBER"
  | "PRICE"
  | "DATE"
  | "DATETIME"
  | "EXTERNAL_ID"
  | (string & {}); // forward compat — surface unknown kinds as warnings, don't reject

// Optional config block per kind, mirroring backend sealed interface.
// PRICE → { currency }, DATE/DATETIME → { format }, EXTERNAL_ID → { urlTemplate }.
export interface CustomCrmFieldConfig {
  currency?: string;
  format?: string | null;
  url_template?: string;
  urlTemplate?: string;
}

// Wire shape of a custom field row (GET /crm/custom_fields). `id` is a string
// because the backend uses LongAsStringSerializer to avoid JS number-precision
// loss on the wire, even though the column is BIGINT.
export interface CustomFieldDef {
  id: string;
  name: string;
  type: CustomCrmFieldKind;
  config?: CustomCrmFieldConfig | null;
}

// A custom-field VALUE as it appears on a lead detail/list payload
// (`GET /lenses/{lensId}/leads/{leadId}` → `custom_fields[]`). The entry is
// self-describing: it embeds the full field definition under `field`, so
// reading a lead's custom fields needs NO join against /crm/custom_fields.
// `value` is the stored cell text (null when set-but-empty). Verified live.
export interface LeadCustomFieldEntry {
  field: CustomFieldDef;
  value: string | null;
}

export interface PreProcessingStatePayloadV15 {
  finished: boolean;
  error?: string | null;
  hints?: unknown | null;
  samples?: Array<Record<string, string>> | null;
  status_samples?: string[] | null;
}

export interface ProcessingStatePayload {
  progress: number;
  finished: boolean;
  error?: string | null;
}

export interface FileImportPayloadV15 {
  id: string;
  date: string;
  file_name: string;
  imported_records: number;
  pending_imported_records: number;
  total_records: number;
  mappings: MappingsPayload | null;
  pre_processing: PreProcessingStatePayloadV15 | null;
  processing: ProcessingStatePayload | null;
}

// Returned by GET /1.6/imports/{importId}/leads (backend PR #1801, 2026-05-06).
// Distinct lead ids that this import touched — matched-existing AND
// newly-created. Source of truth for downstream chaining (bulk_qualify_leads
// / bulk_enrich / import_and_qualify) — replaces per-record pagination.
// Returns 400 `in_progress` if the import isn't processed yet.
export interface ImportLeadsResponse {
  lead_ids: string[];
}

// ─── Lead resolver payloads (POST /1.6/leads/resolve) ─────────────────────

export interface ResolveSocialsPayload {
  linkedin?: string | null;
  facebook?: string | null;
  instagram?: string | null;
  twitter?: string | null;
  tiktok?: string | null;
}

export interface ResolvePayload {
  leadbay_id?: string | null;
  crm_id?: string | null;
  name?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  registry_number?: string | null;
  registry_type?: string | null;
  address?: string | null;
  city?: string | null;
  postcode?: string | null;
  country?: string | null;
  socials?: ResolveSocialsPayload | null;
}

export interface ResolveCandidate {
  lead_id: string;
  score: number;
  matched_on: string[];
  lead_fields_populated: Array<
    "registry" | "website" | "phone" | "email" | "address" | "linkedin" | (string & {})
  >;
}

export type ResolveResult =
  | { type: "matched"; lead_id: string; matched_on: string[] }
  | { type: "ambiguous"; candidates: ResolveCandidate[] }
  | { type: "none"; would_help: Array<"website" | "registry_number" | (string & {})> }
  | { type: "unidentifiable"; reason: string };

// One entry in record.records[] — { column_name, value, field? }.
export interface ImportRecordCell {
  column_name: string;
  value: string;
  field?: StandardCrmFieldType | null;
}

// One row in /imports/{id}/records — what the wizard matched (or didn't).
// Status from CrmRowRecordStatus (MATCHING/IMPORTING/IMPORTED).
// match_type from MatchType (AUTOMATIC_MATCH/MANUAL_MATCH/NO_MATCH).
export interface ImportRecordPayload {
  id: string | number;
  records: ImportRecordCell[];
  match_type: "AUTOMATIC_MATCH" | "MANUAL_MATCH" | "NO_MATCH";
  status: "MATCHING" | "IMPORTING" | "IMPORTED" | string;
  // The full LeadPayload-shaped object from the wizard. We only use `.id`,
  // `.name`, and `.website` — the rest is permissive.
  lead?: {
    id: string;
    name?: string | null;
    website?: string | null;
    [k: string]: unknown;
  } | null;
  status_set_at?: string | null;
  lead_status?: string | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: PaginationPayload;
}

// ─── Notifications (backend ADR docs/adr/notifications.md) ─────────────────
//
// The `notifications` row is the canonical async-task ledger for the three
// bulk flows: contact enrichment, lead qualification (web-fetch + AI rescore),
// CSV / CRM import. Progress counters live on the row and update atomically;
// the row is pushed over WS on every increment and on the terminal
// `inProgress=false` transition. The MCP consumes this ledger to keep the
// agent aware of background work that just completed.

export interface BulkProgress {
  total_count: number;
  success_count: number;
  failure_count: number;
  quota_hit_count: number;
}

// Polymorphic link discriminated by `type`. The backend emits one variant per
// notification row; new variants may appear over time (the backend serializer
// drops `file_import` from links — it travels at the root as `file_import_id`
// instead — but we keep it in the union for forward-compat).
export type NotificationLink =
  | { type: "bulk_enrichment"; id: string; parent?: NotificationLink | null }
  | { type: "file_import"; id: string; parent?: NotificationLink | null }
  | { type: "lead"; id: string; parent?: NotificationLink | null }
  | { type: "lens"; id: number; parent?: NotificationLink | null }
  | { type: "note"; id: string; parent?: NotificationLink | null }
  | { type: "contact"; id: string; parent?: NotificationLink | null }
  | { type: "lead_contact"; id: string; parent?: NotificationLink | null }
  | { type: string; id: string | number; parent?: NotificationLink | null };

export interface Notification {
  id: string;
  created_at: string;
  updated_at: string;
  first_seen_at: string | null;
  archived: boolean;
  language: string;
  title: string;
  content: string | null;
  in_progress: boolean;
  links: NotificationLink[];
  // Non-null iff this is a bulk-progress notification. Inferred kind:
  //   links[].type == "bulk_enrichment" → contact enrichment
  //   file_import_id non-null          → CSV / CRM import
  //   neither, bulk_progress set       → lead qualification
  bulk_progress: BulkProgress | null;
  // Anchor for the CSV / CRM import flow. Carried at the root (rather than as
  // a polymorphic links variant) for compat with older generated clients
  // — see backend ADR §1 for the rationale.
  file_import_id: string | null;
}

export interface PaginatedNotifications {
  items: Notification[];
  total_unseen: number;
  pagination: PaginationPayload;
}

// Bulk-launch responses now carry the canonical notification handle so the
// MCP (and the FE) can subscribe to the corresponding row without having to
// invent client-side ids.
export interface BulkLaunchResponse {
  notification_id: string | null;
}

// Bulk web-fetch (lead qualification) launch carries the same handle along
// with the queued / skipped lead counts.
export interface BulkWebFetchResponse {
  queued: number;
  skipped: number;
  queued_ids: string[];
  skipped_ids: string[];
  notification_id: string | null;
}

// WS auth ticket — REST endpoint mints a one-shot URL the client opens.
export interface WsAuthResponse {
  url: string;
}

// Inbox entry — the shape we surface to the agent via `_meta.notifications`
// and `account_status.notifications`. Derived client-side from the wire
// `Notification` payload via `notifications/revise-hint.ts`.
export interface NotificationInboxEntry {
  notification_id: string;
  kind: "bulk_enrich" | "bulk_qualify" | "import" | "other";
  anchor_id: string | null;
  title: string;
  bulk_progress: BulkProgress | null;
  completed_at: string;
  // Hint the agent reads to decide which prior outputs to revise. See the
  // revise-hint module for the per-kind template.
  revise_hint: string;
}


// ─── Protocol-agnostic Tool type ──────────────────────────────────────────────

export interface ToolLogger {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
}

export interface ToolContext {
  logger?: ToolLogger;
  // Optional BulkTracker for composites that mint/look up client-side bulk_ids
  // while the Leadbay backend doesn't yet issue real job handles. Granular tools
  // don't need this. See packages/core/src/jobs/bulk-store.ts.
  bulkTracker?: import("./jobs/bulk-store.js").BulkTracker;
  // Notifications inbox — populated by the MCP server's WS listener with
  // terminal bulk-progress notifications. The account-status composite
  // surfaces inbox entries on every check-in, and the MCP server decorates
  // every tool response's _meta.notifications with the same list so the
  // agent sees completions on the next turn regardless of which tool it
  // called next. Undefined in OpenClaw / tests that don't wire it up.
  notificationsInbox?: import("./notifications/inbox.js").NotificationsInbox;
  // Long-running composites (notably leadbay_import_leads) honor this for
  // mid-poll cancellation so the caller can recover via the returned
  // importIds without waiting for the budget to expire.
  signal?: AbortSignal;
  // Stream progress to the MCP client (per spec notifications/progress).
  // Defined only when the client requested progress (i.e. the request carried
  // _meta.progressToken). Composites should fire-and-forget — the wiring
  // swallows transport errors. Callers that don't observe this leave the
  // function unset and the wire stays cheap.
  progress?: (params: { progress: number; total?: number; message?: string }) => void;
  // Ask the user a clarifying question via the MCP client (spec
  // elicitation/create form-based mode). Composites that need a one-off
  // answer (refine_prompt clarifications, report_outreach user_confirmed)
  // can use this instead of returning a "please call answer_X" telephone
  // payload to the agent. Returns the user's response { action, content? }.
  // Always null-check before calling — older clients lacking elicitation
  // capability cause this to be undefined; composite must fall back.
  elicit?: (params: {
    message: string;
    requestedSchema: Record<string, unknown>;
  }) => Promise<{
    action: "accept" | "decline" | "cancel";
    content?: Record<string, unknown>;
  }>;
  // Send user-authored feedback to the Leadbay team's Sentry feedback inbox —
  // the SAME destination as the web app's feedback form. Wired by the MCP
  // server to the telemetry handle's captureFeedback (which fills name/email
  // from /users/me). Returns true if actually sent. Undefined in deployments
  // without telemetry (OpenClaw / tests) — the tool must null-check and report
  // that feedback couldn't be sent rather than claiming success.
  sendFeedback?: (
    message: string,
    opts?: { associatedEventId?: string }
  ) => Promise<boolean>;
  // The verbatim user-message slice this call is acting upon (the value the
  // agent passed as `_triggered_by`, stripped out at the server layer). Lets a
  // composite gate optional output on what the user actually asked — e.g.
  // account_status only surfaces the active lens when the trigger mentions the
  // lens/audience, so it never volunteers it unprompted (product#3761).
  // Undefined when no trigger was captured (granular tools, tests).
  triggered_by?: string;
}

export type JSONSchema = Record<string, unknown>;

// Mirrors MCP spec ToolAnnotations (modelcontextprotocol 2025-11-25). Defined
// locally so @leadbay/core stays protocol-agnostic — OpenClaw consumes the
// same Tool definitions without taking a transitive runtime dep on the MCP
// SDK. Spec is stable: these four hints have been canonical since 2025-03-26.
//
// Per the spec: all properties are HINTS, not contracts. Clients use them to
// decide UX (auto-approve vs prompt) but must never make trust decisions on
// them alone.
export interface ToolAnnotations {
  // Short human-readable label for client UIs. Optional; falls back to name.
  title?: string;
  // True if the tool does not modify any state (calling it is a no-op for
  // observability purposes). Composites that only fetch are readOnly:true.
  readOnlyHint?: boolean;
  // True if the tool may perform an irreversible side-effect — mutates state
  // in a way that can't be cleanly undone. Sets readOnlyHint:false implicitly.
  destructiveHint?: boolean;
  // True if calling the same tool twice with the same arguments is safe and
  // produces the same observable outcome (no double-write side-effect).
  idempotentHint?: boolean;
  // True if the tool reaches outside the local process / context — typically
  // any tool that hits a remote API. False for self-contained calls (status
  // checks against in-memory state only).
  openWorldHint?: boolean;
}

export interface Tool<P = any, R = any> {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  // MCP-spec output shape (2025-11-25). When set, the MCP server sends a
  // matching `structuredContent` block on every successful call so the
  // client can consume the typed payload directly without re-parsing the
  // JSON-stringified text. Backwards-compat: text content stays even when
  // outputSchema is set; clients that don't read structuredContent see no
  // change.
  outputSchema?: JSONSchema;
  // MCP-spec annotations: hints for clients about read/write/idempotency
  // posture. Optional for backwards-compat — tools without annotations work
  // exactly as before; clients that don't read annotations ignore them.
  annotations?: ToolAnnotations;
  optional?: boolean;
  advanced?: boolean;
  // Mutates Leadbay state. MCP server gates these behind LEADBAY_MCP_WRITE=1.
  // OpenClaw exposes them when exposeWrite=true is set in plugin config.
  write?: boolean;
  // Per-tool semver — bumped when the tool's input/output contract changes.
  // Defaults to "0.1.0" if absent. Used by MIGRATION.md tracking.
  version?: string;
  execute: (client: LeadbayClient, params: P, ctx?: ToolContext) => Promise<R>;
}
