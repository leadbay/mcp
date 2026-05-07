import { createHash } from "node:crypto";
import type { LeadbayClient } from "../client.js";
import type {
  ToolContext,
  AiAgentResponse,
  LeadWebFetchPayload,
  LeadPayload,
  FileImportPayloadV15,
  CustomFieldDef,
} from "../types.js";

// Shared web_fetch fan-out + per-lead poll loop. Used by both
// leadbay_bulk_qualify_leads (today) and leadbay_import_and_qualify (new).
//
// Contract:
//   - launches POST /leads/{id}/web_fetch?force_fetch=false on each leadId
//     (the backend silently no-ops on already-qualified leads, so this is
//     safe to fan out unconditionally — but the caller should still pre-
//     filter to avoid wasting the launch round-trip on leads they know are
//     done).
//   - on 429 mid-fanout, stops launching but keeps polling already-launched
//     leads. Returns `quota_exceeded: true`.
//   - polls each launched lead in parallel until web_fetch.in_progress=false
//     AND ai_agent_responses.length > 0 AND every response has a non-null
//     score, OR the per-lead budget OR total budget is exhausted.
//   - honours AbortSignal at every awaitable boundary.

const POLL_INTERVAL_MS = 5_000;

export interface QualifyResult {
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
  /** Per-question breakdown — mirrors leadbay_research_lead's qualification[] shape.
   *  Order matches the org's ai_agent_questions catalog when available; otherwise
   *  alphabetical by question text. Stable across calls so LLM agents can
   *  position-index reliably. */
  qualifications: Array<{
    question: string;
    score: number | null;
    response: string | null;
    computed_at: string | null;
    outdated_at?: string | null;
  }>;
  signals_count: number | null;
  ai_agent_lead_score?: number | null;
  /**
   * One-line natural-language summary of the strongest signals — saves the
   * agent from reading every per-question response when it just needs the
   * gist. Format: "answered X/Y — <signal> on '<question>' [, <signal> on
   * '<question>']" where <signal> is one of "strong positive" (score=20),
   * "positive" (10), "neutral" (0), or "negative" (-10). Top-2 by absolute
   * score. Absent when the lead has no qualifications yet.
   */
  human_summary?: string;
}

// Build a stable index map from question text → ordinal. The agent's
// system prompt may rely on positional ordering across calls; using the
// org's ai_agent_questions catalog is the canonical source.
export type QuestionOrder = Map<string, number>;

export function buildQuestionOrder(
  questions: Array<{ question: string }>
): QuestionOrder {
  const out = new Map<string, number>();
  questions.forEach((q, i) => {
    if (q.question && !out.has(q.question)) out.set(q.question, i);
  });
  return out;
}

export function sortQualifications<T extends { question: string }>(
  quals: T[],
  order: QuestionOrder | null
): T[] {
  if (!order || order.size === 0) {
    // No catalog → alphabetical fallback so ordering is at least deterministic.
    return [...quals].sort((a, b) => a.question.localeCompare(b.question));
  }
  return [...quals].sort((a, b) => {
    const ai = order.has(a.question) ? order.get(a.question)! : Number.MAX_SAFE_INTEGER;
    const bi = order.has(b.question) ? order.get(b.question)! : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return a.question.localeCompare(b.question);
  });
}

// Compose a one-line human-readable summary from the qualifications. Picks
// the top-2 by |score| as the signal headlines. Returns undefined when no
// qualifications exist or none have scores.
export function summarizeQualifications(
  quals: Array<{ question: string; score: number | null }>
): string | undefined {
  if (quals.length === 0) return undefined;
  const scored = quals.filter((q): q is { question: string; score: number } => q.score != null);
  if (scored.length === 0) return undefined;
  const top = [...scored]
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, 2);
  const labelOf = (s: number) =>
    s >= 20 ? "strong positive" :
    s >= 10 ? "positive" :
    s <= -10 ? "negative" :
    "neutral";
  const headlines = top
    .map((q) => `${labelOf(q.score)} on '${q.question}'`)
    .join(", ");
  return `answered ${scored.length}/${quals.length} — ${headlines}`;
}

