import type { LeadbayClient } from "../client.js";
import type {
  Tool,
  ToolContext,
  WishlistResponse,
  AiAgentResponse,
  LeadPayload,
} from "../types.js";
import { withAgentMemoryMeta } from "../agent-memory/index.js";

import { leadbay_pull_leads as PULL_LEADS_DESCRIPTION } from "../tool-descriptions.generated.js";

// B6/B7: the backend occasionally serializes a missing LinkedIn URL as the
// literal string "null". Coerce to real null so agents never render the
// four-character string in a contact card.
function normalizeLinkedinPage(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return null;
  return trimmed;
}
interface PullLeadsParams {
  lensId?: number;
  count?: number;
  page?: number;
  verbose?: boolean;
}

interface QualificationSummary {
  answered: number;
  total: number;
  /**
   * Average of per-question AI agent boost scores (each -10/0/10/20).
   * NOT a 0-10 average. Negative = net negative signal across questions.
   */
  avg_qualification_boost: number | null;
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

  return { answered, total, avg_qualification_boost: avg, best_response_excerpt: excerpt };
}

/**
 * A single ready-to-render next-step option for the host's choice widget.
 * `label` is the SHORT button text (1–5 words) — AskUserQuestion (Claude
 * cowork / Claude Code) caps labels at that length; the longer `description`
 * carries the full sentence (used as the AskUserQuestion option description,
 * or appended to the ask_user_input_v0 string label on hosts without a
 * separate description field). `kind` lets the model map the choice back to an
 * action without re-parsing the label.
 */
export interface NextStepOption {
  label: string;
  description: string;
  kind:
    | "build_artifact"
    | "pull_next_page"
    | "qualify_deeper"
    | "refine_audience";
}

export interface NextSteps {
  /** Pass these straight into ask_user_input_v0 as the single_select options, verbatim. */
  question: string;
  options: NextStepOption[];
}

/**
 * Deterministically build the NEXT STEPS the model should surface via
 * ask_user_input_v0 after a pull_leads. Returns null when there's nothing to
 * act on (empty batch) so the model doesn't fire an empty widget.
 *
 * The artifact offer ("Build an interactive lead triage board") is ALWAYS the
 * first option whenever the batch is non-empty — this is the gate that kept
 * getting dropped when the model assembled options from prose. By shipping it
 * pre-built in the tool result, the model only has to render, not derive.
 */
export function buildPullLeadsNextSteps(args: {
  leadCount: number;
  hasMore: boolean;
  nextPage: number | null;
}): NextSteps | null {
  const { leadCount, hasMore, nextPage } = args;
  if (leadCount <= 0) return null;

  const options: NextStepOption[] = [];

  // Artifact offer first — a multi-item batch is the canonical "scan / sort /
  // return-to" result the artifact gate targets. Always included when there
  // are leads to put on the board. Labels stay ≤5 words for AskUserQuestion;
  // the full sentence lives in `description`.
  options.push({
    label: "Triage board",
    description: "Build an interactive lead triage board to sort and filter this batch.",
    kind: "build_artifact",
  });

  // Deepen qualification is a natural second move on a fresh batch.
  options.push({
    label: "Deepen qualification",
    description: "Run deeper AI qualification on these leads.",
    kind: "qualify_deeper",
  });

  // Pager only when another page actually exists.
  if (hasMore && nextPage != null) {
    options.push({
      label: "Next page",
      description: `Pull page ${nextPage + 1} of this lens.`,
      kind: "pull_next_page",
    });
  }

  // Audience refinement rounds it out (and is the right move on an off-ICP batch).
  options.push({
    label: "Refine audience",
    description: "Adjust the lens audience / filters (sector, size, prompt).",
    kind: "refine_audience",
  });

  // ask_user_input_v0 caps at 2–4 options; keep the first four.
  return { question: "What do you want to do next?", options: options.slice(0, 4) };
}

