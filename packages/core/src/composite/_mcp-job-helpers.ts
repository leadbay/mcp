// Shared plumbing for the MCP-first lead-delivery jobs
// (POST /mcp/search, POST /mcp/qualify, GET /mcp/jobs/{id}).
//
// Both submit verbs answer 202 + a job handle; results are polled
// cumulatively from /mcp/jobs/{id} with an opaque `since` cursor. The
// backend caps poll pages at 100 items, while a qualify job can carry up
// to 500 refs — so a snapshot collects pages until the cursor drains.
import { createHash } from "node:crypto";
import type { LeadbayClient } from "../client.js";
import type { ToolContext } from "../types.js";

// ---------------------------------------------------------------------------
// Wire types (backend McpPayloads.kt, snake_case on the wire)
// ---------------------------------------------------------------------------

export interface McpSubmitResponse {
  job_id: string;
  status_url: string;
  estimated_cost: { max: number; unit: string };
  items_requested: number;
  duplicate?: boolean;
}

export interface McpDryRunResponse {
  valid: boolean;
  items_requested: number;
  estimated_cost: { max: number; unit: string };
  quota_forecast: {
    web_fetch_allowed: boolean;
    rescore_allowed: boolean;
    enrichment_allowed: boolean;
  };
}

export interface McpFunnel {
  matched?: number;
  novel?: number;
  title_gate_passed?: number;
  examined?: number;
  qualified?: number;
  disqualified?: number;
  unqualifiable?: number;
  delivered?: number;
  delivered_callable?: number;
  delivered_title_only?: number;
  degraded?: number;
  resolved?: number | null;
  not_in_universe?: number | null;
  pending_import?: number | null;
  unauthorized?: number | null;
  stop_reason?: string | null;
}

export interface McpJobItem {
  ref?: {
    input_indexes?: number[] | null;
    lead_id?: string | null;
    requested_as?: Record<string, unknown> | null;
  } | null;
  status: "delivered" | "degraded" | "skipped";
  status_reason?: string | null;
  resolution?: Record<string, unknown> | null;
  contact_known?: boolean | null;
  from_cache?: Record<string, boolean> | null;
  cost?: { billed: number; unit: string; breakdown?: Record<string, number> } | null;
  completed_at?: string | null;
  seq: number;
  // Full QualifiedLead payload (company / fit / web_research / contact /
  // alternative_contacts / novelty / engagement) — relayed verbatim so the
  // agent renders from rich signal without follow-up calls.
  lead?: Record<string, any> | null;
}

export interface McpJobSnapshot {
  job: {
    id: string;
    state:
      | "queued"
      | "running"
      | "completed"
      | "completed_partial"
      | "failed"
      | "expired";
    submitted_at: string;
    completed_at?: string | null;
    expires_at: string;
    last_progress_at: string;
  };
  funnel: McpFunnel;
  items: McpJobItem[];
  next_since?: string | null;
  cost: {
    spent: number;
    unit: string;
    breakdown: Record<string, number>;
  };
  explain: {
    region: string;
    model: string;
    basis?: string | null;
    seed_strategy?: string | null;
    universe_size?: number | null;
    filters_applied?: Record<string, unknown> | null;
    intelligence_snapshot?: Record<string, unknown> | null;
    scope_notes?: string[];
  };
}

export const TERMINAL_JOB_STATES: ReadonlySet<string> = new Set([
  "completed",
  "completed_partial",
  "failed",
  "expired",
]);

// Poll cadence seam — tests shrink this so wait loops don't sleep for real.
export const MCP_JOB_POLL = { intervalMs: 4000 };

const PAGE_LIMIT = 100;
// A qualify job carries at most 500 refs, so the drain is bounded by the page
// SIZE, not by a flat page count: at limit=5 the worst case is 100 pages, and a
// flat 20 would silently return the first 100 items while reporting done:true.
// Derive the bound instead, with a floor so a large page size still gets a few
// follow-ups and a ceiling that stays a runaway backstop.
const MAX_JOB_ITEMS = 500;
const MIN_PAGES = 20;
// The bound must let EVERY allowed page size reach MAX_JOB_ITEMS — at limit=1
// that is 500 pages, and a lower flat cap would return a partial batch while
// still reporting done:true, with no cursor on a terminal submit response to
// fetch the rest. Capping below the drain would hide items, not just slow them.
const maxPagesFor = (pageLimit: number) =>
  Math.max(MIN_PAGES, Math.ceil(MAX_JOB_ITEMS / pageLimit) + 1);

