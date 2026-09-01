import type { LeadbayClient } from "../client.js";
import type { BulkProgress, Notification, Tool, ToolContext, RequestMeta } from "../types.js";

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
import {
  refreshLeadStates,
  buildQuestionOrder,
  prequalifiedLeads,
  type QualifyResult,
} from "./_qualify-helpers.js";

import { leadbay_qualify_status as QUALIFY_STATUS_DESCRIPTION } from "../tool-descriptions.generated.js";
interface QualifyStatusParams {
  // The backend's own job id, handed back by the launch. This is the handle:
  // it is minted, retained (30 days) and scoped to the organization by the
  // backend, so it works from any process, any session, any day.
  notification_id?: string;
  // The lead set the launch reported. Supplied by the agent from the launch
  // response when it wants per-lead detail rather than just progress counters.
  lead_ids?: string[];
  lens_id?: number;
}

interface QualifyStatusResult {
  notification_id: string | null;
  launched_at: string;
  status: "pending" | "launched" | "failed";
  // Underlying file-import handles (one per chunk).
  import_ids: string[];
  lens_id: number;

  // The lead set this qualify_id covers.
  lead_ids: string[];

  // Live state, refreshed at call time.
  qualified: QualifyResult[];
  still_running: Array<{ lead_id: string }>;
  // Per-lead errors observed at refresh time. A lead whose /web_fetch AND
  // /ai_agent_responses both 404 is reported here as `error: "NOT_FOUND"`
  // (rather than letting it pile up in still_running[] forever).
  failed: Array<{ lead_id: string; error: string }>;
  // Lead ids that exist in the org but are NOT in the active lens — backend
  // won't qualify them. Surfaced separately so the agent stops polling.
  // Membership is re-checked at status time (a lead may have been added to
  // the lens between import_and_qualify and this status call).
  not_in_lens: string[];

  // Snapshot of caller-supplied budgets (informational; not enforced by status).
  per_lead_budget_ms?: number;
  total_budget_ms?: number;

  // Backend progress counters (backend ADR docs/adr/notifications.md).
  bulk_progress: BulkProgress | null;
  in_progress: boolean | null;
  // Set when `bulk_progress.quota_hit_count > 0` — surfaces the AI-credits
  // quota wall distinctly so the agent can offer a top-up rather than
  // waiting for the next window.
  quota_hit_hint?: string;

  region: "us" | "fr" | "custom";
  _meta: RequestMeta;
}

export const qualifyStatus: Tool<
  QualifyStatusParams,
  QualifyStatusResult