export interface FanOutOutcome {
  /** Per-lead result for every lead in the fan-out (launched OR pre-skipped). */
  results: Array<QualifyResult & { _stillRunning: boolean; _failedCode?: string }>;
  /** Lead ids whose web_fetch POST failed (NOT 429 — those go in quota). */
  failed: Array<{ lead_id: string; error: string }>;
  /** Lead ids that didn't get launched because we 429'd before reaching them. */
  not_launched: string[];
  /** Lead ids that we skipped from the launch because they were already qualified. */
  skipped_already_qualified: string[];
  /** Lead ids that aren't in the active lens — backend will never qualify
   *  them; agent should not poll. (iter-17 e2e bug-fix.) */
  not_in_lens: string[];
  /** True if any web_fetch returned 429. */
  quota_exceeded: boolean;
  /** True if the AbortSignal fired during launch or polling. */
  cancelled: boolean;
}

/**
 * Launch web_fetch on `leadIds` (sequentially — the client semaphore caps
 * actual concurrency at 5), then poll all launched leads in parallel until
 * each is done or its budget is exhausted.
 *
 * When `skipAlreadyQualifiedLensId` is provided, the helper preflights each
 * lead via `/lenses/{lensId}/leads/{leadId}` and skips the launch on any lead
 * whose `ai_agent_lead_score` is already non-null (and not currently
 * re-qualifying). Skipped leads still appear in `results` — their state is
 * fetched once via `refreshLeadStates` so callers see qualified[] populated.
 *
 * Lens-preflight failures (404, 429) are swallowed: we proceed with the
 * regular fan-out so the caller never gets stuck on a quota hit during the
 * cheap preflight.
 */
export async function fanOutWebFetchAndPoll(
  client: LeadbayClient,
  leadIds: string[],
  opts: {
    perLeadBudgetMs: number;
    totalDeadlineMs: number;
    signal?: AbortSignal;
    ctx?: ToolContext;
    skipAlreadyQualifiedLensId?: number;
    /** When true (default) AND `skipAlreadyQualifiedLensId` is provided,
     *  already-qualified leads bypass the web_fetch POST. Set false to force
     *  re-qualification (the lensId preflight still runs to detect not_in_lens). */
    skipAlreadyQualifiedLaunch?: boolean;
    questionOrder?: QuestionOrder;
  }
): Promise<FanOutOutcome> {
  const {
    perLeadBudgetMs,
    totalDeadlineMs,
    signal,
    ctx,
    skipAlreadyQualifiedLensId,
    questionOrder,
  } = opts;
  const skipAlreadyQualifiedLaunch = opts.skipAlreadyQualifiedLaunch ?? true;
  const launched: string[] = [];
  const failed: Array<{ lead_id: string; error: string }> = [];
  let quotaExceeded = false;
  let cancelled = false;

  // Preflight: identify leads already qualified AND leads not in the active
  // lens. Now ALWAYS run when lens id is supplied — not_in_lens is the
  // partition discriminator that prevents infinite-poll on leads the
  // backend will never qualify (real bug from iter-17 e2e: Apple/Stripe
  // imported into the org but lens 21580 didn't admit them).
  let alreadyQualified = new Set<string>();
  let notInLens = new Set<string>();
  if (skipAlreadyQualifiedLensId !== undefined) {
    try {
      const pre = await prequalifiedLeads(
        client,
        leadIds,
        skipAlreadyQualifiedLensId,
        ctx
      );
      alreadyQualified = pre.already_qualified;
      notInLens = pre.not_in_lens;
      if (alreadyQualified.size > 0) {
        ctx?.logger?.info?.(
          `qualify: ${alreadyQualified.size}/${leadIds.length} leads already qualified — skipping web_fetch launch`
        );
      }
      if (notInLens.size > 0) {
        ctx?.logger?.info?.(
          `qualify: ${notInLens.size}/${leadIds.length} leads NOT in active lens — surfacing in not_in_lens (won't be qualified server-side)`
        );
      }
    } catch (err: any) {
      ctx?.logger?.warn?.(
        `qualify: prequalified preflight failed (${err?.code ?? err?.message ?? "unknown"}) — proceeding with full fan-out`
      );
    }
  }

  for (let i = 0; i < leadIds.length; i++) {
    if (signal?.aborted) {
      cancelled = true;
      break;
    }
    if (quotaExceeded) break;
    const leadId = leadIds[i];
    if (notInLens.has(leadId)) {
      // Skip launch — backend won't qualify this lead anyway. The bucket
      // surfaces it on the response.
      continue;
    }
    if (skipAlreadyQualifiedLaunch && alreadyQualified.has(leadId)) {
      // Don't POST — the lead is terminal; refresh below picks up the
      // qualifications[].
      launched.push(leadId);
      continue;
    }
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
          `qualify: 429 mid-fanout after launching ${launched.length}/${leadIds.length} — keeping polls in flight`
        );
      } else if (err?.code === "NOT_FOUND") {
        failed.push({ lead_id: leadId, error: "lead not found" });
      } else if (err?.name === "AbortError") {
        cancelled = true;
        break;
      } else {
        failed.push({
          lead_id: leadId,
          error: err?.message ?? err?.code ?? "unknown",
        });
      }
    }
  }

  const launchedSet = new Set(launched);
  const not_launched = leadIds.filter(
    (id) => !launchedSet.has(id) && !failed.some((f) => f.lead_id === id)
  );
  const skipped_already_qualified = launched.filter((id) =>
    alreadyQualified.has(id)
  );

  // Poll each launched lead in parallel until terminal or budget.
  const results = await Promise.all(
    launched.map(async (leadId): Promise<QualifyResult & { _stillRunning: boolean }> => {
      const leadDeadline = Math.min(Date.now() + perLeadBudgetMs, totalDeadlineMs);
      let lastQual: AiAgentResponse[] | null = null;
      let lastWf: LeadWebFetchPayload | null = null;
      while (Date.now() < leadDeadline) {
        if (signal?.aborted) {
          cancelled = true;
          break;
        }
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
        // Bounded sleep with abort awareness.
        await sleepWithAbort(POLL_INTERVAL_MS, signal);
        if (signal?.aborted) {
          cancelled = true;
          break;
        }
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

      const qualifications = sortQualifications(
        responses.map((r) => {
          const out: QualifyResult["qualifications"][number] = {
            question: r.question,
            score: r.score,
            response: r.response,
            computed_at: r.computed_at,
          };
          if (r.outdated_at !== undefined) out.outdated_at = r.outdated_at;
          return out;
        }),
        questionOrder ?? null
      );
      const human = summarizeQualifications(qualifications);
      const result: QualifyResult & { _stillRunning: boolean } = {
        lead_id: leadId,
        qualification_summary:
          responses.length > 0
            ? {
                answered: responses.filter((r) => r.score != null).length,
                total: responses.length,
                avg_qualification_boost: avg,
              }
            : null,
        qualifications,
        signals_count: lastWf?.content
          ? Object.values(lastWf.content).reduce(
              (acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0),
              0
            )
          : null,
        _stillRunning: stillRunning,
      };
      if (human) result.human_summary = human;
      return result;
    })
  );

  return {
    results,
    failed,
    not_launched,
    skipped_already_qualified,
    not_in_lens: [...notInLens],
    quota_exceeded: quotaExceeded,
    cancelled,
  };
}

