import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import type { WishlistResponse } from "../types.js";
import { leadbay_discover_leads as DISCOVER_LEADS_DESCRIPTION } from "../tool-descriptions.generated.js";

interface DiscoverLeadsParams {
  lensId?: number;
  page?: number;
  count?: number;
}

export const discoverLeads: Tool<DiscoverLeadsParams> = {
  name: "leadbay_discover_leads",
  annotations: {
    title: "Discover leads in a lens",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: DISCOVER_LEADS_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      lensId: {
        type: "number",
        description: "Lens ID (optional, auto-resolves to the active lens)",
      },
      page: {
        type: "number",
        description: "Page number, 0-indexed (default: 0)",
      },
      count: {
        type: "number",
        description: "Results per page, max 50 (default: 20)",
      },
    },
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: DiscoverLeadsParams) => {
    const lensId = params.lensId ?? (await client.resolveDefaultLens());
    const page = params.page ?? 0;
    const count = Math.min(params.count ?? 20, 50);

    const res = await client.request<WishlistResponse>(
      "GET",
      `/lenses/${lensId}/leads/wishlist?count=${count}&page=${page}&contacts=true`
    );

    const totalPages = res.pagination?.pages ?? 0;
    const currentPage = res.pagination?.page ?? page;
    const hasMore = currentPage < totalPages - 1;
    const nextPage = hasMore ? currentPage + 1 : null;

    return {
      leads: res.items.map((lead) => ({
        id: lead.id,
        name: lead.name,
        score: lead.score,
        ai_agent_lead_score: lead.ai_agent_lead_score,
        location: lead.location,
        description: lead.description,
        size: lead.size,
        website: lead.website,
        contacts_count: lead.contacts_count,
        ai_summary: lead.ai_summary,
        split_ai_summary: lead.split_ai_summary,
        tags: lead.tags,
        phone_numbers: lead.phone_numbers,
        keywords: lead.keywords,
        recommended_contact_title: lead.recommended_contact_title ?? null,
        recommended_contact: lead.recommended_contact ?? null,
      })),
      pagination: res.pagination,
      has_more: hasMore,
      next_page: nextPage,
    };
  },
};