export const pullLeads: Tool<PullLeadsParams> = {
  name: "leadbay_pull_leads",
  annotations: {
    title: "Pull fresh Leadbay leads",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: PULL_LEADS_DESCRIPTION,
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
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      lens: {
        type: "object",
        description: "Lens metadata (id of the lens that was queried).",
        properties: { id: { type: "number" } },
      },
      leads: {
        type: "array",
        description:
          "The page of leads. In default mode (verbose:false) each lead is the trimmed agent-friendly shape; in verbose:true the full LeadPayload.",
        items: { type: "object" },
      },
      pagination: {
        type: "object",
        description: "page (0-indexed), pages (total), total (item count).",
        properties: {
          page: { type: "number" },
          pages: { type: "number" },
          total: { type: "number" },
        },
      },
      has_more: {
        type: "boolean",
        description: "True if at least one more page exists. Spec-aligned pagination metadata.",
      },
      next_page: {
        type: ["number", "null"],
        description: "0-indexed next page number, or null on the last page.",
      },
      computing_wishlist: {
        type: "boolean",
        description: "True if Leadbay is still rebuilding this lens's wishlist.",
      },
      computing_scores: {
        type: "boolean",
        description: "True if scoring is still running.",
      },
      next_steps: {
        type: ["object", "null"],
        description:
          "Ready-made NEXT STEPS for the host's choice widget. Each option has a SHORT `label` (≤5 words, fits AskUserQuestion's label cap on Claude cowork/Claude Code) and a full `description`. For AskUserQuestion (cowork/Claude Code) pass each option as {label, description}. For ask_user_input_v0 (Claude chat/ChatGPT, string-only options) use the `description` as the option string. Use these VERBATIM, in order — do NOT re-derive, reword, or render as prose when a widget tool exists. options[0] is the artifact offer (build the lead triage board) whenever the batch is non-empty. null only when the batch is empty.",
        properties: {
          question: { type: "string" },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                description: { type: "string" },
                kind: { type: "string" },
              },
            },
          },
        },
      },
      _meta: {
        type: "object",
        description: "Operator context: region + last-call latency.",
        properties: {
          region: { type: "string" },
          latency_ms: { type: ["number", "null"] },
          agent_memory: { type: "object" },
        },
      },
    },
    required: ["lens", "leads", "pagination"],
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
              avg_qualification_boost: null,
              best_response_excerpt: null,
            },
          };
        }
      })
    );
    const summaryMap = new Map(summaries.map((s) => [s.leadId, s.summary]));

    // Augment recommended_contact with linkedin_page (B1/B7) — the canonical
    // contact-LinkedIn field name — and coerce the "null" string bug away.
    // Drop `recommended_contact_title` everywhere (B8) — it duplicates
    // recommended_contact.job_title; keep only the nested one.
    const augmentContact = (
      c: LeadPayload["recommended_contact"] | undefined | null
    ) =>
      c
        ? {
            ...c,
            linkedin_page: normalizeLinkedinPage(
              (c as any).linkedin_page ?? null
            ),
          }
        : null;

    const trimmed = (lead: LeadPayload) =>
      verbose
        ? {
            ...lead,
            recommended_contact: augmentContact(lead.recommended_contact),
          }
        : {
            id: lead.id,
            name: lead.name,
            score: lead.score,
            ai_agent_lead_score: lead.ai_agent_lead_score,
            ai_summary: lead.ai_summary ?? null,
            split_ai_summary: lead.split_ai_summary ?? null,
            location: lead.location,
            short_description: lead.short_description ?? lead.description,
            size: lead.size,
            website: lead.website,
            phone_numbers: lead.phone_numbers ?? null,
            tags: lead.tags,
            social_presence: lead.social_presence ?? null,
            social_urls: (lead as any).social_urls ?? null,
            recommended_contact: augmentContact(lead.recommended_contact),
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

    // Spec-aligned pagination metadata (P3 from the eval doc): the agent
    // shouldn't have to compute `page < pages - 1` themselves.
    const totalPages = res.pagination?.pages ?? 0;
    const currentPage = res.pagination?.page ?? page;
    const hasMore = currentPage < totalPages - 1;
    const nextPage = hasMore ? currentPage + 1 : null;

    // Deterministic NEXT STEPS. The host's ask_user_input_v0 widget is the
    // model's tool to call, not ours — the server cannot emit it. But we CAN
    // hand the model a ready-made options array so it renders the widget
    // instead of re-deriving options from prose (where it drifts to prose or
    // drops the artifact offer). The model is instructed to pass
    // `next_steps.options` straight into ask_user_input_v0 verbatim.
    const leadCount = res.items.length;
    const nextSteps = buildPullLeadsNextSteps({ leadCount, hasMore, nextPage });

    return withAgentMemoryMeta(client, {
      lens: { id: lensId },
      leads: res.items.map((lead) => ({
        ...trimmed(lead),
        qualification_summary: summaryMap.get(lead.id) ?? null,
      })),
      pagination: res.pagination,
      has_more: hasMore,
      next_page: nextPage,
      computing_wishlist: res.computing_wishlist,
      computing_scores: res.computing_scores,
      next_steps: nextSteps,
      _meta: {
        region: client.region,
        latency_ms: client.lastMeta?.latency_ms ?? null,
      },
    }, ctx);
  },
};