async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await new Promise<void>((r) => setTimeout(r, ms));
    return;
  }
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// Identify leads whose qualification is already done OR which aren't in the
// active lens at all. We GET the lens-leads view in CHUNKS so we can
// early-stop on the first 429 — large imports (50+ leads) used to issue 50
// parallel GETs and burn rate-limit budget even when half of them would have
// been skipped server-side. The chunked design caps probe waste.
//
// A lead is "already qualified" iff its ai_agent_lead_score is non-null AND
// web_fetch is not currently in flight.
//
// A lead is "not in lens" iff the GET returns 404 — the lead exists in the org
// (the wizard imported it) but it doesn't pass the lens-scoring rules, so
// `queueAiRescoreForLead` is a server-side no-op for it. Surface this as a
// distinct partition so the agent doesn't infinite-poll for qualifications
// that will never come. (Real bug surfaced by iter-17 e2e: Apple/Stripe
// imported into the org but lens 21580 didn't admit them — they sat in
// still_running[] forever.)
//
// Failures other than 404 are swallowed at the per-lead level — caller falls
// back to existing behavior (treat as in-lens-not-qualified).
const PREQUALIFIED_CHUNK_SIZE = 25;

export interface PrequalifiedResult {
  /** Lead ids that already have a non-null ai_agent_lead_score in this lens. */
  already_qualified: Set<string>;
  /** Lead ids that returned 404 from the lens-leads GET — not in this lens. */
  not_in_lens: Set<string>;
}

