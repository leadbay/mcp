/**
 * leadbay_campaign_progression — GET /campaigns/{id}/leads (paginated)
 *
 * Returns per-lead progress + affiliation. This is the "what stage is
 * each lead at" view that managers use for #3630 US3 follow-up
 * governance. Each row has:
 *   - lead: full LeadPayload (contacts, score, state, ai_summary)
 *   - progress: {total_contacts, in_progress, declined, headline} —
 *     the per-lead campaign roll-up (reachable contacts, conversations
 *     still active, declined, last interaction type). `total_contacts`
 *     is contact coverage, not outreach history.
 *   - affiliation: {own_campaigns, other_users_campaign_count} —
 *     overlap detection across the user's own campaigns AND visibility
 *     into how many teammates also have this lead in their campaigns.
 */
import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";

import { leadbay_campaign_progression as CAMPAIGN_PROGRESSION_DESCRIPTION } from "../tool-descriptions.generated.js";

interface ProgressionParams {
  campaign_id: string;
  count?: number;
  page?: number;
}

interface PaginatedLeadsResponse {
  items: Array<{
    lead: Record<string, unknown>;
    progress: {
      total_contacts: number;
      in_progress: number;
      declined: number;
      headline: string | null;
    };
    affiliation: {
      own_campaigns: Array<{ id: string; name: string }>;
      other_users_campaign_count: number;
    };
  }>;
  pagination: { page: number; pages: number; total: number };
}

function hasOutreachSignal(
  progress: PaginatedLeadsResponse["items"][number]["progress"] | undefined,
): boolean {
  if (!progress) return false;
  return Boolean(
    progress.headline ||
      (progress.in_progress ?? 0) > 0 ||
      (progress.declined ?? 0) > 0,
  );
}

export const campaignProgression: Tool<ProgressionParams> = {
  name: "leadbay_campaign_progression",
  annotations: {
    title: "Read per-lead progression inside a campaign",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: CAMPAIGN_PROGRESSION_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      campaign_id: {
        type: "string",
        description: "Campaign UUID (from leadbay_create_campaign or leadbay_list_campaigns).",
      },
      count: { type: "number", description: "Leads per page (default 50, server-capped)." },
      page: { type: "number", description: "0-indexed page (default 0)." },
    },
    required: ["campaign_id"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        description:
          "Per-lead progression rows: {lead, progress: {total_contacts, in_progress, declined, headline}, affiliation: {own_campaigns, other_users_campaign_count}}. `headline` is the most recent interaction type (e.g. CONTACTED, MEETING_BOOKED, DECLINED).",
        items: { type: "object" },
      },
      pagination: {
        type: "object",
        properties: {
          page: { type: "number" },
          pages: { type: "number" },
          total: { type: "number" },
        },
      },
      summary: {
        type: "object",
        description:
          "Roll-up across the current page: how many leads have any outreach, how many converted to meetings, how many were declined.",
        properties: {
          page_size: { type: "number" },
          contacted: { type: "number" },
          in_progress: { type: "number" },
          declined: { type: "number" },
        },
      },
      _meta: {
        type: "object",
        properties: {
          region: { type: "string" },
          latency_ms: { type: ["number", "null"] },
        },
      },
    },
    required: ["items", "pagination", "summary"],
  },
  execute: async (client: LeadbayClient, params: ProgressionParams) => {
    const count = params.count ?? 50;
    const page = params.page ?? 0;
    const result = await client.request<PaginatedLeadsResponse>(
      "GET",
      `/campaigns/${params.campaign_id}/leads?count=${count}&page=${page}`,
    );

    // Page-level summary — useful for "manager wants a quick pulse" prompts.
    let contacted = 0;
    let inProgress = 0;
    let declined = 0;
    for (const row of result.items) {
      const p = row.progress;
      if (hasOutreachSignal(p)) contacted++;
      if ((p?.in_progress ?? 0) > 0) inProgress++;
      if ((p?.declined ?? 0) > 0) declined++;
    }

    return {
      items: result.items,
      pagination: result.pagination,
      summary: {
        page_size: result.items.length,
        contacted,
        in_progress: inProgress,
        declined,
      },
      _meta: {
        region: client.region,
        latency_ms: client.lastMeta?.latency_ms ?? null,
      },
    };
  },
};