> = {
  name: "leadbay_qualify_status",
  annotations: {
    title: "Poll import-and-qualify status",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: QUALIFY_STATUS_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      notification_id: {
        type: "string",
        description:
          "The `notification_id` returned by leadbay_import_and_qualify / leadbay_bulk_qualify_leads. Answers progress in ONE call.",
      },
      lead_ids: {
        type: "array",
        description:
          "The `lead_ids` the launch returned. Supply them for per-lead detail (which settled, which are still running). Progress alone needs only notification_id.",
        items: { type: "string" },
      },
      lens_id: {
        type: "number",
        description: "The `lens_id` the launch returned. Used to flag leads no longer in the lens.",
      },
    },
    anyOf: [{ required: ["notification_id"] }, { required: ["lead_ids"] }],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      notification_id: {
        type: ["string", "null"],
        description: "The backend job id this status is for; pass it back to poll again.",
      },
      launched_at: { type: "string", description: "ISO timestamp of original launch." },
      status: { type: "string", description: "'launched' on success (other states surface as error envelopes)." },
      import_ids: {
        type: "array",
        description: "Underlying file-import handle ids (one per chunk).",
        items: { type: "string" },
      },
      lens_id: { type: "number", description: "Lens id the qualification ran against." },
      lead_ids: {
        type: "array",
        description: "Lead UUIDs covered by this qualify_id (echoed from launch).",
        items: { type: "string" },
      },
      qualified: {
        type: "array",
        description:
          "Leads whose qualification has settled. Each entry: {lead_id, qualification_summary, signals_count, ...}.",
        items: { type: "object" },
      },
      still_running: {
        type: "array",
        description: "Leads still being qualified at refresh time.",
        items: { type: "object" },
      },
      failed: {
        type: "array",
        description:
          "Per-lead errors observed at refresh (e.g., 404 on /web_fetch + /ai_agent_responses).",
        items: { type: "object" },
      },
      not_in_lens: {
        type: "array",
        description:
          "Lead ids that exist in the org but aren't members of the active lens — backend won't qualify them; agent should stop polling.",
        items: { type: "string" },
      },
      per_lead_budget_ms: {
        type: "number",
        description: "Caller-supplied per-lead timeout (informational only at status time).",
      },
      total_budget_ms: {
        type: "number",
        description: "Caller-supplied total timeout (informational only at status time).",
      },
      region: { type: "string" },
      _meta: { type: "object" },
    },
    required: [
      "notification_id",
      "status",
      "import_ids",
      "lens_id",
      "lead_ids",
      "qualified",
      "still_running",
      "failed",
      "not_in_lens",
      "region",
      "_meta",
    ],
  },
  execute: async (
    client: LeadbayClient,
    params: QualifyStatusParams,
    ctx?: ToolContext
  ): Promise<QualifyStatusResult> => {
    const notifId = params.notification_id ?? null;
    const leadIds = params.lead_ids ?? [];
    if (!notifId && leadIds.length === 0) {
      throw client.makeError(
        "QUALIFY_STATUS_INPUT_REQUIRED",
        "Pass notification_id (for progress) and/or lead_ids (for per-lead detail)",
        "Both are in the launch response from leadbay_bulk_qualify_leads / leadbay_import_and_qualify. Re-read that result and pass them back.",
        ""
      );
    }

    // Progress first, from the backend's own ledger — one REST call that answers
    // "how far along" without touching a single lead. The per-lead fan-out below
    // only runs when the caller asked for detail by passing lead_ids.
    let bulkProgress: BulkProgress | null = null;
    let inProgressFlag: boolean | null = null;
    let launchedAt: string | null = null;
    if (notifId) {
      const n = await readNotification(client, notifId);
      if (!n) {
        throw client.makeError(
          "QUALIFY_JOB_NOT_FOUND",
          "No job for that notification_id",
          "The backend keeps jobs for 30 days and scopes them to your organization. Check the id came from a launch on this account, or relaunch.",
          ""
        );
      }
      bulkProgress = n.bulk_progress;
      inProgressFlag = n.in_progress;
      launchedAt = n.created_at;
    }

    if (leadIds.length === 0) {
      // Progress-only answer. No per-lead work requested, none done.
      const out: QualifyStatusResult = {
        notification_id: notifId,
        launched_at: launchedAt ?? "",
        status: "launched",
        import_ids: [],
        lens_id: params.lens_id ?? 0,
        lead_ids: [],
        qualified: [],
        still_running: [],
        failed: [],
        not_in_lens: [],
        bulk_progress: bulkProgress,
        in_progress: inProgressFlag,
        region: client.region,
        _meta: client.lastMeta ?? {
          region: client.region,
          endpoint: "GET /notifications",
          latency_ms: null,
          retry_after: null,
        },
      };
      if (bulkProgress && bulkProgress.quota_hit_count > 0) {
        out.quota_hit_hint =
          "Some leads hit the AI-credits quota during qualification. Top up via leadbay_create_topup_link to clear the throttle immediately, or wait until the daily/weekly window resets.";
      }
      return out;
    }

    // Phase 1/3: pull the question order so qualifications come back in
    // mission-importance order. Surface a tick so the agent can stream
    // long-poll progress to the user (otherwise the spinner is mute).
    ctx?.progress?.({
      progress: 1,
      total: 3,
      message: "Loading qualification questions…",
    });
    let questionOrder = undefined;
    try {
      const taste = await client.resolveTasteProfile();
      questionOrder = buildQuestionOrder(taste.qualificationQuestions ?? []);
    } catch {
      // best-effort
    }

    // Phase 2/3: re-check lens membership (a lead may have been added to
    // the lens since the original import). Best-effort.
    ctx?.progress?.({
      progress: 2,
      total: 3,
      message: `Checking lens membership for ${leadIds.length} lead${leadIds.length === 1 ? "" : "s"}…`,
    });
    let notInLensSet = new Set<string>();
    try {
      const pre = await prequalifiedLeads(
        client,
        leadIds,
        params.lens_id ?? 0,
        ctx
      );
      notInLensSet = pre.not_in_lens;
    } catch {
      // best-effort; absence of not_in_lens is the same as "all in lens"
    }

    // Phase 3/3: refresh per-lead state (web_fetch + ai_agent_responses).
    ctx?.progress?.({
      progress: 3,
      total: 3,
      message: `Refreshing qualification state for ${leadIds.length} lead${leadIds.length === 1 ? "" : "s"}…`,
    });
    const fresh = await refreshLeadStates(client, leadIds, questionOrder);
    const failed: Array<{ lead_id: string; error: string }> = [];
    const qualified: QualifyResult[] = [];
    const still_running: Array<{ lead_id: string }> = [];
    for (const r of fresh) {
      if (r._failedCode) {
        failed.push({ lead_id: r.lead_id, error: r._failedCode });
        continue;
      }
      if (notInLensSet.has(r.lead_id) && r._stillRunning) {
        // Surfacing as not_in_lens rather than still_running terminates the
        // agent's poll loop — backend won't qualify this lead.
        continue;
      }
      if (r._stillRunning) {
        still_running.push({ lead_id: r.lead_id });
        continue;
      }
      const { _stillRunning, _failedCode, ...rest } = r;
      qualified.push(rest);
    }

    const out: QualifyStatusResult = {
      notification_id: notifId,
      launched_at: launchedAt ?? "",
      status: "launched",
      import_ids: [],
      lens_id: params.lens_id ?? 0,
      lead_ids: leadIds,
      qualified,
      still_running,
      failed,
      not_in_lens: [...notInLensSet],
      bulk_progress: bulkProgress,
      in_progress: inProgressFlag,
      region: client.region,
      _meta: client.lastMeta ?? {
        region: client.region,
        endpoint: "GET /leads/<id>/web_fetch + /ai_agent_responses",
        latency_ms: null,
        retry_after: null,
      },
    };
    if (bulkProgress && bulkProgress.quota_hit_count > 0) {
      out.quota_hit_hint =
        "Some leads hit the AI-credits quota during qualification. Top up via leadbay_create_topup_link to clear the throttle immediately, or wait until the daily/weekly window resets.";
    }
    return out;
  },
};
