import type { LeadbayClient } from "../client.js";
import type {
  Tool,
  ToolContext,
  BulkEnrichPreview,
  WishlistResponse,
} from "../types.js";

interface EnrichTitlesParams {
  titles?: string[];
  leadIds?: string[];
  lensId?: number;
  email?: boolean;
  phone?: boolean;
  candidateCount?: number;
  dry_run?: boolean;
}

const DEFAULT_CANDIDATE_COUNT = 25;

export const enrichTitles: Tool<EnrichTitlesParams> = {
  name: "leadbay_enrich_titles",
  description:
    "Order contact enrichments by job title across many leads. Contacts are NOT returned by default with a lead " +
    "(Leadbay keeps enrichment out-of-band to control cost); the agent requests them on demand via this tool when " +
    "it's ready to actually reach out. Two modes: " +
    "(A) NO titles param — returns the available titles + Leadbay's title_suggestions + auto_included_titles " +
    "+ a count of enrichable contacts, so the agent can ask the user which titles to enrich. " +
    "(B) titles given — calls preview, then launches if there's anything enrichable. " +
    "On 429 returns {status:'quota_exceeded'} cleanly. Selection lifecycle is wrapped in a try/finally so the " +
    "user's selection is left clean even on error. " +
    "When to use: as the agent's go-to enrichment entry point, immediately before proposing outreach. " +
    "When NOT to use: to enrich a single contact — that's leadbay_enrich_contacts (granular). " +
    "Speculatively, before the user has committed to outreaching — enrichment spends credits.",
  inputSchema: {
    type: "object",
    properties: {
      titles: {
        type: "array",
        items: { type: "string" },
        description:
          "Job titles to enrich. Omit to discover what's available without launching.",
      },
      leadIds: {
        type: "array",
        items: { type: "string" },
        description:
          "Lead UUIDs to enrich. Omit to use the top page of the active lens's wishlist.",
      },
      lensId: {
        type: "number",
        description: "Lens id (escape hatch — defaults to active)",
      },
      email: { type: "boolean", description: "Enrich emails (default true)" },
      phone: { type: "boolean", description: "Enrich phone numbers (default false)" },
      candidateCount: {
        type: "number",
        description: `When leadIds is omitted, how many top-of-wishlist leads to use (default ${DEFAULT_CANDIDATE_COUNT})`,
      },
      dry_run: {
        type: "boolean",
        description: "If true, don't launch — only preview.",
      },
    },
  },
  execute: async (
    client: LeadbayClient,
    params: EnrichTitlesParams,
    ctx?: ToolContext
  ) => {
    const email = params.email ?? true;
    const phone = params.phone ?? false;

    if (!email && !phone) {
      return {
        error: true,
        code: "BAD_INPUT",
        message: "Either email or phone must be true",
        hint: "Set email:true (most common) or phone:true",
      };
    }

    const explicitLeadIds = params.leadIds && params.leadIds.length > 0;
    const selectionSource: "explicit" | "wishlist" = explicitLeadIds
      ? "explicit"
      : "wishlist";
    // Resolve lens_id once so bulkTracker gets it regardless of which branch
    // populates leadIds.
    const lensId = params.lensId ?? (await client.resolveDefaultLens());

    let leadIds = params.leadIds;
    if (!leadIds || leadIds.length === 0) {
      const cnt = params.candidateCount ?? DEFAULT_CANDIDATE_COUNT;
      const wish = await client.request<WishlistResponse>(
        "GET",
        `/lenses/${lensId}/leads/wishlist?count=${Math.min(cnt, 50)}&page=0`
      );
      leadIds = wish.items.map((l) => l.id);
    }

    if (leadIds.length === 0) {
      return {
        error: true,
        code: "NO_CANDIDATES",
        message: "No candidate leads",
        hint: "Pass leadIds explicitly or wait for the wishlist to compute",
      };
    }

    // Acquire selection lock — global state per token, must serialise.
    await client.acquireSelectionLock();
    try {
      const qs = leadIds
        .map((id) => `leadIds=${encodeURIComponent(id)}`)
        .join("&");
      await client.requestVoid("POST", `/leads/selection/select?${qs}`);

      try {
        // Get titles available across this selection.
        const availableTitles = await client.request<string[]>(
          "GET",
          "/leads/selection/enrichment/job_titles"
        );

        if (!params.titles || params.titles.length === 0) {
          // Branch A — discovery. Run a 0-titles preview to surface
          // title_suggestions / auto_included_titles / previously_enriched_titles.
          let suggestions: string[] = [];
          let autoIncluded: string[] = [];
          let previouslyEnriched: string[] = [];
          let enrichableContacts = 0;
          try {
            const prev = await client.request<BulkEnrichPreview>(
              "POST",
              "/leads/selection/enrichment/preview",
              { titles: [] }
            );
            suggestions = prev.title_suggestions ?? [];
            autoIncluded = prev.auto_included_titles ?? [];
            previouslyEnriched = prev.previously_enriched_titles ?? [];
            enrichableContacts = prev.enrichable_contacts;
          } catch (e: any) {
            ctx?.logger?.warn?.(
              `enrich_titles: 0-titles preview failed: ${e?.message}`
            );
          }
          return {
            mode: "discover",
            available_titles: availableTitles,
            recommendations: suggestions,
            auto_included: autoIncluded,
            previously_enriched: previouslyEnriched,
            enrichable_contacts: enrichableContacts,
            selected_lead_count: leadIds.length,
            next_action:
              "Pick titles to enrich and call leadbay_enrich_titles again with titles=[...]",
          };
        }

        // Branch B — preview then launch.
        let preview: BulkEnrichPreview;
        try {
          preview = await client.request<BulkEnrichPreview>(
            "POST",
            "/leads/selection/enrichment/preview",
            { titles: params.titles }
          );
        } catch (err: any) {
          if (err?.code === "QUOTA_EXCEEDED") {
            return {
              status: "quota_exceeded",
              message: "Quota exceeded on preview",
              retry_after_seconds: err?._meta?.retry_after ?? null,
            };
          }
          throw err;
        }

        if (preview.enrichable_contacts === 0) {
          return {
            mode: "preview_only",
            preview,
            launched: false,
            message:
              "No enrichable contacts for the chosen titles. Try other titles from available_titles or recommendations.",
            available_titles: availableTitles,
          };
        }

        if (params.dry_run) {
          return {
            mode: "dry_run",
            preview,
            launched: false,
            would_launch: { titles: params.titles, email, phone },
          };
        }

        // Two-phase launch: reserve a bulk slot via tracker BEFORE POSTing to
        // /launch. findOrCreatePending is atomic; if an identical bulk was
        // launched within the idempotency window, short-circuit without
        // spending quota. If the tracker is absent (e.g. legacy OpenClaw
        // deployment), fall through to the raw launch without tracking.
        const tracker = ctx?.bulkTracker;
        let bulkRecord:
          | { bulk_id: string; launched_at: string; durability: "file" | "memory" }
          | undefined;
        let bulkReused = false;
        let bulkSecondsSinceOriginal: number | undefined;
        if (tracker) {
          const res = await tracker.findOrCreatePending({
            lead_ids: leadIds,
            titles: params.titles,
            email,
            phone,
            lens_id: lensId,
            selection_source: selectionSource,
          });
          bulkRecord = {
            bulk_id: res.record.bulk_id,
            launched_at: res.record.launched_at,
            durability: res.record.durability,
          };
          bulkReused = res.reused;
          bulkSecondsSinceOriginal = res.seconds_since_original;

          if (bulkReused && res.record.status !== "failed") {
            // Skip /launch — quota preserved. The original launch's record is
            // reused verbatim so the agent polls the same bulk_id.
            return {
              mode: "already_launched",
              re_used: true,
              bulk_id: res.record.bulk_id,
              launched_at: res.record.launched_at,
              durability: res.record.durability,
              seconds_since_original_launch: bulkSecondsSinceOriginal ?? 0,
              titles: params.titles,
              email,
              phone,
              preview,
              message:
                "No new enrichment was ordered; quota not spent. An identical bulk was launched " +
                `${bulkSecondsSinceOriginal ?? 0}s ago. Poll leadbay_bulk_enrich_status with this bulk_id for results.`,
              next_action:
                "Call leadbay_bulk_enrich_status({bulk_id}) to check progress; include_contacts=true for the final read.",
            };
          }
        }

        try {
          await client.requestVoid(
            "POST",
            "/leads/selection/enrichment/launch",
            { titles: params.titles, email, phone }
          );
        } catch (err: any) {
          if (bulkRecord && tracker) {
            try {
              await tracker.markFailed(bulkRecord.bulk_id);
            } catch (e: any) {
              ctx?.logger?.warn?.(
                `enrich_titles: tracker.markFailed failed: ${e?.message ?? e}`
              );
            }
          }
          if (err?.code === "QUOTA_EXCEEDED") {
            return {
              status: "quota_exceeded",
              preview,
              message: "Quota exceeded on launch",
              retry_after_seconds: err?._meta?.retry_after ?? null,
            };
          }
          throw err;
        }

        if (bulkRecord && tracker) {
          try {
            await tracker.markLaunched(bulkRecord.bulk_id);
          } catch (e: any) {
            // Launch already succeeded on the backend; flipping the tracker
            // status failed. Return BULK_PENDING signal in the payload so the
            // agent knows the handle is in flight.
            ctx?.logger?.warn?.(
              `enrich_titles: tracker.markLaunched failed: ${e?.message ?? e}`
            );
            return {
              mode: "launched_tracker_pending",
              launched: true,
              preview,
              bulk_id: bulkRecord.bulk_id,
              launched_at: bulkRecord.launched_at,
              durability: bulkRecord.durability,
              titles: params.titles,
              email,
              phone,
              message:
                "Enrichment job launched on the backend, but the local tracker record could not be flipped to 'launched'. " +
                "The bulk_id is still valid — leadbay_bulk_enrich_status will return status:'pending' until the tracker heals.",
              next_action:
                "Wait ~60s, then call leadbay_bulk_enrich_status({bulk_id}). If it persists, restart the MCP.",
            };
          }
        }

        return {
          mode: "launched",
          preview,
          launched: true,
          titles: params.titles,
          email,
          phone,
          bulk_id: bulkRecord?.bulk_id,
          launched_at: bulkRecord?.launched_at,
          durability: bulkRecord?.durability,
          message: bulkRecord
            ? "Enrichment job launched. Backend has no server-side bulk_id yet; MCP minted a client-side bulk_id " +
              "(persisted to disk by default) so you can poll via leadbay_bulk_enrich_status."
            : "Enrichment job launched. No bulk_id tracker configured — poll leadbay_get_contacts per lead " +
              "after ~60s; contact.enrichment.done flips to true.",
          next_action: bulkRecord
            ? "Call leadbay_bulk_enrich_status({bulk_id}) after ~60s; pass include_contacts=true for the final read."
            : "Wait ~60s, then call leadbay_research_lead or leadbay_get_contacts on the leads you care about.",
        };
      } finally {
        // Always clear, but never re-throw from finally (would mask the
        // original error if there was one).
        try {
          await client.requestVoid("POST", "/leads/selection/clear");
        } catch (e: any) {
          ctx?.logger?.warn?.(
            `enrich_titles: selection.clear failed: ${e?.message ?? e?.code}`
          );
        }
      }
    } finally {
      client.releaseSelectionLock();
    }
  },
};
