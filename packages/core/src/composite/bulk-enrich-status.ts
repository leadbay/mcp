import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";
import { getContacts } from "../tools/get-contacts.js";
import { isValidBulkId, type BulkRecord } from "../jobs/bulk-store.js";

interface BulkEnrichStatusParams {
  bulk_id: string;
  include_contacts?: boolean;
}

// Keep concurrency in step with LeadbayClient.MAX_CONCURRENT (client.ts:17).
// Client semaphore is the real rate limit; composite concurrency above the cap
// is cosmetic and starves other tools.
const STATUS_FETCH_CONCURRENCY = 5;

async function pMap<T, R>(
  items: T[],
  fn: (item: T, idx: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return out;
}

export const bulkEnrichStatus: Tool<BulkEnrichStatusParams> = {
  name: "leadbay_bulk_enrich_status",
  description:
    "Check status + per-lead contacts for a bulk enrichment you previously launched via leadbay_enrich_titles. " +
    "Returns the bulk_id, progress per lead (done/total enrichable contacts), and overall progress. " +
    "When include_contacts=true (opt-in), includes each contact's email/phone/job_title/enrichment.done. " +
    "When to use: poll this after leadbay_enrich_titles returns a bulk_id. Default include_contacts=false for cheap " +
    "status polls; set include_contacts=true once all_done flips for the final read. " +
    "When NOT to use: as a substitute for leadbay_research_lead — that already includes enriched contacts for a single lead.",
  inputSchema: {
    type: "object",
    properties: {
      bulk_id: {
        type: "string",
        description:
          "UUIDv4 returned by leadbay_enrich_titles at launch time. Required.",
      },
      include_contacts: {
        type: "boolean",
        description:
          "If true, return the full contact list per lead (email, phone, enrichment.done). Default false — cheap status polls.",
      },
    },
    required: ["bulk_id"],
  },
  execute: async (
    client: LeadbayClient,
    params: BulkEnrichStatusParams,
    ctx?: ToolContext
  ) => {
    // Strict UUIDv4 validation BEFORE any disk read — path-traversal / LFI defense.
    if (!isValidBulkId(params.bulk_id)) {
      return {
        error: true,
        code: "BULK_INVALID_ID",
        message: "bulk_id is not a valid UUIDv4",
        hint: "Pass the bulk_id returned by leadbay_enrich_titles verbatim.",
      };
    }

    if (!ctx?.bulkTracker) {
      return {
        error: true,
        code: "BULK_TRACKER_UNAVAILABLE",
        message: "No BulkTracker configured on this MCP instance",
        hint:
          "This composite requires a BulkTracker in ToolContext. Upgrade to @leadbay/mcp ≥0.3.0 or run with LEADBAY_BULK_STORE_ALLOW_MEMORY=1.",
      };
    }

    const includeContacts = params.include_contacts ?? false;

    const startMs = Date.now();

    let record: BulkRecord | undefined;
    try {
      record = await ctx.bulkTracker.get(params.bulk_id);
    } catch (err: any) {
      return {
        error: true,
        code: "BULK_STORE_UNAVAILABLE",
        message: `Bulk store read failed: ${err?.message ?? err}`,
        hint:
          "Check the file at $LEADBAY_BULK_STORE_PATH (default ~/.leadbay/bulks.json). " +
          "Set LEADBAY_BULK_STORE_ALLOW_MEMORY=1 to fall back to in-memory storage on startup (handles won't survive restart).",
      };
    }

    if (!record) {
      return {
        error: true,
        code: "BULK_NOT_FOUND",
        message: "No bulk record for that bulk_id",
        hint:
          "The record may have aged out (30-day TTL) or the MCP process was restarted without persistence. " +
          "Launch a new enrichment via leadbay_enrich_titles.",
      };
    }

    if (record.status === "pending") {
      return {
        error: true,
        code: "BULK_PENDING",
        message:
          "Bulk is in 'pending' state — the launch is in flight or the MCP crashed between launch and ack.",
        hint:
          "Retry leadbay_bulk_enrich_status in a few seconds. If it persists >60s, relaunch via leadbay_enrich_titles.",
        bulk_id: record.bulk_id,
        launched_at: record.launched_at,
      };
    }

    if (record.status === "failed") {
      return {
        error: true,
        code: "BULK_LAUNCH_FAILED",
        message:
          "The original /enrichment/launch POST failed; no backend enrichment was ordered.",
        hint:
          "Call leadbay_enrich_titles again — the failed record won't block a fresh launch.",
        bulk_id: record.bulk_id,
        launched_at: record.launched_at,
      };
    }

    // record.status === "launched" — fetch per-lead contacts.
    type Ok = {
      kind: "ok";
      lead_id: string;
      done: number;
      total: number;
      contacts?: any[];
    };
    type Fail = {
      kind: "fail";
      lead_id: string;
      code: string;
      retry_after?: number;
    };

    const results = await pMap<string, Ok | Fail>(
      record.lead_ids,
      async (leadId) => {
        try {
          const out: any = await getContacts.execute(client, { leadId });
          const contacts: any[] = Array.isArray(out?.contacts) ? out.contacts : [];
          const enrichable = contacts.filter((c) => c && c.enrichment);
          const done = enrichable.filter((c) => c.enrichment?.done === true).length;
          const total = enrichable.length;
          return {
            kind: "ok",
            lead_id: leadId,
            done,
            total,
            contacts: includeContacts ? contacts : undefined,
          };
        } catch (err: any) {
          return {
            kind: "fail",
            lead_id: leadId,
            code: err?.code ?? "UNKNOWN",
            retry_after: err?._meta?.retry_after,
          };
        }
      },
      STATUS_FETCH_CONCURRENCY
    );

    const leads: any[] = [];
    const partialFailures: Array<{
      lead_id: string;
      code: string;
      retry_after?: number;
    }> = [];
    let totalDone = 0;
    let totalAll = 0;
    for (const r of results) {
      if (r.kind === "fail") {
        partialFailures.push({
          lead_id: r.lead_id,
          code: r.code,
          ...(r.retry_after !== undefined ? { retry_after: r.retry_after } : {}),
        });
        continue;
      }
      leads.push({
        lead_id: r.lead_id,
        ...(r.contacts ? { contacts: r.contacts } : {}),
        enrichment_progress: { done: r.done, total: r.total },
      });
      totalDone += r.done;
      totalAll += r.total;
    }

    const overallProgress = {
      done: totalDone,
      total: totalAll,
      done_ratio: totalAll === 0 ? 0 : totalDone / totalAll,
    };
    const allDone = totalAll > 0 && totalDone === totalAll && partialFailures.length === 0;

    ctx?.logger?.info?.(
      `bulk.status_checked bulk_id=${record.bulk_id} done=${totalDone} total=${totalAll} wall_ms=${
        Date.now() - startMs
      }`
    );

    return {
      bulk_id: record.bulk_id,
      launched_at: record.launched_at,
      status: record.status,
      durability: record.durability,
      titles: record.titles,
      email: record.email,
      phone: record.phone,
      lens_id: record.lens_id,
      leads,
      overall_progress: overallProgress,
      all_done: allDone,
      ...(partialFailures.length > 0 ? { partial_failures: partialFailures } : {}),
    };
  },
};
