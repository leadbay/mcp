import type { LeadbayClient } from "../client.js";
import type { Notification, Tool, ToolContext } from "../types.js";
import { getContacts } from "../tools/get-contacts.js";
import { readCreditsRemaining, UNLIMITED } from "./_credits-helpers.js";

// Read a single notification by id from the paginated list endpoint.
// Backend exposes list + per-id mutations only; this short list pass is
// cheap (50 rows max) and lets the status tool surface bulk_progress with
// a single REST call instead of fanning out per-lead.
async function readNotification(
  client: LeadbayClient,
  notificationId: string
): Promise<Notification | null> {
  try {
    const page = await client.listNotifications({ archived: false, count: 50 });
    return page.items.find((n) => n.id === notificationId) ?? null;
  } catch {
    return null;
  }
}

import { leadbay_bulk_enrich_status as BULK_ENRICH_STATUS_DESCRIPTION } from "../tool-descriptions.generated.js";
interface BulkEnrichStatusParams {
  // The backend's own job id, returned by leadbay_enrich_titles. Minted,
  // retained and org-scoped by the backend, so it resolves from any process on
  // any day — which is exactly what a client-minted handle could never do.
  notification_id: string;
  // The lead set the launch reported. Needed only to fetch per-lead contacts.
  lead_ids?: string[];
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
  annotations: {
    title: "Poll bulk-enrichment status",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: BULK_ENRICH_STATUS_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      notification_id: {
        type: "string",
        description:
          "The `notification_id` returned by leadbay_enrich_titles. Required — it is the job.",
      },
      lead_ids: {
        type: "array",
        description:
          "The `lead_ids` the launch returned. Required only when include_contacts is true.",
        items: { type: "string" },
      },
      include_contacts: {
        type: "boolean",
        description:
          "If true, return the full contact list per lead (email, phone, enrichment.done). Default false — cheap status polls.",
      },
    },
    required: ["notification_id"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      notification_id: { type: "string", description: "The backend job id; pass it back to poll again." },
      launched_at: { type: "string", description: "ISO timestamp of /enrichment/launch ack." },
      status: {
        type: "string",
        description: "'launched' on success. Errors return error envelopes (handled separately).",
      },
      overall_progress: {
        type: "object",
        description: "Aggregate progress across all leads.",
        properties: {
          done: { type: "number" },
          total: { type: "number" },
          done_ratio: { type: "number" },
        },
      },
      all_done: {
        type: "boolean",
        description: "True when overall_progress.done === total AND no partial_failures.",
      },
      credits_remaining: {
        type: ["number", "string", "null"],
        description:
          "Advisory internal context only — do NOT display it. It's billing.ai_credits (a CONSUMED counter, not a remaining balance), so it can read 0 on a fresh/quota-backed account and printing _(N credits remaining)_ would falsely say 'out of credits'. Enrichment is gated by QUOTA, not this number. When all_done, show the user's standing by calling leadbay_account_status and rendering its per-window quota gauge — never a credits line here. (\"unlimited\" = internal/unlimited account; still nothing to display.) A per-run 'credits used' figure is intentionally NOT returned — getContacts can't scope cost to this bulk.",
      },
      partial_failures: {
        type: "array",
        description:
          "Per-lead errors observed during contacts fan-out (omitted when no failures).",
        items: { type: "object" },
      },
    },
    required: ["notification_id", "status", "leads", "overall_progress", "all_done"],
  },
  execute: async (
    client: LeadbayClient,
    params: BulkEnrichStatusParams,
    ctx?: ToolContext
  ) => {
    const includeContacts = params.include_contacts ?? false;
    const leadIds = params.lead_ids ?? [];
    const startMs = Date.now();

    const n = await readNotification(client, params.notification_id);
    if (!n) {
      return {
        error: true,
        code: "ENRICH_JOB_NOT_FOUND",
        message: "No job for that notification_id",
        hint:
          "The backend keeps jobs for 30 days and scopes them to your organization. " +
          "Check the id came from a launch on this account, or launch a new enrichment via leadbay_enrich_titles.",
      };
    }
    const bp = n.bulk_progress;
    if (!bp) {
      return {
        error: true,
        code: "ENRICH_JOB_NOT_BULK",
        message: "That notification is not a bulk job",
        hint: "Pass the notification_id returned by leadbay_enrich_titles.",
      };
    }
    const inProgress = n.in_progress;

    const partialFailures: Array<{
      lead_id: string;
      code: string;
      retry_after?: number;
    }> = [];
    let leads: Array<{ lead_id: string; contacts?: any[] }> = leadIds.map((id) => ({
      lead_id: id,
    }));
    if (includeContacts && leadIds.length > 0) {
      leads = await pMap<string, { lead_id: string; contacts?: any[] }>(
        leadIds,
        async (leadId) => {
          try {
            const out: any = await getContacts.execute(client, { leadId });
            const contacts: any[] = Array.isArray(out?.contacts) ? out.contacts : [];
            // getContacts uses allSettled internally — a rejected endpoint
            // becomes [] but is reported via _fetch_errors. Surface it so a
            // transient 429 during a plateau read stays distinguishable from
            // "nothing resolved".
            const fe: any[] = Array.isArray(out?._fetch_errors) ? out._fetch_errors : [];
            if (fe.length > 0) {
              partialFailures.push({
                lead_id: leadId,
                code: fe[0]?.code ?? "FETCH_ERROR",
                ...(fe[0]?.retry_after !== undefined ? { retry_after: fe[0].retry_after } : {}),
              });
            }
            return { lead_id: leadId, contacts };
          } catch (err: any) {
            partialFailures.push({
              lead_id: leadId,
              code: err?.code ?? "UNKNOWN",
              ...(err?._meta?.retry_after !== undefined
                ? { retry_after: err._meta.retry_after }
                : {}),
            });
            return { lead_id: leadId };
          }
        },
        STATUS_FETCH_CONCURRENCY
      );
    }

    ctx?.logger?.info?.(
      `bulk.status notification_id=${params.notification_id} done=${bp.success_count}/${bp.total_count} in_progress=${inProgress} wall_ms=${Date.now() - startMs}`
    );

    // Re-read the post-spend AI-credit balance on any read the agent reports
    // from — terminal, or a plateau read (include_contacts). Skipped on cheap
    // interim polls to avoid an extra /me call each time.
    const isReportRead = !inProgress || includeContacts;
    const creditsRemaining = isReportRead ? await readCreditsRemaining(client, true) : null;
    const done = bp.success_count + bp.failure_count + bp.quota_hit_count;

    return {
      notification_id: params.notification_id,
      launched_at: n.created_at,
      status: inProgress ? "launched" : "complete",
      leads,
      overall_progress: {
        done,
        total: bp.total_count,
        done_ratio: bp.total_count === 0 ? 0 : done / bp.total_count,
      },
      bulk_progress: bp,
      in_progress: inProgress,
      all_done: !inProgress,
      ...(partialFailures.length > 0 ? { partial_failures: partialFailures } : {}),
      ...(isReportRead ? { credits_remaining: creditsRemaining } : {}),
      ...(bp.quota_hit_count > 0
        ? {
            quota_hit_hint:
              "Some contacts could not be enriched because the AI-credits quota was hit. Top up via leadbay_create_topup_link or wait for the window reset.",
          }
        : {}),
    };
  },
};
