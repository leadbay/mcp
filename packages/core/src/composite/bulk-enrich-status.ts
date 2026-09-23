import type { LeadbayClient } from "../client.js";
import { readNotificationById } from "../notifications/read-by-id.js";
import { anchorIdFor, inferKind } from "../notifications/revise-hint.js";
import type { BulkProgress, Notification, Tool, ToolContext } from "../types.js";
import { getContacts } from "../tools/get-contacts.js";
import { readCreditsRemaining, UNLIMITED } from "./_credits-helpers.js";


import { leadbay_bulk_enrich_status as BULK_ENRICH_STATUS_DESCRIPTION } from "../tool-descriptions.generated.js";
interface BulkEnrichStatusParams {
  // The backend's own job id, returned by leadbay_enrich_titles. Minted,
  // retained and org-scoped by the backend, so it resolves from any process on
  // any day — which is exactly what a client-minted handle could never do.
  // Optional now: with lead_ids the tool answers per lead without it.
  notification_id?: string;
  // The lead set the launch reported.
  lead_ids?: string[];
  // What the launch asked for. The agent already has these from enrich_titles;
  // they are what makes "done" mean the channel THIS run requested rather than
  // "some enrichment happened once".
  titles?: string[];
  email?: boolean;
  phone?: boolean;
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

// One bulk's lead set, read back from the backend.
// `GET /leads/bulk_enrichments/{id}/leads` returns exactly the leads whose contacts are
// in that bulk (LeadsDaoImpl.findAllByBulkId in leadbay/backend), which is the `lead_ids`
// the launch reported. That is what lets a caller holding only the job id get per-lead
// progress.
//
// Bounded, because a status poll must stay cheap: each recovered lead costs one contacts
// fetch below. Measured on fr_prod over 180 days — 656 bulks, median 6 leads, p99 107,
// largest 257 — so three pages of 100 covers every bulk the product has produced. A
// larger one returns null and the caller falls back to the job-state answer.
const BULK_LEADS_PAGE_SIZE = 100;
const BULK_LEADS_MAX_PAGES = 3;

async function readBulkLeadIds(
  client: LeadbayClient,
  bulkId: string
): Promise<string[] | null> {
  const ids: string[] = [];
  for (let page = 0; page < BULK_LEADS_MAX_PAGES; page += 1) {
    let res: { items?: Array<{ id?: string }>; pagination?: { pages?: number } };
    try {
      res = await client.request(
        "GET",
        `/leads/bulk_enrichments/${encodeURIComponent(bulkId)}/leads` +
          `?contacts=false&count=${BULK_LEADS_PAGE_SIZE}&page=${page}`
      );
    } catch {
      return null;
    }
    for (const item of res?.items ?? []) {
      if (item?.id) ids.push(item.id);
    }
    const pages = res?.pagination?.pages ?? 1;
    if (page + 1 >= pages) return ids;
  }
  return null;
}

export const bulkEnrichStatus: Tool<BulkEnrichStatusParams> = {
  name: "leadbay_bulk_enrich_status",
  annotations: {
    title: "Poll bulk-enrichment status",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  description: BULK_ENRICH_STATUS_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      notification_id: {
        type: "string",
        description:
          "The `notification_id` returned by leadbay_enrich_titles. Answers on its own: the tool reads the job's lead set back from the backend, so an id kept from an earlier conversation still gives per-lead progress.",
      },
      lead_ids: {
        type: "array",
        description:
          "The `lead_ids` the launch returned. Gives per-lead progress, and answers on its own if the notification is archived or has aged off page 1.",
        items: { type: "string" },
      },
      titles: {
        type: "array",
        description:
          "The `titles` the launch returned. Scopes progress to the roles THIS run enriched, so a lead's pre-existing CFO email cannot inflate a CEO run.",
        items: { type: "string" },
      },
      email: {
        type: "boolean",
        description:
          "The `email` flag the launch returned. Scopes counting to reservations that asked for email (`enrichment.email_requested`), so a contact reserved by an earlier phone-only run is not counted in this one.",
      },
      phone: {
        type: "boolean",
        description:
          "The `phone` flag the launch returned. Same rule as `email`, on `enrichment.phone_requested`.",
      },
      include_contacts: {
        type: "boolean",
        description:
          "If true, return the full contact list per lead (email, phone, enrichment.done). Default false — cheap status polls.",
      },
    },
    anyOf: [{ required: ["notification_id"] }, { required: ["lead_ids"] }],
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
          "Advisory internal context only — do NOT display it. It's billing.ai_credits (a CONSUMED counter, not a remaining balance), so it can read 0 on a fresh/quota-backed account and printing _(N credits remaining)_ would falsely say 'out of credits'. Enrichment is gated by QUOTA, not this number — never a credits line here. (\"unlimited\" = internal/unlimited account; still nothing to display.) A per-run 'credits used' figure is intentionally NOT returned — getContacts can't scope cost to this bulk.",
      },
      partial_failures: {
        type: "array",
        description:
          "Per-lead errors observed during contacts fan-out (omitted when no failures).",
        items: { type: "object" },
      },
    },
    required: ["status", "leads", "overall_progress", "all_done"],
  },
  execute: async (
    client: LeadbayClient,
    params: BulkEnrichStatusParams,
    ctx?: ToolContext
  ) => {
    const includeContacts = params.include_contacts ?? false;
    let leadIds = params.lead_ids ?? [];
    const startMs = Date.now();

    if (!params.notification_id && leadIds.length === 0) {
      return {
        error: true,
        code: "ENRICH_STATUS_INPUT_REQUIRED",
        message: "Pass notification_id and/or lead_ids",
        hint:
          "Both are in the leadbay_enrich_titles result. notification_id gives the job counters; lead_ids gives per-lead progress and works even when the notification has been archived.",
      };
    }

    // Job-level counters, when the caller has the id. Best-effort: the lookup
    // scans the recent notification list rather than fetching by id, so an
    // archived or older job can be absent. That is not fatal — with lead_ids we
    // compute progress from the leads themselves.
    let bp: BulkProgress | null = null;
    let inProgress: boolean | null = null;
    let launchedAt: string | null = null;
    let bulkAnchorId: string | null = null;
    if (params.notification_id) {
      const n = await readNotificationById(client, params.notification_id);
      if (n && inferKind(n) !== "bulk_enrich") {
        // A qualification or import notification also carries counters; without
        // this check its progress would be reported as an enrichment's.
        const kind = inferKind(n);
        return {
          error: true,
          code: "ENRICH_JOB_WRONG_KIND",
          message: `That notification_id is a ${kind === "bulk_qualify" ? "lead qualification" : kind === "import" ? "file import" : "non-bulk"} notification, not a contact enrichment`,
          hint:
            kind === "bulk_qualify"
              ? "Poll it with leadbay_qualify_status({notification_id}) instead."
              : kind === "import"
                ? "Poll it with leadbay_import_status({importIds}) instead — the import ids came back from the import launch."
                : "Pass the notification_id returned by leadbay_enrich_titles.",
        };
      }
      if (n) {
        bp = n.bulk_progress;
        inProgress = n.in_progress;
        launchedAt = n.created_at;
        bulkAnchorId = anchorIdFor(n, "bulk_enrich");
      } else if (leadIds.length === 0) {
        return {
          error: true,
          code: "ENRICH_JOB_NOT_FOUND",
          message: "That notification_id is not in the recent notification list",
          hint:
            "The lookup scans your recent unarchived notifications; an archived job, or one behind many newer ones, will not be found. Re-call with the `lead_ids` the launch returned — that answers without the notification.",
        };
      }
    }

    // A contact enrichment's notification carries no counters. The backend's
    // docs/adr/notifications.md leaves contact enrichment out of the bulk-counter scheme,
    // and 0 of the 460 enrichment notifications fr_prod minted in 90 days has total_count,
    // so the id-only poll the launch tells the agent to keep for later conversations used
    // to raise every single time (product#4143). The notification does name the bulk it
    // belongs to, so recover that bulk's leads and answer through the per-lead path — the
    // same answer the agent would get by passing the lead_ids itself.
    // `!bp`, not `bp === null`: the backend omits null fields on the wire, so a
    // counter-less notification arrives with `bulk_progress` undefined.
    if (!bp && leadIds.length === 0 && bulkAnchorId !== null) {
      leadIds = (await readBulkLeadIds(client, bulkAnchorId)) ?? [];
    }

    // Per-lead path. Everything it needs comes from the agent: which leads, and
    // what the run asked for. Nothing is stored anywhere.
    if (leadIds.length > 0) {
      const wantTitles = new Set(
        (params.titles ?? []).map((t) => t.trim().toLowerCase())
      );
      // A reservation belongs to this run if it asked for the channels this run
      // asked for (`enrichment.email_requested` / `phone_requested`). A contact
      // reserved by an earlier email-only run is not re-reserved by a phone run
      // (the backend keeps one reservation per contact and skips reserved ones),
      // so it is left out of both done and total rather than counted either way.
      // "Done" is the reservation's own settled flag. The email / phone_number
      // values are NOT read here: `enrichment` sits on the source:"paid" record,
      // which never carries them — the revealed values land on the person's
      // source:"org" twin (product#4102).
      const inThisRun = (c: any): boolean => {
        if (params.email && c.enrichment.email_requested === false) return false;
        if (params.phone && c.enrichment.phone_requested === false) return false;
        return true;
      };
      const settled = (c: any): boolean => c.enrichment.done === true;

      let doneSoFar = 0;
      const totalLeads = leadIds.length;
      const results = await pMap<
        string,
        | { kind: "ok"; lead_id: string; done: number; total: number; contacts?: any[] }
        | { kind: "fail"; lead_id: string; code: string; retry_after?: number }
      >(
        leadIds,
        async (leadId) => {
          try {
            const out: any = await getContacts.execute(client, { leadId });
            const contacts: any[] = Array.isArray(out?.contacts) ? out.contacts : [];
            const enrichable = contacts.filter(
              (c) =>
                c &&
                c.enrichment &&
                inThisRun(c) &&
                (wantTitles.size === 0 ||
                  (typeof c.job_title === "string" &&
                    wantTitles.has(c.job_title.trim().toLowerCase())))
            );
            // getContacts uses allSettled internally — a rejected endpoint
            // becomes [] but is reported via _fetch_errors. Surface it so a
            // transient 429 stays distinguishable from "nothing resolved".
            const fe: any[] = Array.isArray(out?._fetch_errors) ? out._fetch_errors : [];
            doneSoFar += 1;
            ctx?.progress?.({
              progress: doneSoFar,
              total: totalLeads,
              message: `Fetched contacts for ${leadId} (${doneSoFar}/${totalLeads})`,
            });
            if (fe.length > 0) {
              return {
                kind: "fail" as const,
                lead_id: leadId,
                code: fe[0]?.code ?? "FETCH_ERROR",
                ...(fe[0]?.retry_after !== undefined ? { retry_after: fe[0].retry_after } : {}),
              };
            }
            return {
              kind: "ok" as const,
              lead_id: leadId,
              done: enrichable.filter(settled).length,
              total: enrichable.length,
              ...(includeContacts ? { contacts } : {}),
            };
          } catch (err: any) {
            doneSoFar += 1;
            ctx?.progress?.({
              progress: doneSoFar,
              total: totalLeads,
              message: `Fetch failed for ${leadId} (${doneSoFar}/${totalLeads}): ${err?.code ?? "UNKNOWN"}`,
            });
            return {
              kind: "fail" as const,
              lead_id: leadId,
              code: err?.code ?? "UNKNOWN",
              ...(err?._meta?.retry_after !== undefined
                ? { retry_after: err._meta.retry_after }
                : {}),
            };
          }
        },
        STATUS_FETCH_CONCURRENCY
      );

      const leads: any[] = [];
      const partialFailures: Array<{ lead_id: string; code: string; retry_after?: number }> = [];
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

      const allDone =
        totalAll > 0 && totalDone === totalAll && partialFailures.length === 0;
      ctx?.logger?.info?.(
        `bulk.status leads=${leadIds.length} done=${totalDone}/${totalAll} wall_ms=${Date.now() - startMs}`
      );
      const creditsRemaining = allDone ? await readCreditsRemaining(client, true) : null;

      return {
        ...(params.notification_id ? { notification_id: params.notification_id } : {}),
        ...(launchedAt ? { launched_at: launchedAt } : {}),
        status: allDone ? "complete" : "launched",
        // Echo what was asked for, so the reply states its own scope.
        ...(params.titles ? { titles: params.titles } : {}),
        ...(params.email !== undefined ? { email: params.email } : {}),
        ...(params.phone !== undefined ? { phone: params.phone } : {}),
        leads,
        overall_progress: {
          done: totalDone,
          total: totalAll,
          done_ratio: totalAll === 0 ? 0 : totalDone / totalAll,
        },
        ...(bp ? { bulk_progress: bp } : {}),
        ...(inProgress !== null ? { in_progress: inProgress } : {}),
        all_done: allDone,
        ...(partialFailures.length > 0 ? { partial_failures: partialFailures } : {}),
        ...(allDone ? { credits_remaining: creditsRemaining } : {}),
        ...(bp && bp.quota_hit_count > 0
          ? {
              quota_hit_hint:
                "Some contacts could not be enriched because the AI-credits quota was hit. Top up via leadbay_create_topup_link or wait for the window reset.",
            }
          : {}),
      };
    }

    // Counters-only path: the caller gave an id but no leads, the notification has no
    // counters, and its bulk's leads could not be recovered above — the listing failed,
    // or the bulk is larger than a status poll may fan out over. `in_progress` is then
    // the whole job state the backend holds, so answer with it rather than raising: the
    // id-only poll still tells the agent whether the job is over.
    if (!bp) {
      const isReportRead = inProgress === false;
      const creditsRemaining = isReportRead ? await readCreditsRemaining(client, true) : null;
      return {
        notification_id: params.notification_id,
        ...(launchedAt ? { launched_at: launchedAt } : {}),
        status: inProgress ? "launched" : "complete",
        leads: [],
        overall_progress: { done: 0, total: 0, done_ratio: 0 },
        ...(inProgress !== null ? { in_progress: inProgress } : {}),
        all_done: isReportRead,
        ...(isReportRead ? { credits_remaining: creditsRemaining } : {}),
        counts_hint:
          "This job's notification carries no per-contact counters and its lead set could not be read back, so done/total are 0. Re-call with the `lead_ids` returned by leadbay_enrich_titles (plus titles/email/phone) to count contacts directly.",
      };
    }
    const done = bp.success_count + bp.failure_count + bp.quota_hit_count;
    const isReportRead = !inProgress;
    const creditsRemaining = isReportRead ? await readCreditsRemaining(client, true) : null;
    return {
      notification_id: params.notification_id,
      launched_at: launchedAt,
      status: inProgress ? "launched" : "complete",
      leads: [],
      overall_progress: {
        done,
        total: bp.total_count,
        done_ratio: bp.total_count === 0 ? 0 : done / bp.total_count,
      },
      bulk_progress: bp,
      in_progress: inProgress,
      all_done: !inProgress,
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
