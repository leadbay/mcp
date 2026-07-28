// Shared plumbing for the MCP-first lead-delivery jobs
// (POST /mcp/search, POST /mcp/qualify, GET /mcp/jobs/{id}).
//
// Both submit verbs answer 202 + a job handle; results are polled
// cumulatively from /mcp/jobs/{id} with an opaque `since` cursor. The
// backend caps poll pages at 100 items, while a qualify job can carry up
// to 500 refs — so a snapshot collects pages until the cursor drains.
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
const MAX_PAGES = 20; // 500-ref qualify worst case is 5 pages; 20 is a hard stop.

/** One cumulative snapshot of the job, paging the item cursor dry. Job/funnel/
 *  cost/explain come from the LAST page fetched (the freshest projection). */
export async function collectJobSnapshot(
  client: LeadbayClient,
  jobId: string,
  since?: string,
  limit?: number
): Promise<McpJobSnapshot> {
  const pageLimit = Math.min(Math.max(limit ?? PAGE_LIMIT, 1), PAGE_LIMIT);
  const qs = (cursor?: string) =>
    `/mcp/jobs/${jobId}?limit=${pageLimit}` +
    (cursor ? `&since=${encodeURIComponent(cursor)}` : "");
  let page = await client.request<McpJobSnapshot>("GET", qs(since));
  const items = [...page.items];
  let pages = 1;
  while (
    page.items.length >= pageLimit &&
    page.next_since &&
    pages < MAX_PAGES
  ) {
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
      break;
    }
  }
  return { ...page, items };
}

/** Poll until the job is terminal or `waitSeconds` elapse (0 = single poll).
 *  Fires ctx.progress per poll and respects ctx.signal cancellation. */
export async function waitForJob(
  client: LeadbayClient,
  jobId: string,
  waitSeconds: number,
  ctx?: ToolContext,
  itemsRequested?: number
): Promise<McpJobSnapshot> {
  const startedAt = Date.now();
  let snap = await collectJobSnapshot(client, jobId);
  while (
    !TERMINAL_JOB_STATES.has(snap.job.state) &&
    (Date.now() - startedAt) / 1000 < waitSeconds &&
    !ctx?.signal?.aborted
  ) {
    await new Promise((resolve) =>
      setTimeout(resolve, MCP_JOB_POLL.intervalMs)
    );
    if (ctx?.signal?.aborted) break;
    snap = await collectJobSnapshot(client, jobId);
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

export function clampWaitSeconds(
  requested: number | undefined,
  fallback: number
): number {
  if (requested == null || Number.isNaN(requested)) return fallback;
  return Math.min(Math.max(requested, 0), 180);
}
