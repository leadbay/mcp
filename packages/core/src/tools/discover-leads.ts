import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import type { WishlistResponse } from "../types.js";

interface DiscoverLeadsParams {
  lensId?: number;
  page?: number;
  count?: number;
}

export const discoverLeads: Tool<DiscoverLeadsParams> = {
  name: "leadbay_discover_leads",
  description:
    "Get AI-recommended leads from Leadbay. Returns paginated lead summaries with scores, AI summaries, tags, and recommended contacts. After discovering leads, call leadbay_get_lead_profile on promising ones for full qualification data, web insights, and all contacts. If lensId is omitted, uses the active lens automatically.",
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
  },
  execute: async (client: LeadbayClient, params: DiscoverLeadsParams) => {
    const lensId = params.lensId ?? (await client.resolveDefaultLens());
    const page = params.page ?? 0;
    const count = Math.min(params.count ?? 20, 50);

    const res = await client.request<WishlistResponse>(
      "GET",
      `/lenses/${lensId}/leads/wishlist?count=${count}&page=${page}&contacts=true`
    );

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
    };
  },
};
