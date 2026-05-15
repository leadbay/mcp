import type { LeadbayClient } from "../client.js";
import type {
  Tool,
  ToolContext,
  WishlistResponse,
  AiAgentResponse,
  LeadWebFetchPayload,
} from "../types.js";

import { leadbay_bulk_qualify_leads as BULK_QUALIFY_LEADS_DESCRIPTION } from "../tool-descriptions.generated.js";
interface BulkQualifyLeadsParams {
  count?: number;
  leadIds?: string[];
  lensId?: number;
  per_lead_budget_ms?: number;
  total_budget_ms?: number;
  wait_for_completion?: boolean;
}

const PAGE_SIZE = 50;
const DEFAULT_COUNT = 10;
const MAX_COUNT = 25;
const DEFAULT_PER_LEAD_BUDGET_MS = 90_000;
const DEFAULT_TOTAL_BUDGET_MS = 5 * 60_000;

interface QualResult {
  lead_id: string;
  qualification_summary: {
    answered: number;
    total: number;
    /**
     * Average of per-question AI agent boost scores (each -10/0/10/20).
     * NOT a 0-10 average. Negative = net negative signal across questions.
     */
    avg_qualification_boost: number | null;
  } | null;
  signals_count: number | null;
}

interface BulkQualifyRunningResult {
  status: "running";
  handle_id: string;
  qualify_id: string;
  lead_ids: string[];
  launched_count: number;
  failed: Array<{ lead_id: string; error: string }>;
  quota_exceeded: boolean;
  lens_id: number;
  _meta: { region: "us" | "fr" | "custom" };
}