/** One cumulative snapshot of the job, paging the item cursor dry. Job/funnel/
 *  cost/explain come from the LAST page fetched (the freshest projection). */
export async function collectJobSnapshot(
  client: LeadbayClient,
  jobId: string,
  since?: string,
  limit?: number
): Promise<McpJobSnapshot> {
  const pageLimit = Math.min(Math.max(limit ?? PAGE_LIMIT, 1), PAGE_LIMIT);
  // Escape the handle: job_id comes straight from user/agent input and the
  // server does not validate schemas before dispatch, so an unescaped value
  // containing path separators (`../../users/me`) would normalize out of
  // /mcp/jobs and fire an AUTHENTICATED GET at an unintended endpoint.
  const safeJobId = encodeURIComponent(jobId);
  const qs = (cursor?: string) =>
    `/mcp/jobs/${safeJobId}?limit=${pageLimit}` +
    (cursor ? `&since=${encodeURIComponent(cursor)}` : "");
  const maxPages = maxPagesFor(pageLimit);
  let page = await client.request<McpJobSnapshot>("GET", qs(since));
  const items = [...page.items];
  // The resumption cursor must survive an empty drain page. Following
  // next_since into a page with no items used to overwrite the cursor with that
  // empty page's (often null) next_since, so a caller that had just received a
  // full page lost its place and had to re-read everything it had already seen.
  // Fall back to the cursor the CALLER passed in: an incremental poll of a
  // running job legitimately returns items:[] with no next_since, and dropping
  // to null there would make the next poll a full re-read.
  let cursor = page.next_since ?? since ?? null;
  let pages = 1;
  // A FULL page is the drain signal, not the cursor alone. `next_since` is a
  // resumption handle the backend returns on every snapshot — including a
  // completed job with a short page — so following it whenever it is set adds
  // a wasted round-trip to every terminal poll. A short page means the cursor
  // is caught up; the caller keeps next_since for the next incremental poll.
  while (page.items.length >= pageLimit && page.next_since && pages < maxPages) {
    const next = await client.request<McpJobSnapshot>(
      "GET",
      qs(page.next_since)
    );
    items.push(...next.items);
    pages += 1;
    // Always adopt the newest page — its job/funnel/cost projection is the
    // freshest even when it carried no new items.
    page = next;
    if (next.items.length === 0) {
      // Keep the cursor from the last page that actually carried items.
      break;
    }
    cursor = next.next_since ?? cursor;
  }
  return { ...page, items, next_since: cursor };
}

/** Poll until the job is terminal or `waitSeconds` elapse (0 = single poll).
 *  Fires ctx.progress per poll and respects ctx.signal cancellation.
 *  `since`/`limit` are forwarded to every snapshot so a caller that block-waits
 *  WITH a cursor still gets incremental pages — dropping them silently turned
 *  an incremental poll into a full re-read of already-seen items. */
export async function waitForJob(
  client: LeadbayClient,
  jobId: string,
  waitSeconds: number,
  ctx?: ToolContext,
  itemsRequested?: number,
  since?: string,
  limit?: number
): Promise<McpJobSnapshot> {
  const startedAt = Date.now();
  let snap = await collectJobSnapshot(client, jobId, since, limit);
  while (
    !TERMINAL_JOB_STATES.has(snap.job.state) &&
    (Date.now() - startedAt) / 1000 < waitSeconds &&
    !ctx?.signal?.aborted
  ) {
    // Never sleep past the caller's deadline: a wait_seconds:1 request must not
    // block for a full 4s interval, and no request should overrun its advertised
    // bound by most of an interval (MCP clients time calls out).
    const remainingMs = waitSeconds * 1000 - (Date.now() - startedAt);
    if (remainingMs <= 0) break;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(MCP_JOB_POLL.intervalMs, remainingMs))
    );
    if (ctx?.signal?.aborted) break;
    snap = await collectJobSnapshot(client, jobId, since, limit);
    const f = snap.funnel;
    ctx?.progress?.({
      progress: f.delivered ?? 0,
      total: itemsRequested,
      message: `${snap.job.state}: ${f.examined ?? 0} examined, ${
        f.delivered ?? 0
      } delivered, ${snap.cost.spent}c spent`,
    });
  }
  return snap;
}

