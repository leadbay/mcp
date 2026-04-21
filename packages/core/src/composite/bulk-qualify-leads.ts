import type { LeadbayClient } from "../client.js";
import type {
  Tool,
  ToolContext,
  WishlistResponse,
  AiAgentResponse,
  LeadWebFetchPayload,
} from "../types.js";

interface BulkQualifyLeadsParams {
  count?: number;
  leadIds?: string[];
  lensId?: number;
  per_lead_budget_ms?: number;
  total_budget_ms?: number;
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
    avg_score_0_to_10: number | null;
  } | null;
  signals_count: number | null;
}

export const bulkQualifyLeads: Tool<BulkQualifyLeadsParams> = {
  name: "leadbay_bulk_qualify_leads",
  description:
    "Pick the next N unqualified leads in the active lens and qualify them (run AI rescore + web fetch), polling " +
    "until the answers are populated or a budget is exhausted. Already-qualified leads (those with a non-null " +
    "ai_agent_lead_score) are silently no-ops on the backend, so this composite paginates past them to find " +
    "fresh candidates. On 429 mid-fanout, stops launching but keeps polling already-launched leads. " +
    "Context: Leadbay auto-qualifies roughly the top 10 of each daily batch. Leads below the top ~10 are NOT " +
    "worse — the system is saving resources. This tool is how the agent spends more resources to go deeper on " +
    "promising-looking leads the user hasn't had time to surface yet. " +
    "When to use: when the user wants more qualified leads than what's currently shown, or when a lead looks " +
    "promising in leadbay_pull_leads but has an empty qualification_summary. " +
    "When NOT to use: to qualify a single specific lead — that's leadbay_qualify_lead (granular, advanced).",
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
    },
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

    // Poll each launched lead in parallel until web_fetch.in_progress=false AND
    // ai_agent_responses is populated, OR budget exhausted.
    const results = await Promise.all(
      launched.map(async (leadId): Promise<QualResult & { _stillRunning: boolean }> => {
        const leadDeadline = Math.min(Date.now() + perLeadBudget, totalDeadline);
        let lastQual: AiAgentResponse[] | null = null;
        let lastWf: LeadWebFetchPayload | null = null;
        while (Date.now() < leadDeadline) {
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
            if (done) break;
          } catch {
            // ignore — try again on next tick
          }
          await new Promise((r) => setTimeout(r, 5_000));
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
                  avg_score_0_to_10: avg,
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
