import type { LeadbayClient } from "../client.js";
import type {
  Tool,
  ToolContext,
  MonitorFilterItem,
  LeadWebFetchPayload,
  WebFetchEntry,
} from "../types.js";
import { withAgentMemoryMeta } from "../agent-memory/index.js";
import { reshapeWebFetchContent } from "./_web-fetch-helpers.js";
import { resolveLocations } from "./_geo-helpers.js";

import { leadbay_scan_portfolio_signals as SCAN_PORTFOLIO_SIGNALS_DESCRIPTION } from "../tool-descriptions.generated.js";

// Bulk portfolio signal scan. Reads CACHED web-research signals across a
// Monitor portfolio (or an explicit lead-id list) and returns only the leads
// whose signals match a free-text query — e.g. "M&A", "acquisition",
// "racheté". This is the read-only, no-quota counterpart to looping
// leadbay_research_lead_by_id one lead at a time.
//
// Hard invariant (issue #3704): the tool searches ONLY actual web_fetch
// content. It never infers signal presence/absence from freshness markers
// (stale_at / web_fetch_in_progress / fetch_at). Leads with no cached content
// land in `not_researched[]` — they are NOT silently treated as "no match".

const DEFAULT_MAX_LEADS = 200;
const HARD_MAX_LEADS = 300;
const MONITOR_PAGE_SIZE = 200; // backend cap for /monitor count

interface ScanPortfolioSignalsParams {
  query: string;
  leadIds?: string[];
  city?: string;
  city_id?: string;
  set_filter?: MonitorFilterItem;
  since?: string;
  max_leads?: number;
}

interface MatchedSignal {
  section_label: string;
  section_emoji: string | null;
  hot: boolean;
  source: string;
  date: string | null;
  description: string;
}

interface MatchedLead {
  lead_id: string;
  name: string | null;
  location: string | null;
  matched_signals: MatchedSignal[];
}

interface MonitorResponse {
  items?: any[];
  leads?: any[];
  pagination?: any;
  [k: string]: unknown;
}

// Diacritic-fold + lowercase so "racheté" matches query "rachat" and "M&A"
// matches "m&a". NFD splits accented chars into base + combining mark; we
// strip the marks (U+0300–U+036F).
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Split the query into OR terms on commas / whitespace, folded. Empty terms
// dropped. An all-whitespace query yields [] → matches nothing.
function parseQueryTerms(query: string): string[] {
  return query
    .split(/[,\s]+/)
    .map((t) => fold(t))
    .filter((t) => t.length > 0);
}

// Monitor leads carry `location` as either a plain string or an object
// ({city, state, country, full, pos}). Render a compact "City, State" (or the
// `full` string, or the bare string) for the place-card blocks — never the
// raw object or the `pos` coordinates.
function shortLocation(loc: unknown): string | null {
  if (loc == null) return null;
  if (typeof loc === "string") return loc.trim() || null;
  if (typeof loc === "object") {
    const o = loc as Record<string, unknown>;
    const clean = (v: unknown) => {
      const s = typeof v === "string" ? v.trim() : "";
      return s && s.toUpperCase() !== "N/A" ? s : "";
    };
    const city = clean(o.city);
    const state = clean(o.state);
    if (city && state) return `${city}, ${state}`;
    if (city) return city;
    if (typeof o.full === "string" && o.full.trim()) return o.full.trim();
  }
  return null;
}

function mergeLocationIds(
  filter: MonitorFilterItem | undefined,
  ids: string[]
): MonitorFilterItem {
  const criteria: Array<Record<string, unknown>> = filter?.criteria
    ? [...filter.criteria]
    : [];
  const idx = criteria.findIndex(
    (c) => c?.type === "location_ids" && c?.is_excluded === false
  );
  if (idx >= 0) {
    const cur = criteria[idx];
    const existing = Array.isArray(cur.locations)
      ? (cur.locations as string[])
      : [];
    const merged = Array.from(new Set([...existing, ...ids]));
    criteria[idx] = { ...cur, locations: merged };
  } else {
    criteria.push({ type: "location_ids", is_excluded: false, locations: ids });
  }
  return { criteria };
}