/** Canonicalize a SET-valued list for hashing: sorted AND de-duplicated.
 *  Every list the backend treats as a set (sectors, locations, channels,
 *  contact_titles, exclude_lead_ids, refs) must go through this — sorting
 *  alone leaves `["Dallas","Dallas"]` and `["Dallas"]` hashing differently
 *  even though they request identical work, so a retry that happens to dedupe
 *  presents a new key and re-launches a paid job. */
export function canonicalSet(values: unknown): unknown[] {
  // The server does not validate inputSchema before dispatch, so a set-shaped
  // field can arrive as a bare scalar (`channels: "email"`). Wrap it instead
  // of calling .map on a string — that threw a TypeError while DERIVING the
  // key, i.e. before the caller even saw a quote.
  const list =
    values === undefined || values === null
      ? []
      : Array.isArray(values)
        ? values
        : [values];
  return [...new Set(list.map((v) => JSON.stringify(v)))]
    .sort()
    .map((v) => JSON.parse(v));
}

/** Coerce the array-typed params of a job tool into arrays, ONCE, before any
 *  other code touches them.
 *
 *  The MCP server does not validate `inputSchema` before dispatch, so an agent
 *  can send any array field in its natural singular form — `channels: "email"`,
 *  `contact_titles: "Owner"`, `lead_refs: {website: "acme.com"}`. Every site
 *  that later does `.map` / `.join` / `.length` on those then throws a
 *  TypeError, and on the paid path that happens BEFORE the spend gate, so the
 *  caller gets a crash instead of the promised quote.
 *
 *  Normalizing at the entry point fixes the whole class at once, rather than
 *  hardening each consumer separately. Non-array, non-null values are wrapped;
 *  null/undefined are left alone so `?? []` defaults still apply. */
export function coerceArrayParams<T extends Record<string, any>>(
  params: T,
  keys: readonly (keyof T)[]
): T {
  const out = { ...params };
  for (const key of keys) {
    const v = out[key];
    if (v !== undefined && v !== null && !Array.isArray(v)) {
      out[key] = [v] as T[keyof T];
    }
  }
  return out;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lower-case a UUID-shaped id so casing alone never forks an idempotency
 *  key — the backend resolves `A1B2…` and `a1b2…` to the same record. A value
 *  that is not UUID-shaped is only trimmed, since we cannot assume the backend
 *  folds case for arbitrary identifiers. */
/** A caller can fill a schema-`required` string with `""` — the server does not
 *  validate schemas before dispatch. `??` treats that as an explicit value, so a
 *  blank id would ship AS the idempotency key: if the backend reads blank as
 *  absent, a timeout retry launches a second paid job; if it reads blank as a
 *  key, unrelated blank-key approvals dedupe onto each other. Blank is missing. */
export function presentRequestId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** True when a value is shaped like a Leadbay UUID. Lets a caller tell a
 *  lead id apart from a website or a company name in an untyped ref. */
export function isUuidShaped(value: unknown): boolean {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

export function normalizeUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  return UUID_RE.test(v) ? v.toLowerCase() : v;
}

/** Canonicalize a set of ids: UUID-folded, then sorted + deduped. */
export function canonicalIdSet(values: unknown): string[] {
  const list =
    values === undefined || values === null
      ? []
      : Array.isArray(values)
        ? values
        : [values];
  return canonicalSet(
    list.map(normalizeUuid).filter((v): v is string => !!v)
  ) as string[];
}

/** Canonicalize a set of free-text labels (contact titles, sectors): trimmed
 *  and lower-cased before dedupe, because the backend matches them
 *  semantically. `["Owner"]` and `["owner "]` request identical work, so a
 *  retry that re-cased them must not derive a new key and re-spend. */
export function canonicalLabelSet(values: unknown): string[] {
  const list =
    values === undefined || values === null
      ? []
      : Array.isArray(values)
        ? values
        : [values];
  return canonicalSet(
    list
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
  ) as string[];
}

/** Collapse the several shapes that all mean "nothing specified" to one.
 *  An omitted `filters`, `{}`, and `{locations: []}` request the same search,
 *  so they must hash identically or a retry that materializes an empty object
 *  launches a second paid job. */
export function canonicalOptionalObject(
  value: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!value) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return Object.keys(out).length === 0 ? null : out;
}