export async function prequalifiedLeads(
  client: LeadbayClient,
  leadIds: string[],
  lensId: number,
  ctx?: ToolContext
): Promise<PrequalifiedResult> {
  const already_qualified = new Set<string>();
  const not_in_lens = new Set<string>();
  for (let i = 0; i < leadIds.length; i += PREQUALIFIED_CHUNK_SIZE) {
    const chunk = leadIds.slice(i, i + PREQUALIFIED_CHUNK_SIZE);
    const results = await Promise.allSettled(
      chunk.map((leadId) =>
        client.request<LeadPayload>("GET", `/lenses/${lensId}/leads/${leadId}`)
      )
    );
    let chunkSawQuota = false;
    results.forEach((r, idx) => {
      if (r.status !== "fulfilled") {
        const code = (r.reason as any)?.code ?? (r.reason as any)?.message ?? "unknown";
        if (code === "QUOTA_EXCEEDED") chunkSawQuota = true;
        if (code === "NOT_FOUND") {
          // Lead exists in org but not in this lens — qualification will never
          // happen server-side. Surface in not_in_lens so the agent stops polling.
          not_in_lens.add(chunk[idx]);
          return;
        }
        ctx?.logger?.warn?.(
          `qualify: prequalified GET failed for ${chunk[idx]}: ${code}`
        );
        return;
      }
      const lead = r.value;
      if (lead.ai_agent_lead_score != null && lead.web_fetch_in_progress !== true) {
        already_qualified.add(lead.id);
      }
    });
    if (chunkSawQuota) {
      ctx?.logger?.warn?.(
        `qualify: prequalified preflight 429'd at chunk ${Math.floor(i / PREQUALIFIED_CHUNK_SIZE) + 1} — ${already_qualified.size} leads probed; remaining ${leadIds.length - (i + chunk.length)} leads will go through full fan-out`
      );
      break;
    }
  }
  return { already_qualified, not_in_lens };
}

export interface MappingHint {
  column: string;
  suggested_field: string;
  ai_confidence: number | null;
}

export interface CustomFieldCandidate {
  column: string;
  candidates: Array<{
    id: string;
    name: string;
    type: string;
    mapping_value: `CUSTOM.${string}`;
    reason:
      | "exact_name_match"
      | "case_insensitive_match"
      | "fuzzy_substring_match";
  }>;
}

// Reshape the wizard's pre_processing.hints + samples into a structured
// per-column report, and compute custom-field candidates from the org's
// catalog for any column the wizard didn't auto-suggest. Used by both
// `import_and_qualify` preview mode and `list_mappable_fields` with
// for_records.
export function extractHintsAndCandidates(
  fileImport: FileImportPayloadV15,
  catalog: CustomFieldDef[]
): {
  mapping_hints: MappingHint[];
  custom_field_candidates: CustomFieldCandidate[];
  sample_rows: Array<Record<string, string>>;
} {
  const mapping_hints: MappingHint[] = [];
  const hintsRaw: any = (fileImport.pre_processing as any)?.hints;
  if (hintsRaw && typeof hintsRaw === "object" && hintsRaw.fields) {
    for (const [col, h] of Object.entries(hintsRaw.fields as Record<string, any>)) {
      mapping_hints.push({
        column: col,
        suggested_field: String(h?.field ?? ""),
        ai_confidence:
          typeof h?.ai_confidence === "number" ? h.ai_confidence : null,
      });
    }
  }
  const suggested = new Set(mapping_hints.map((m) => m.column));
  const samplesRaw: any = (fileImport.pre_processing as any)?.samples ?? [];
  // Aligned with PREVIEW_SAMPLE_CAP (50) in the upload path so what the agent
  // gets back matches what was uploaded. The wizard returns up to its own
  // cap; we mirror.
  const sample_rows: Array<Record<string, string>> = Array.isArray(samplesRaw)
    ? samplesRaw.slice(0, 50)
    : [];
  const allColumns = new Set<string>();
  for (const row of sample_rows) {
    if (row && typeof row === "object") {
      for (const k of Object.keys(row)) allColumns.add(k);
    }
  }

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const custom_field_candidates: CustomFieldCandidate[] = [];
  for (const col of allColumns) {
    if (suggested.has(col)) continue;
    const colNorm = norm(col);
    const exact = catalog.filter((c) => c.name === col);
    const ci = catalog.filter(
      (c) => c.name.toLowerCase() === col.toLowerCase() && c.name !== col
    );
    const seenIds = new Set([...exact, ...ci].map((c) => c.id));
    const fuzzy = catalog.filter((c) => {
      if (seenIds.has(c.id)) return false;
      const n = norm(c.name);
      return n.length > 0 && (n.includes(colNorm) || colNorm.includes(n));
    });
    if (exact.length === 0 && ci.length === 0 && fuzzy.length === 0) continue;
    custom_field_candidates.push({
      column: col,
      candidates: [
        ...exact.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          mapping_value: `CUSTOM.${c.id}` as `CUSTOM.${string}`,
          reason: "exact_name_match" as const,
        })),
        ...ci.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          mapping_value: `CUSTOM.${c.id}` as `CUSTOM.${string}`,
          reason: "case_insensitive_match" as const,
        })),
        ...fuzzy.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          mapping_value: `CUSTOM.${c.id}` as `CUSTOM.${string}`,
          reason: "fuzzy_substring_match" as const,
        })),
      ],
    });
  }

  return { mapping_hints, custom_field_candidates, sample_rows };
}