export const bulkQualifyLeads: Tool<BulkQualifyLeadsParams, any> = {
  name: "leadbay_bulk_qualify_leads",
  annotations: {
    title: "Bulk-qualify next N leads",
    readOnlyHint: false,
    destructiveHint: true,
    // Same set of leads + same options ⇒ same backend job (idempotency
    // hash); already-qualified leads are silent no-ops. Re-call is safe.
    idempotentHint: true,
    openWorldHint: true,
  },
  description: BULK_QUALIFY_LEADS_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      count: {
        type: "number",
        description: `How many fresh leads to qualify (default ${DEFAULT_COUNT}, max ${MAX_COUNT})`,
      },
      leadIds: {
        type: "array",
        items: { type: "string" },
        description:
          "Explicit lead UUIDs to qualify (skips the auto-pagination)",
      },
      lensId: {
        type: "number",
        description: "Lens id (escape hatch — defaults to active)",
      },
      per_lead_budget_ms: {
        type: "number",
        description: `Polling budget per lead in ms (default ${DEFAULT_PER_LEAD_BUDGET_MS})`,
      },
      total_budget_ms: {
        type: "number",
        description: `Total polling budget in ms (default ${DEFAULT_TOTAL_BUDGET_MS})`,
      },
      wait_for_completion: {
        type: "boolean",
        description:
          "When false, launch qualification and return `{status:'running', qualify_id}` immediately. Poll leadbay_qualify_status. Default is true for 0.6.x backwards compatibility.",
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      qualified: {
        type: "array",
        description:
          "Leads whose qualification finished within budget. Each entry: lead_id, qualification_summary{answered,total,avg_qualification_boost}, signals_count.",
        items: { type: "object" },
      },
      status: {
        type: "string",
        description: "`running` when wait_for_completion=false; absent on the legacy blocking result.",
      },
      handle_id: { type: "string", description: "Alias of qualify_id for handle-oriented callers." },
      qualify_id: { type: "string", description: "UUIDv4 to poll via leadbay_qualify_status." },
      lead_ids: { type: "array", items: { type: "string" } },
      launched_count: { type: "number" },
      still_running: {
        type: "array",
        description:
          "Leads launched but whose qualification did not complete within budget. Re-poll via leadbay_qualify_status with the bulk_id (when present).",
        items: { type: "object" },
      },
      failed: {
        type: "array",
        description: "Leads whose web_fetch launch failed (per-lead error).",
        items: { type: "object" },
      },
      quota_exceeded: {
        type: "boolean",
        description:
          "True if 429 was hit mid-fanout. Already-launched leads keep polling; further launches stopped.",
      },
      exhausted: {
        type: "boolean",
        description: "True if the lens's wishlist had no more unqualified leads to qualify.",
      },
      total_unqualified_found: { type: "number" },
      message: { type: "string", description: "Human-readable summary; absent on the happy path." },
      lens_id: {
        type: "number",
        description:
          "The lens id the qualification ran against. Present on every successful return.",
      },
      _meta: {
        type: "object",
        description: "Operator context: region.",
        properties: { region: { type: "string" } },
      },
    },
    required: ["failed", "quota_exceeded"],
    anyOf: [
      { required: ["qualified", "still_running", "failed", "quota_exceeded"] },
      {
        required: [
          "status",
          "handle_id",
          "qualify_id",
          "lead_ids",
          "launched_count",
          "failed",
          "quota_exceeded",
          "lens_id",
          "_meta",
        ],
      },
    ],
  },
  execute: async (
    client: LeadbayClient,
    params: BulkQualifyLeadsParams,
    ctx?: ToolContext
  ) => {
    const wantCount = Math.min(params.count ?? DEFAULT_COUNT, MAX_COUNT);
    const perLeadBudget = params.per_lead_budget_ms ?? DEFAULT_PER_LEAD_BUDGET_MS;
    const totalBudget = params.total_budget_ms ?? DEFAULT_TOTAL_BUDGET_MS;
    const totalDeadline = Date.now() + totalBudget;
    const waitForCompletion = params.wait_for_completion ?? true;

    let candidates: string[];
    let exhausted = false;
    let totalUnqualifiedFound = 0;
    let lensId: number;

    if (params.leadIds && params.leadIds.length > 0) {
      candidates = params.leadIds;
      lensId = params.lensId ?? (await client.resolveDefaultLens());
    } else {
      lensId = params.lensId ?? (await client.resolveDefaultLens());
      candidates = [];
      let page = 0;
      while (candidates.length < wantCount) {
        const wish = await client.request<WishlistResponse>(
          "GET",
          `/lenses/${lensId}/leads/wishlist?count=${PAGE_SIZE}&page=${page}`
        );
        if (wish.items.length === 0) {
          exhausted = true;
          break;
        }
        const fresh = wish.items.filter(
          (l) =>
            l.ai_agent_lead_score == null && l.web_fetch_in_progress !== true
        );
        totalUnqualifiedFound += fresh.length;
        for (const lead of fresh) {
          candidates.push(lead.id);
          if (candidates.length >= wantCount) break;
        }
        if (page >= wish.pagination.pages - 1) {
          exhausted = true;
          break;
        }
        page += 1;
      }
    }

    if (candidates.length === 0) {
      return {
        qualified: [],
        still_running: [],
        failed: [],
        quota_exceeded: false,
        exhausted,
        total_unqualified_found: totalUnqualifiedFound,
        message:
          "No unqualified leads found in this lens — either all leads have been qualified, or the wishlist is " +
          "still computing (check leadbay_account_status for computing_wishlist).",
      };
    }

    if (!waitForCompletion) {
      if (!ctx?.bulkTracker) {
        throw client.makeError(
          "BULK_TRACKER_UNAVAILABLE",
          "No BulkTracker configured on this MCP instance",
          "leadbay_bulk_qualify_leads wait_for_completion=false needs a BulkTracker so qualify_id survives restart.",
          ""
        );
      }
      const reservation = await ctx.bulkTracker.findOrCreatePendingQualify({
        lead_ids: candidates,
        import_ids: [],
        lens_id: lensId,
        mapping_fingerprint: "bulk_qualify_leads",
        per_lead_budget_ms: perLeadBudget,
        total_budget_ms: totalBudget,
      });
      const launched: string[] = [];
      const failed: Array<{ lead_id: string; error: string }> = [];
      let quotaExceeded = false;
      if (!reservation.reused) {
        for (const leadId of candidates) {
          if (quotaExceeded) break;
          try {
            await client.requestVoid(
              "POST",
              `/leads/${leadId}/web_fetch?force_fetch=false`
            );
            launched.push(leadId);
          } catch (err: any) {
            if (err?.code === "QUOTA_EXCEEDED") {
              quotaExceeded = true;
            } else if (err?.code === "NOT_FOUND") {
              failed.push({ lead_id: leadId, error: "lead not found" });
            } else {
              failed.push({
                lead_id: leadId,
                error: err?.message ?? err?.code ?? "unknown",
              });
            }
          }
        }
        if (failed.length === candidates.length || launched.length > 0 || quotaExceeded) {
          await ctx.bulkTracker.markLaunched(reservation.record.bulk_id);
        }
      }
      const out: BulkQualifyRunningResult = {
        status: "running",
        handle_id: reservation.record.bulk_id,
        qualify_id: reservation.record.bulk_id,
        lead_ids: candidates,
        launched_count: reservation.reused ? reservation.record.lead_ids.length : launched.length,
        failed,
        quota_exceeded: quotaExceeded,
        lens_id: lensId,
        _meta: { region: client.region },
      };
      return out;
    }

    // Fan-out web_fetch triggers. On 429, stop launching further but let the
    // already-launched ones complete. Concurrency capped by client semaphore.
    const launched: string[] = [];
    const failed: Array<{ lead_id: string; error: string }> = [];
    let quotaExceeded = false;

    for (const leadId of candidates) {
      if (quotaExceeded) break;
      try {
        await client.requestVoid(
          "POST",
          `/leads/${leadId}/web_fetch?force_fetch=false`
        );
        launched.push(leadId);
      } catch (err: any) {
        if (err?.code === "QUOTA_EXCEEDED") {
          quotaExceeded = true;
          ctx?.logger?.warn?.(
            `bulk_qualify_leads: 429 mid-fanout after launching ${launched.length}/${candidates.length} — stopping further launches but polling those already in flight`
          );
        } else if (err?.code === "NOT_FOUND") {
          failed.push({ lead_id: leadId, error: "lead not found" });
        } else {
          failed.push({
            lead_id: leadId,
            error: err?.message ?? err?.code ?? "unknown",
          });
        }
      }
    }

    // Per-lead progress counter for the spec notifications/progress stream.
    // Composite-level: doneCount increments on each lead transition; emit on
    // each transition so the agent's UI reflects "qualified Acme Corp 3/10".
    let progressDone = 0;
    const progressTotal = launched.length;
    // Initial progress event (0/total) so the client knows the workload size.
    if (progressTotal > 0) {
      ctx?.progress?.({
        progress: 0,
        total: progressTotal,
        message: `Starting qualification for ${progressTotal} lead${progressTotal === 1 ? "" : "s"}`,
      });
    }

    // Signal-aware sleep helper. The polling loops below await a 5s gap
    // between API hits; without observing ctx.signal the user's cancel is
    // ignored until the natural budget exhaustion. With this helper, abort
    // resolves immediately and the loop's next iteration sees aborted=true
    // and breaks. (Per second-opinion #5 in iter 12.)
    const sleepWithSignal = (ms: number) =>
      new Promise<void>((resolve) => {
        if (ctx?.signal?.aborted) {
          resolve();
          return;
        }
        const t = setTimeout(resolve, ms);
        ctx?.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            resolve();
          },
          { once: true }
        );
      });

    // Poll each launched lead in parallel until web_fetch.in_progress=false AND
    // ai_agent_responses is populated, OR budget exhausted, OR client cancelled.
    const results = await Promise.all(
      launched.map(async (leadId): Promise<QualResult & { _stillRunning: boolean }> => {
        const leadDeadline = Math.min(Date.now() + perLeadBudget, totalDeadline);
        let lastQual: AiAgentResponse[] | null = null;
        let lastWf: LeadWebFetchPayload | null = null;
        while (Date.now() < leadDeadline) {
          if (ctx?.signal?.aborted) break;
          try {
            const [wfR, qualR] = await Promise.allSettled([
              client.request<LeadWebFetchPayload>(
                "GET",
                `/leads/${leadId}/web_fetch`
              ),
              client.request<AiAgentResponse[]>(
                "GET",
                `/leads/${leadId}/ai_agent_responses`
              ),
            ]);
            if (wfR.status === "fulfilled") lastWf = wfR.value;
            if (qualR.status === "fulfilled") lastQual = qualR.value;
            const done =
              lastWf !== null &&
              lastWf.in_progress !== true &&
              Array.isArray(lastQual) &&
              lastQual.length > 0 &&
              lastQual.every((r) => r.score != null);
            if (done) {
              progressDone += 1;
              ctx?.progress?.({
                progress: progressDone,
                total: progressTotal,
                message: `Qualified lead ${leadId} (${progressDone}/${progressTotal})`,
              });
              break;
            }
          } catch {
            // ignore — try again on next tick
          }
          if (ctx?.signal?.aborted) break;
          await sleepWithSignal(5_000);
        }

        const stillRunning =
          lastWf?.in_progress === true ||
          !lastQual ||
          lastQual.length === 0 ||
          lastQual.some((r) => r.score == null);

        const responses = lastQual ?? [];
        const scores = responses
          .map((r) => r.score)
          .filter((s): s is number => s != null);
        const avg =
          scores.length > 0
            ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
            : null;

        return {
          lead_id: leadId,
          qualification_summary:
            responses.length > 0
              ? {
                  answered: responses.filter((r) => r.score != null).length,
                  total: responses.length,
                  avg_qualification_boost: avg,
                }
              : null,
          signals_count: lastWf?.content
            ? Object.values(lastWf.content).reduce(
                (acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0),
                0
              )
            : null,
          _stillRunning: stillRunning,
        };
      })
    );

    const qualified = results
      .filter((r) => !r._stillRunning)
      .map(({ _stillRunning, ...rest }) => rest);
    const still_running = results
      .filter((r) => r._stillRunning)
      .map(({ _stillRunning, ...rest }) => rest);

    return {
      qualified,
      still_running,
      failed,
      quota_exceeded: quotaExceeded,
      exhausted,
      total_unqualified_found: totalUnqualifiedFound,
      lens_id: lensId,
      _meta: { region: client.region },
    };
  },
};
