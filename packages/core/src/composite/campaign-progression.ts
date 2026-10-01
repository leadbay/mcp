/**
 * leadbay_campaign_progression — GET /campaigns/{id}/leads (paginated)
 *
 * Returns per-lead progress + affiliation. This is the "what stage is
 * each lead at" view that managers use for #3630 US3 follow-up
 * governance. Each row has:
 *   - lead: full LeadPayload (contacts, score, state, ai_summary)
 *   - progress: {total_contacts, in_progress, declined, headline} —
 *     the per-lead campaign roll-up (reachable contacts, conversations
 *     still active, declined, last interaction type). `total_contacts`
 *     is contact coverage, not outreach history.
 *   - affiliation: {own_campaigns, other_users_campaign_count} —
 *     overlap detection across the user's own campaigns AND visibility
 *     into how many teammates also have this lead in their campaigns.
 *
 * The `summary` block is the WHOLE campaign, not the page in `items`
 * (mcp#276): when the campaign spans more than one page the tool reads
 * the other pages too, at the same `count`, and counts each lead once.
 * `summary_coverage` says what the counts cover. `complete` is strict:
 * every page read echoes the page that was asked for as a whole number
 * and agrees on `pages` and `total`, every page was read, every lead
 * has an id, and the leads counted equal the campaign's total. Page
 * information the backend sends as text, null or a decimal is echoed
 * as null, so the envelope always matches the schema. Anything less
 * than complete is reported, never guessed.
 */
import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";

import { leadbay_campaign_progression as CAMPAIGN_PROGRESSION_DESCRIPTION } from "../tool-descriptions.generated.js";

interface ProgressionParams {
  campaign_id: string;
  count?: number;
  page?: number;
}

interface ProgressionRow {
  lead: { id?: unknown } & Record<string, unknown>;
  progress: {
    total_contacts: number;
    in_progress: number;
    declined: number;
    headline: string | null;
  };
  affiliation: {
    own_campaigns: Array<{ id: string; name: string }>;
    other_users_campaign_count: number;
  };
}

interface Pagination {
  page?: unknown;
  pages?: unknown;
  total?: unknown;
}

interface PaginatedLeadsResponse {
  items?: unknown;
  pagination?: unknown;
}

// Pages read in one call, the requested page included. Bounds the read on a
// large campaign; past it `summary_coverage.complete` is false and `leads`
// says how many the counts cover. The lead figure this reaches depends on
// `count`, so nothing downstream promises one.
const SUMMARY_MAX_PAGES = 20;