// Build a stable mapping fingerprint for the qualify idempotency key. Two
// import_and_qualify calls with the same records-fingerprint AND the same
// mapping produce the same qualify_id within the idempotency window. We hash
// the mapping JSON-stable form (sorted keys) so trivial reordering doesn't
// break idempotency.
export function fingerprintMapping(mapping: Record<string, string>): string {
  const sorted = Object.keys(mapping).sort();
  const flat = sorted.map((k) => `${k}=${mapping[k]}`).join("|");
  return createHash("sha256").update(flat).digest("hex").slice(0, 32);
}

// Refresh per-lead state for a list of leadIds (used by qualify-status).
// Mirrors the polling logic but does ONE pass — no waiting, no retries.
// On 404 (lead deleted between launch and status check), surfaces a
// terminal `_failedCode: "NOT_FOUND"` so the caller can put the lead in
// failed[] rather than letting it sit in still_running[] forever.
export async function refreshLeadStates(
  client: LeadbayClient,
  leadIds: string[],
  questionOrder?: QuestionOrder
): Promise<Array<QualifyResult & { _stillRunning: boolean; _failedCode?: string }>> {
  return Promise.all(
    leadIds.map(async (leadId) => {
      let lastQual: AiAgentResponse[] | null = null;
      let lastWf: LeadWebFetchPayload | null = null;
      let wfErrorCode: string | null = null;
      let qualErrorCode: string | null = null;
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
        else wfErrorCode = (wfR.reason as any)?.code ?? "UNKNOWN";
        if (qualR.status === "fulfilled") lastQual = qualR.value;
        else qualErrorCode = (qualR.reason as any)?.code ?? "UNKNOWN";
      } catch {
        // ignore unexpected
      }
      // Both endpoints 404 ⇒ lead gone. Treat as terminal failure.
      const both404 =
        wfErrorCode === "NOT_FOUND" && qualErrorCode === "NOT_FOUND";
      const stillRunning =
        !both404 &&
        (lastWf?.in_progress === true ||
          !lastQual ||
          lastQual.length === 0 ||
          lastQual.some((r) => r.score == null));
      const responses = lastQual ?? [];
      const scores = responses
        .map((r) => r.score)
        .filter((s): s is number => s != null);
      const avg =
        scores.length > 0
          ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
          : null;
      const qualifications = sortQualifications(
        responses.map((r) => {
          const q: QualifyResult["qualifications"][number] = {
            question: r.question,
            score: r.score,
            response: r.response,
            computed_at: r.computed_at,
          };
          if (r.outdated_at !== undefined) q.outdated_at = r.outdated_at;
          return q;
        }),
        questionOrder ?? null
      );
      const human = summarizeQualifications(qualifications);
      const out: QualifyResult & { _stillRunning: boolean; _failedCode?: string } = {
        lead_id: leadId,
        qualification_summary:
          responses.length > 0
            ? {
                answered: responses.filter((r) => r.score != null).length,
                total: responses.length,
                avg_qualification_boost: avg,
              }
            : null,
        qualifications,
        signals_count: lastWf?.content
          ? Object.values(lastWf.content).reduce(
              (acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0),
              0
            )
          : null,
        _stillRunning: stillRunning,
      };
      if (human) out.human_summary = human;
      if (both404) out._failedCode = "NOT_FOUND";
      return out;
    })
  );
}
