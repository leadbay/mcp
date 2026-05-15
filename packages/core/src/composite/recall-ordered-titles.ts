import type { LeadbayClient } from "../client.js";
import type {
  Tool,
  ToolContext,
  BulkEnrichPreview,
  PaidContactPayload,
  WishlistResponse,
} from "../types.js";

import { leadbay_recall_ordered_titles as RECALL_ORDERED_TITLES_DESCRIPTION } from "../tool-descriptions.generated.js";
interface RecallOrderedTitlesParams {
  leadIds?: string[];
  lensId?: number;
}

interface TitleStat {
  title: string;
  leads_with_enriched: number;
  total_enriched_contacts: number;
  leads_still_having_unenriched: number;
}

export const recallOrderedTitles: Tool<RecallOrderedTitlesParams> = {
  name: "leadbay_recall_ordered_titles",
  annotations: {
    title: "Recall titles previously enriched",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: RECALL_ORDERED_TITLES_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      leadIds: {
        type: "array",
        items: { type: "string" },
        description:
          "Lead UUIDs to query. Omit to use the current wishlist (top page).",
      },
      lensId: {
        type: "number",
        description:
          "Override the auto-resolved last-active lens when omitting leadIds (escape hatch)",
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      source: {
        type: "string",
        description:
          "'preview_field' (preferred backend path) or 'live_aggregate' (fallback aggregation across each lead's contacts).",
      },
      titles: {
        type: "array",
        description:
          "Titles previously enriched. preview_field path: [{title}]. live_aggregate path: [{title, leads_with_enriched, total_enriched_contacts, leads_still_having_unenriched}].",
        items: { type: "object" },
      },
      available_in_selection: {
        type: "array",
        description:
          "Backend-suggested title candidates available for ordering (preview_field path only).",
        items: { type: "object" },
      },
      note: {
        type: "string",
        description:
          "Operator note explaining the chosen path (e.g., empty input set, fallback in use).",
      },
    },
    required: ["source", "titles"],
  },
  execute: async (
    client: LeadbayClient,
    params: RecallOrderedTitlesParams,
    ctx?: ToolContext
  ) => {
    let leadIds = params.leadIds;

    if (!leadIds || leadIds.length === 0) {
      const lensId = params.lensId ?? (await client.resolveDefaultLens());
      const wish = await client.request<WishlistResponse>(
        "GET",
        `/lenses/${lensId}/leads/wishlist?count=50&page=0`
      );
      leadIds = wish.items.map((l) => l.id);
    }

    if (leadIds.length === 0) {
      return { titles: [], source: "live_aggregate", note: "No candidate leads" };
    }

    // Try preferred path: select → preview (titles=[]) → read previously_enriched_titles → clear.
    // Selection state is global per token, so we serialise via the client Mutex.
    await client.acquireSelectionLock();
    try {
      const qs = leadIds
        .map((id) => `leadIds=${encodeURIComponent(id)}`)
        .join("&");
      try {
        await client.requestVoid(
          "POST",
          `/leads/selection/select?${qs}`
        );
        const preview = await client.request<BulkEnrichPreview>(
          "POST",
          "/leads/selection/enrichment/preview",
          { titles: [] }
        );
        if (
          Array.isArray(preview.previously_enriched_titles) &&
          preview.previously_enriched_titles.length > 0
        ) {
          // Backend has the field — return its data directly.
          return {
            source: "preview_field",
            titles: preview.previously_enriched_titles.map((t) => ({ title: t })),
            available_in_selection: preview.title_suggestions ?? [],
          };
        }
      } catch (err: any) {
        ctx?.logger?.warn?.(
          `recall_ordered_titles: preview path failed: ${err?.message ?? err?.code ?? err}`
        );
      } finally {
        try {
          await client.requestVoid("POST", "/leads/selection/clear");
        } catch (e: any) {
          ctx?.logger?.warn?.(
            `recall_ordered_titles: selection clear failed: ${e?.message}`
          );
        }
      }
    } finally {
      client.releaseSelectionLock();
    }

    // Fallback path: live aggregate from each lead's enriched contacts.
    const titleStats = new Map<string, TitleStat>();
    await Promise.all(
      leadIds.map(async (leadId) => {
        try {
          const contacts = await client.request<PaidContactPayload[]>(
            "GET",
            `/leads/${leadId}/enrich/contacts?IncludeEnriched=true`
          );
          const enriched = contacts.filter((c) => c.enrichment?.done && c.job_title);
          const unenriched = contacts.filter((c) => !c.enrichment?.done && c.job_title);
          const titlesEnrichedHere = new Set(
            enriched.map((c) => c.job_title!)
          );
          for (const t of titlesEnrichedHere) {
            const cur =
              titleStats.get(t) ??
              ({
                title: t,
                leads_with_enriched: 0,
                total_enriched_contacts: 0,
                leads_still_having_unenriched: 0,
              } as TitleStat);
            cur.leads_with_enriched += 1;
            cur.total_enriched_contacts += enriched.filter(
              (c) => c.job_title === t
            ).length;
            titleStats.set(t, cur);
          }
          // Tally still-unenriched per title — useful to know if it's worth re-ordering.
          for (const c of unenriched) {
            const t = c.job_title!;
            const cur = titleStats.get(t);
            if (cur) cur.leads_still_having_unenriched += 1;
          }
        } catch (err: any) {
          ctx?.logger?.warn?.(
            `recall_ordered_titles: contacts fetch failed for ${leadId}: ${err?.message}`
          );
        }
      })
    );

    return {
      source: "live_aggregate",
      titles: [...titleStats.values()].sort(
        (a, b) => b.total_enriched_contacts - a.total_enriched_contacts
      ),
      note:
        "Aggregated from individual leads' contacts (the backend's previously_enriched_titles field is not yet available). " +
        "Once it ships, this composite switches to the cheaper preview-field path automatically.",
    };
  },
};