function hasOutreachSignal(progress: ProgressionRow["progress"] | undefined): boolean {
  if (!progress) return false;
  return Boolean(
    progress.headline ||
      (progress.in_progress ?? 0) > 0 ||
      (progress.declined ?? 0) > 0,
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A page number or total is trusted only as a whole, non-negative number.
// A decimal, a string or a missing value is "unknown": it never drives a
// read and it never lets the coverage be called complete.
function asInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

// The three page numbers of one response, each a whole number or null. This
// is also the shape `pagination` is echoed in, so text, null or a decimal from
// the backend never lands in the envelope.
function readPagination(value: unknown): { page: number | null; pages: number | null; total: number | null } {
  const raw = isPlainObject(value) ? (value as Pagination) : null;
  return {
    page: asInteger(raw?.page),
    pages: asInteger(raw?.pages),
    total: asInteger(raw?.total),
  };
}

// Counts leads, not rows: a lead that lands on two pages — inserted or removed
// between reads — is counted once. A row without an id is counted too, but it
// cannot be told apart from another, so it keeps the coverage from being
// called complete.
function newTally() {
  const seen = new Set<string>();
  const tally = {
    leads: 0,
    unidentified: 0,
    contacted: 0,
    in_progress: 0,
    declined: 0,
    add(rows: unknown[]) {
      for (const raw of rows) {
        const row = isPlainObject(raw) ? (raw as unknown as ProgressionRow) : undefined;
        const id = row?.lead?.id;
        if (typeof id === "string" && id.length > 0) {
          if (seen.has(id)) continue;
          seen.add(id);
        } else {
          tally.unidentified++;
        }
        tally.leads++;
        const p = row?.progress;
        if (hasOutreachSignal(p)) tally.contacted++;
        if ((p?.in_progress ?? 0) > 0) tally.in_progress++;
        if ((p?.declined ?? 0) > 0) tally.declined++;
      }
    },
  };
  return tally;
}

export const campaignProgression: Tool<ProgressionParams> = {
  name: "leadbay_campaign_progression",
  annotations: {
    title: "Read per-lead progression inside a campaign",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  description: CAMPAIGN_PROGRESSION_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      campaign_id: {
        type: "string",
        description: "Campaign UUID (from leadbay_create_campaign or leadbay_list_campaigns).",
      },
      count: { type: "number", description: "Leads per page (default 50, server-capped)." },
      page: { type: "number", description: "0-indexed page (default 0)." },
    },
    required: ["campaign_id"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        description:
          "Per-lead progression rows for THIS page: {lead, progress: {total_contacts, in_progress, declined, headline}, affiliation: {own_campaigns, other_users_campaign_count}}. `headline` is the most recent interaction type (e.g. CONTACTED, MEETING_BOOKED, DECLINED).",
        items: { type: "object" },
      },
      pagination: {
        type: "object",
        description:
          "The backend's `{page, pages, total}` for the requested page. Each is a whole number, or null when the backend's value was missing, text or not a whole number.",
        properties: {
          page: { type: ["number", "null"] },
          pages: { type: ["number", "null"] },
          total: { type: ["number", "null"] },
        },
        required: ["page", "pages", "total"],
      },
      summary: {
        type: "object",
        description:
          "Counted across the WHOLE campaign, not this page: when the campaign has more than one page the tool reads the other pages too (at most 20 pages in one call, at the requested `count`) and counts each lead once; `summary_coverage.complete` is false when it could not read them all. `contacted` = leads with a headline, an open conversation or a decline; `in_progress` = leads with at least one open conversation; `declined` = leads with a recorded decline. `page_size` is the row count of `items` — this page only. `summary_coverage` says what the three counts cover.",
        properties: {
          page_size: { type: "number" },
          contacted: { type: "number" },
          in_progress: { type: "number" },
          declined: { type: "number" },
        },
        required: ["page_size", "contacted", "in_progress", "declined"],
      },
      summary_coverage: {
        type: "object",
        description:
          "What `summary` covers. `leads` = leads counted. `total_leads` = the campaign's size from `pagination.total`, or null when the response carried no usable total (then say \"<leads> leads counted; campaign size unknown\"). `complete` = true only when every page was read and `leads` equals `total_leads`; it is false when the campaign has more pages than one call reads, when a page could not be read, when any page read has a page number that is missing, not a whole number or not the page that was asked for, when a later page reported a different total or page count, when a lead had no id, or when the leads counted differ from the total. When false, say \"<leads> of <total_leads> leads counted\" — or, if `leads` is greater than `total_leads`, \"<leads> leads counted; the campaign reported <total_leads>\" — and never present the counts as the whole campaign.",
        properties: {
          leads: { type: "number" },
          total_leads: { type: ["number", "null"] },
          complete: { type: "boolean" },
        },
        required: ["leads", "total_leads", "complete"],
      },
      _meta: {
        type: "object",
        properties: {
          region: { type: "string" },
          latency_ms: { type: ["number", "null"] },
        },
      },
    },
    required: ["items", "pagination", "summary", "summary_coverage"],
  },
  execute: async (client: LeadbayClient, params: ProgressionParams, ctx?: ToolContext) => {
    // Hosts send "1" for a number and the server leaves scalars alone, so both
    // knobs are read as whole numbers here: the page number is compared with
    // the backend's echo below, and "1" === 1 would wrongly read as a mismatch.
    const count = asInteger(Number(params.count ?? 50)) ?? 50;
    const page = asInteger(Number(params.page ?? 0)) ?? 0;
    const leadsPath = (p: number) =>
      `/campaigns/${params.campaign_id}/leads?count=${count}&page=${p}`;

    const result = await client.request<PaginatedLeadsResponse>("GET", leadsPath(page));
    const items = Array.isArray(result?.items) ? result.items : [];
    const first = readPagination(result?.pagination);
    // The page in hand, so it is not fetched twice: the backend's echo when it
    // is a whole number, else the page that was asked for.
    const currentPage = first.page ?? page;
    // Every page read, this one included, must echo the page that was asked
    // for as a whole number and carry whole `pages` and `total`; the later
    // pages must also agree with this one. Anything else keeps the coverage
    // from being called complete.
    let pageNumbersTrusted = first.page === page && first.pages !== null && first.total !== null;

    const tally = newTally();
    tally.add(items);

    // Every other page, in order, at the same `count` so page boundaries line
    // up and the page already in hand is not fetched twice. A requested page
    // past the end contributes no rows, so every real page is read. The read
    // is sequential and bounded. A failure on a page the user did not ask for
    // ends the read and is reported through `complete`, never thrown: a 429
    // here would otherwise reach the agent as QUOTA_EXCEEDED, whose hint
    // offers a credit top-up. A cancellation is re-thrown.
    let pagesRead = 1;
    let everyPageRead = first.pages !== null;
    for (let p = 0; first.pages !== null && p < first.pages; p++) {
      if (p === currentPage) continue;
      if (pagesRead >= SUMMARY_MAX_PAGES) {
        everyPageRead = false;
        break;
      }
      let extra: PaginatedLeadsResponse;
      try {
        extra = await client.request<PaginatedLeadsResponse>("GET", leadsPath(p));
      } catch (err: any) {
        if (err?.name === "AbortError") throw err;
        ctx?.logger?.warn?.(
          `campaign-progression: page ${p} of ${first.pages} for ${params.campaign_id} failed ` +
            `(${err?.code ?? err?.message ?? "unknown error"}); summary covers ${tally.leads} leads`,
        );
        everyPageRead = false;
        break;
      }
      pagesRead++;
      tally.add(Array.isArray(extra?.items) ? extra.items : []);
      // The same checks on every later page: it must echo the page that was
      // asked for, and report the same total and page count as the first —
      // a difference means the campaign changed while it was being read. The
      // counts are still returned, but not as complete.
      const later = readPagination(extra?.pagination);
      if (later.page !== p || later.pages !== first.pages || later.total !== first.total) {
        pageNumbersTrusted = false;
      }
    }

    const complete =
      pageNumbersTrusted &&
      everyPageRead &&
      tally.unidentified === 0 &&
      tally.leads === first.total;

    return {
      items,
      pagination: { page: first.page, pages: first.pages, total: first.total },
      summary: {
        page_size: items.length,
        contacted: tally.contacted,
        in_progress: tally.in_progress,
        declined: tally.declined,
      },
      summary_coverage: {
        leads: tally.leads,
        total_leads: first.total,
        complete,
      },
      _meta: {
        region: client.region,
        latency_ms: client.lastMeta?.latency_ms ?? null,
      },
    };
  },
};