// Does this signal entry match any query term? Searches description, source,
// and the section label so "funding" matches a "📈 funding" section header too.
function entryMatches(
  entry: WebFetchEntry,
  sectionLabel: string,
  terms: string[]
): boolean {
  if (terms.length === 0) return false;
  const haystack = fold(
    [entry.description ?? "", entry.source ?? "", sectionLabel].join("  ")
  );
  return terms.some((t) => haystack.includes(t));
}

// Keep only entries on/after `since` (ISO date). Entries with no parseable
// date are KEPT — absence of a date is not evidence the event is old, and
// dropping them would silently hide real matches (issue #3704 honesty rule).
function passesSince(entry: WebFetchEntry, sinceMs: number | null): boolean {
  if (sinceMs == null) return true;
  if (!entry.date) return true;
  const ts = Date.parse(entry.date);
  if (Number.isNaN(ts)) return true;
  return ts >= sinceMs;
}

export const scanPortfolioSignals: Tool<ScanPortfolioSignalsParams> = {
  name: "leadbay_scan_portfolio_signals",
  annotations: {
    title: "Scan a portfolio for a web-research signal in bulk",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: SCAN_PORTFOLIO_SIGNALS_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Signal terms to match (case- and accent-insensitive). Comma- or space-separated terms are OR'd, e.g. 'M&A, acquisition, racheté'. Matched against each signal entry's description, source, and section label.",
      },
      leadIds: {
        type: "array",
        items: { type: "string" },
        description:
          "Explicit lead UUIDs to scan (skips Monitor pagination). Use when you already hold a cohort of ids.",
      },
      city: {
        type: "string",
        description:
          "Free-text city / region to scope the Monitor portfolio before scanning (resolved via /geo/search, same as leadbay_pull_followups). Ignored when `leadIds` is given.",
      },
      city_id: {
        type: "string",
        description:
          "Pre-resolved admin_area id (numeric string). Bypasses the resolver. Ignored when `leadIds` is given.",
      },
      set_filter: {
        type: "object",
        description:
          "Optional Monitor FilterItem ({criteria: FilterCriterion[]}) to scope the portfolio before scanning. Persisted server-side then applied, mirroring leadbay_pull_followups. Ignored when `leadIds` is given.",
        properties: {
          criteria: { type: "array", items: { type: "object" } },
        },
      },
      since: {
        type: "string",
        description:
          "ISO date (e.g. '2025-01-01'). When set, only signal entries dated on/after it are returned. Entries with no date are kept (absence of a date is not evidence the event is old).",
      },
      max_leads: {
        type: "number",
        description: `Cap on leads scanned (default ${DEFAULT_MAX_LEADS}, hard max ${HARD_MAX_LEADS}). When the portfolio exceeds this, the scan is truncated and truncated_at is set.`,
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      matched: {
        type: "array",
        description:
          "Leads with ≥1 signal entry matching the query. Each: {lead_id, name, location, matched_signals:[{section_label, section_emoji, hot, source, date, description}]}. Campaign-ready — feed lead_ids straight into leadbay_add_leads_to_campaign.",
        items: { type: "object" },
      },
      not_researched: {
        type: "array",
        description:
          "Leads scanned that had NO cached signal content (web_fetch.content null or still in progress). These are NOT 'no match' — they were never researched. Qualify them (leadbay_bulk_qualify_leads) then re-scan. Each: {lead_id, name}.",
        items: { type: "object" },
      },
      scanned_count: {
        type: "number",
        description: "Total leads read in this scan (matched + non-matching + not_researched).",
      },
      matched_count: { type: "number", description: "Length of `matched`." },
      truncated_at: {
        type: "number",
        description:
          "Present only when the portfolio exceeded `max_leads`; equals the cap applied. Coverage is partial — narrow the scope (city / set_filter) or raise max_leads.",
      },
      quota_exceeded: {
        type: "boolean",
        description:
          "True if a 429 was hit mid-scan. Partial `matched` is still returned. Offer wait-for-reset OR top-up.",
      },
      status: {
        type: "string",
        description:
          "`ambiguous_locations` when a passed `city` matched multiple admin_areas; pick an id from `location_ambiguities` and re-call with `city_id`. Absent on the happy path.",
      },
      location_ambiguities: {
        type: "array",
        description: "Only present when status === 'ambiguous_locations'.",
        items: { type: "object" },
      },
      _meta: {
        type: "object",
        properties: {
          region: { type: "string" },
          agent_memory: { type: "object" },
        },
      },
    },
    required: ["matched", "not_researched", "scanned_count", "matched_count", "quota_exceeded"],
  },
  execute: async (
    client: LeadbayClient,
    params: ScanPortfolioSignalsParams,
    ctx?: ToolContext
  ) => {
    const terms = parseQueryTerms(params.query ?? "");
    const maxLeads = Math.min(
      params.max_leads ?? DEFAULT_MAX_LEADS,
      HARD_MAX_LEADS
    );
    const sinceParsed = params.since ? Date.parse(params.since) : NaN;
    const sinceValid = Number.isNaN(sinceParsed) ? null : sinceParsed;

    // ── 1. Resolve scope → ordered list of {id, name, location} ────────────
    let portfolio: Array<{ id: string; name: string | null; location: string | null }>;
    let truncatedAt: number | undefined;
    // Set true by EITHER a 429 while paging /monitor (can't enumerate the
    // portfolio) OR a 429 while reading a lead's web_fetch. Honest signal that
    // coverage is partial because of a quota wall, never reported as "no
    // matches" (issue #3704).
    let quotaExceeded = false;

    if (params.leadIds && params.leadIds.length > 0) {
      const sliced = params.leadIds.slice(0, maxLeads);
      if (params.leadIds.length > maxLeads) truncatedAt = maxLeads;
      portfolio = sliced.map((id) => ({ id, name: null, location: null }));
    } else {
      // Geo / filter scope, then paginate /monitor (same store-then-apply
      // mechanism as leadbay_pull_followups).
      let effectiveSetFilter: MonitorFilterItem | undefined = params.set_filter;
      const geoTexts: string[] = [];
      if (params.city) geoTexts.push(params.city);
      if (params.city_id) geoTexts.push(params.city_id);
      if (geoTexts.length > 0) {
        const { resolved, ambiguities } = await resolveLocations(client, geoTexts);
        if (ambiguities.length > 0) {
          return withAgentMemoryMeta(
            client,
            {
              status: "ambiguous_locations" as const,
              location_ambiguities: ambiguities,
              matched: [],
              not_researched: [],
              scanned_count: 0,
              matched_count: 0,
              quota_exceeded: false,
              _meta: { region: client.region },
            },
            ctx
          );
        }
        if (resolved.length > 0) {
          effectiveSetFilter = mergeLocationIds(effectiveSetFilter, resolved);
        }
      }

      // Only request `filtered=true` if we actually stored the filter this
      // call. If the POST fails, sending `filtered=true` would scan against
      // whatever filter was previously persisted server-side — a stale,
      // convincing-but-wrong cohort with no visible error. On failure we fall
      // back to an UNfiltered scan (honest: wider, not silently-wrong) and
      // surface a 429 via quota_exceeded.
      let filterStored = false;
      if (effectiveSetFilter) {
        try {
          await client.requestVoid("POST", "/monitor/filter", effectiveSetFilter);
          filterStored = true;
        } catch (err: any) {
          if (err?.code === "QUOTA_EXCEEDED") quotaExceeded = true;
          ctx?.logger?.warn?.(
            `scan_portfolio_signals: POST /monitor/filter failed (${err?.code ?? err?.message ?? err}); scanning UNfiltered to avoid trusting a stale server-side filter`
          );
        }
      }

      portfolio = [];
      let page = 0;
      while (portfolio.length < maxLeads) {
        const qs = new URLSearchParams({
          personal: "false",
          liked: "false",
          filtered: String(filterStored),
          count: String(MONITOR_PAGE_SIZE),
          page: String(page),
        }).toString();
        let monitor: MonitorResponse;
        try {
          monitor = await client.request<MonitorResponse>("GET", `/monitor?${qs}`);
        } catch (err: any) {
          if (err?.code === "QUOTA_EXCEEDED") {
            // Couldn't finish paging the portfolio — surface what we have and
            // flag the quota wall so the agent reports "scan incomplete", not
            // "no matches".
            quotaExceeded = true;
            break;
          }
          throw err;
        }
        const rawLeads: any[] = Array.isArray(monitor.items)
          ? monitor.items
          : Array.isArray(monitor.leads)
            ? monitor.leads
            : Array.isArray(monitor)
              ? (monitor as unknown as any[])
              : [];
        if (rawLeads.length === 0) break;
        for (const lead of rawLeads) {
          if (portfolio.length >= maxLeads) break;
          portfolio.push({
            id: lead.id,
            name: lead.name ?? null,
            location: shortLocation(lead.location),
          });
        }
        const pages = monitor.pagination?.pages;
        if (typeof pages === "number" && page >= pages - 1) break;
        if (rawLeads.length < MONITOR_PAGE_SIZE) break;
        page += 1;
      }
      // If we filled the cap, the portfolio may have more leads behind it —
      // surface partial coverage. (Monitor's reported total isn't reliable
      // across backend versions, so we key off the cap hit.)
      if (portfolio.length >= maxLeads) truncatedAt = maxLeads;
    }

    // ── 2. Read-only fan-out: GET /leads/{id}/web_fetch (NO POST) ──────────
    // The client semaphore caps concurrency at 5; Promise.all is fine. We
    // catch per-lead (not Promise.allSettled-then-inspect) so a rejected read
    // still carries its `lead` — a failed read must land in not_researched
    // with the lead name intact, never silently vanish (issue #3704 honesty
    // invariant: scanned_count = matched + non-matching + not_researched).
    const matched: MatchedLead[] = [];
    const notResearched: Array<{ lead_id: string; name: string | null }> = [];

    const reads = await Promise.all(
      portfolio.map(async (lead) => {
        try {
          const wf = await client.request<LeadWebFetchPayload>(
            "GET",
            `/leads/${lead.id}/web_fetch`
          );
          return { lead, wf, error: null as any };
        } catch (error: any) {
          // Any read failure (404, 429, network) → we couldn't read signals
          // for this lead. Carry the lead through so it lands in
          // not_researched: honest "no data read", never a silent "no match".
          return { lead, wf: null, error };
        }
      })
    );

    for (const r of reads) {
      const { lead, wf, error } = r;
      if (error) {
        if (error?.code === "QUOTA_EXCEEDED") quotaExceeded = true;
        notResearched.push({ lead_id: lead.id, name: lead.name });
        continue;
      }
      const hasContent =
        wf && wf.content != null && wf.in_progress !== true && Object.keys(wf.content).length > 0;
      if (!hasContent) {
        notResearched.push({ lead_id: lead.id, name: lead.name });
        continue;
      }
      // Reshape + filter entries by query + since.
      const sections = reshapeWebFetchContent(wf.content as Record<string, unknown>);
      const matchedSignals: MatchedSignal[] = [];
      for (const sec of sections) {
        for (const entry of sec.entries) {
          if (!entryMatches(entry, sec.section_label, terms)) continue;
          if (!passesSince(entry, sinceValid)) continue;
          matchedSignals.push({
            section_label: sec.section_label,
            section_emoji: sec.section_emoji,
            hot: entry.hot === true,
            source: entry.source ?? "",
            date: entry.date ?? null,
            description: entry.description ?? "",
          });
        }
      }
      if (matchedSignals.length > 0) {
        matched.push({
          lead_id: lead.id,
          name: lead.name,
          location: lead.location,
          matched_signals: matchedSignals,
        });
      }
    }

    const out: Record<string, unknown> = {
      matched,
      not_researched: notResearched,
      scanned_count: portfolio.length,
      matched_count: matched.length,
      quota_exceeded: quotaExceeded,
      _meta: { region: client.region },
    };
    if (truncatedAt !== undefined) out.truncated_at = truncatedAt;

    return withAgentMemoryMeta(client, out, ctx);
  },
};
