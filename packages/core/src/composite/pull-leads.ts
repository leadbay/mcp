import type { LeadbayClient } from "../client.js";
import type {
  Tool,
  ToolContext,
  WishlistResponse,
  AiAgentResponse,
  LeadPayload,
} from "../types.js";

interface PullLeadsParams {
  lensId?: number;
  count?: number;
  page?: number;
  verbose?: boolean;
}

interface QualificationSummary {
  answered: number;
  total: number;
  avg_score_0_to_10: number | null;
  best_response_excerpt: string | null;
}

function summarise(responses: AiAgentResponse[]): QualificationSummary {
  const answered = responses.filter((r) => r.score != null).length;
  const total = responses.length;
  const scores = responses
    .map((r) => r.score)
    .filter((s): s is number => s != null);
  const avg =
    scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
      : null;

  // Find the highest-score response with non-empty text — the agent gets the
  // single most-informative justification as a teaser, can drill in via
  // research_lead for full text.
  const best = [...responses]
    .filter((r) => r.response && r.score != null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];

  let excerpt = best?.response ?? null;
  if (excerpt && excerpt.length > 200) {
    excerpt = excerpt.slice(0, 197) + "...";
  }

  return { answered, total, avg_score_0_to_10: avg, best_response_excerpt: excerpt };
}

export const pullLeads: Tool<PullLeadsParams> = {
  name: "leadbay_pull_leads",
  description:
    "Pull up new leads from the user's last-active lens — the canonical 'show me today's prospects' tool. " +
    "Leadbay works like an inbox: each time the user logs back in, a fresh batch is delivered, paced by how " +
    "many leads they've actually acted on recently. Pulling more won't produce more; user outreach/skips/saves does. " +
    "Each returned lead carries a one-line qualification_summary built from leadbay_ai_agent_responses, plus " +
    "the rich tags / scores / recommended_contact_title / engagement counters / in-flight flags from the lead summary. " +
    "Roughly the top 10 of the batch come pre-qualified (populated qualification_summary + ai_agent_lead_score); " +
    "leads below the top ~10 carry only the basic firmographic `score` — not worse, just resource-saved by the system. " +
    "Call leadbay_bulk_qualify_leads to deepen any of them on demand. " +
    "When to use: as the agent's default opening move when the user wants to see leads, or as a daily check-in " +
    "for what's new today. " +
    "When NOT to use: when the user has named a specific lens — pass lensId to override the auto-resolution. " +
    "Replaces the older leadbay_find_prospects (which is removed in v0.2.0).",
  inputSchema: {
    type: "object",
    properties: {
      lensId: {
        type: "number",
        description:
          "Override the auto-resolved last-active lens (escape hatch — normally omit)",
      },
      count: { type: "number", description: "Leads per page, max 50 (default 20)" },
      page: { type: "number", description: "Page number, 0-indexed (default 0)" },
      verbose: {
        type: "boolean",
        description:
          "If true, include the full set of lead-summary fields. Default false: returns the trimmed agent-friendly form.",
      },
    },
  },
  execute: async (
    client: LeadbayClient,
    params: PullLeadsParams,
    ctx?: ToolContext
  ) => {
    const lensId = params.lensId ?? (await client.resolveDefaultLens());
    const page = params.page ?? 0;
    const count = Math.min(params.count ?? 20, 50);
    const verbose = params.verbose ?? false;

    const res = await client.request<WishlistResponse>(
      "GET",
      `/lenses/${lensId}/leads/wishlist?count=${count}&page=${page}&contacts=true`
    );

    // Fan-out qualification reads. Concurrency is capped by the client's
    // semaphore (5 in flight). Soft-fail per lead — qualification_summary is
    // additive, not load-bearing.
    const summaries = await Promise.all(
      res.items.map(async (lead) => {
        try {
          const r = await client.request<AiAgentResponse[]>(
            "GET",
            `/leads/${lead.id}/ai_agent_responses`
          );
          return { leadId: lead.id, summary: summarise(r) };
        } catch (err: any) {
          ctx?.logger?.warn?.(
            `pull_leads: ai_agent_responses failed for lead ${lead.id}: ${err?.message ?? err?.code ?? err}`
          );
          return {
            leadId: lead.id,
            summary: {
              answered: 0,
              total: 0,
              avg_score_0_to_10: null,
              best_response_excerpt: null,
            },
          };
        }
      })
    );
    const summaryMap = new Map(summaries.map((s) => [s.leadId, s.summary]));

    const trimmed = (lead: LeadPayload) =>
      verbose
        ? lead
        : {
            id: lead.id,
            name: lead.name,
            score: lead.score,
            ai_agent_lead_score: lead.ai_agent_lead_score,
            location: lead.location,
            short_description: lead.short_description ?? lead.description,
            size: lead.size,
            website: lead.website,
            tags: lead.tags,
            recommended_contact_title: lead.recommended_contact_title ?? null,
            recommended_contact: lead.recommended_contact ?? null,
            web_fetch_in_progress: lead.web_fetch_in_progress ?? false,
            enrichment_in_progress: lead.enrichment_in_progress ?? false,
            liked: lead.liked,
            disliked: lead.disliked,
            new: lead.new ?? false,
            contacts_count: lead.contacts_count,
            org_contacts_count: lead.org_contacts_count,
            notes_count: lead.notes_count ?? 0,
            epilogue_actions_count: lead.epilogue_actions_count ?? 0,
            prospecting_actions_count: lead.prospecting_actions_count ?? 0,
          };

    return {
      lens: { id: lensId },
      leads: res.items.map((lead) => ({
        ...trimmed(lead),
        qualification_summary: summaryMap.get(lead.id) ?? null,
      })),
      pagination: res.pagination,
      computing_wishlist: res.computing_wishlist,
      computing_scores: res.computing_scores,
      _meta: {
        region: client.region,
        latency_ms: client.lastMeta?.latency_ms ?? null,
      },
    };
  },
};