/** Recursively canonicalize a value for hashing: object keys sorted at every
 *  depth so property ORDER never forks a key, arrays left in place (order can
 *  be meaningful — callers pass set-shaped lists through canonicalSet). Plain
 *  JSON.stringify is not enough: an agent that rebuilds `example_lead` or
 *  `filters` with the properties in a different order would otherwise derive a
 *  different key for the same approved search and re-launch a paid job. */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canonicalize((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** Stable idempotency key derived from an approved batch's own shape.
 *  SHA-256 truncated to 128 bits — a 32-bit digest collided in practice, and a
 *  collision here redirects one paid approval onto a different job. Nothing
 *  time-based goes into `shape`: a retry of the same approval must dedupe even
 *  if it lands the next day. */
export function derivedKey(prefix: string, shape: unknown): string {
  // Canonicalize HERE rather than at each call site, so neither tool can
  // regress by hashing a hand-built string again.
  const serialized =
    typeof shape === "string" ? shape : JSON.stringify(canonicalize(shape));
  return `${prefix}-${createHash("sha256").update(serialized).digest("hex").slice(0, 32)}`;
}

/** LEADBAY_MOCK=1 journals writes and answers the generic
 *  `{mocked, would_call}` envelope instead of a real `{job_id}`. Without a
 *  guard the submit falls through to polling `/mcp/jobs/undefined`, which has
 *  no fixture — so the repo's offline dry-run mode died on any non-dry_run
 *  call. Return the write preview instead. */
export function mockedSubmitPreview(
  submit: unknown,
  tool: string,
  region: string
): Record<string, unknown> | null {
  const s = (submit ?? {}) as Record<string, unknown>;
  if (typeof s.job_id === "string" && s.job_id) return null;
  // Only claim "mocked" when mock mode is actually on. A REAL 2xx submit that
  // came back without a job_id (backend contract drift, a proxy eating the
  // body) must fail loudly: reporting a successful no-submit envelope would
  // hide a production job the client cannot poll, and would tell the user
  // LEADBAY_MOCK=1 when it is not set.
  if (process.env.LEADBAY_MOCK !== "1") {
    throw {
      error: true,
      code: "MALFORMED_SUBMIT_RESPONSE",
      message: `${tool}: the submit succeeded but the response carried no job_id, so the job cannot be polled.`,
      hint: "The job may still be running server-side. Do not re-submit blindly — reuse the same request_id so a retry dedupes instead of double-spending.",
    };
  }
  return {
    mocked: true,
    tool,
    submitted: false,
    would_call: s.would_call ?? null,
    note: "LEADBAY_MOCK=1 — the job was not submitted, so there is no job to poll.",
    region,
  };
}

/** Sort a snapshot's items into the envelope every delivery tool returns:
 *  full leads for delivered/degraded, compact skip records for the rest. */
export function splitItems(snapshot: McpJobSnapshot): {
  leads: McpJobItem[];
  skipped: McpJobItem[];
} {
  const leads: McpJobItem[] = [];
  const skipped: McpJobItem[] = [];
  for (const item of snapshot.items) {
    if (item.status === "skipped") skipped.push(item);
    else leads.push(item);
  }
  return { leads, skipped };
}

/** Drop undefined values so the wire body only carries what the caller set
 *  (backend uses explicitNulls=false; absent and null are equivalent). */
export function compactBody(
  body: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(body).filter(([, v]) => v !== undefined)
  );
}

/** Country-level location values are silently useless: the backend excludes
 *  countries from admin-area search (product#3885), so the trigram resolver
 *  falls through to an arbitrary same-named town ("France" → the commune of
 *  Francs; "United States" → Statesboro) and the whole job is fenced to one
 *  village. In live E2E evals 4/4 agents passed a country label despite the
 *  description saying not to — prose does not prevent this, so the tool
 *  rejects it with a named, actionable error (tracked backend-side in
 *  product#3939). */
const COUNTRY_LOCATION_VALUES = new Set([
  "united states", "united states of america", "usa", "us", "america",
  "etats unis", "etats unis d amerique", "france", "fr", "french republic",
  "republique francaise",
]);

/** Fold a location label to a comparison key so spelling variants collapse:
 *  strips accents, punctuation (so `U.S.` and `U.S` both become `us`), a
 *  leading article (`the United States`, `la France`, `les États-Unis`), and
 *  collapses whitespace. Exact-matching the raw string let every one of those
 *  through to the silent same-named-town fencing this guard exists to stop. */
function countryKey(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Hyphens/underscores separate words; dots and apostrophes do not (so
    // "U.S" folds to "us", while "etats-unis" stays two words).
    .replace(/[-_,]/g, " ")
    .replace(/['’.]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    // Longest article first, so "les" is never matched as "le" + leftover.
    .replace(/^(les|the|la|le|l)\s+/, "")
    .trim();
}

export function rejectCountryLocations(locations: unknown): void {
  if (locations === undefined || locations === null) return;
  // The server does not validate the schema before dispatch, so an agent can
  // send `filters.locations` as a bare string. Treating a non-array as "no
  // locations" let a scalar "United States" sail past the guard and reach the
  // backend, reintroducing exactly the silent same-named-town fencing this
  // exists to stop. Normalize to a one-item list instead of returning.
  const list = Array.isArray(locations) ? locations : [locations];
  for (const loc of list) {
    if (typeof loc === "string" && COUNTRY_LOCATION_VALUES.has(countryKey(loc))) {
      throw {
        error: true,
        code: "COUNTRY_LEVEL_LOCATION",
        message: `filters.locations value "${loc}" is country-level — it would silently fence the search to a same-named town, not the whole country.`,
        hint: "Whole-country intent = OMIT filters.locations entirely (each universe is single-country). Use city/state/region names for narrower fences.",
      };
    }
  }
}

/** Tolerant reader for the search `filters` object. The RESULT payload's
 *  company shape (`employees: {min, max, known}`) teaches agents a nested
 *  employees object, and in live evals 2/2 cold agents passed exactly that
 *  on input — which the backend rejects with an unhelpful deserialization
 *  400. Map it (and the camelCase spellings) onto the flat wire keys
 *  instead of failing the whole ask. */
export function normalizeSearchFilters(
  filters: Record<string, any> | undefined
): Record<string, unknown> | undefined {
  if (filters == null) return undefined;
  const { employees, employeesMin, employeesMax, ...rest } = filters;
  const out: Record<string, unknown> = { ...rest };
  if (out.employees_min == null) {
    out.employees_min = employees?.min ?? employees?.employees_min ?? employeesMin;
  }
  if (out.employees_max == null) {
    out.employees_max = employees?.max ?? employees?.employees_max ?? employeesMax;
  }
  if (out.employees_min == null) delete out.employees_min;
  if (out.employees_max == null) delete out.employees_max;
  // The server does not validate inputSchema before dispatch, so an agent can
  // send `locations: "Dallas"` where the backend expects an array. Wrap a bare
  // string in a one-item list — the same tolerance rejectCountryLocations
  // already applies — instead of forwarding a scalar that 400s on
  // deserialization.
  for (const key of ["sectors", "locations"]) {
    const v = out[key];
    if (typeof v === "string") out[key] = v.trim() ? [v] : undefined;
    if (out[key] === undefined) delete out[key];
  }
  return out;
}

export function clampWaitSeconds(
  requested: number | undefined,
  fallback: number
): number {
  if (requested == null || Number.isNaN(requested)) return fallback;
  return Math.min(Math.max(requested, 0), 180);
}
