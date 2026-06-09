import type { LeadbayClient } from "../client.js";
import type {
  Tool,
  ToolContext,
  BulkEnrichPreview,
  WishlistResponse,
} from "../types.js";

import { leadbay_enrich_titles as ENRICH_TITLES_DESCRIPTION } from "../tool-descriptions.generated.js";
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
  annotations: {
    title: "Enrich contact titles across leads",
    readOnlyHint: false,
    // Mode A (no titles): non-destructive preview returning candidates.
    // Mode B (with titles): launches enrichment job. Net classification is
    // destructive because the dominant flow mutates state.
    destructiveHint: true,
    // Idempotent against the same selection + titles set (same hash → same
    // bulk_id; backend silently no-ops on already-enriched contacts).
    idempotentHint: true,
    openWorldHint: true,
  },
  description: ENRICH_TITLES_DESCRIPTION,
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
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    description:
      "Branchy return shape; the `mode` (or `status`) field tells the agent which branch it got. Modes: 'discover' (no titles passed), 'preview_only' (no enrichable contacts), 'dry_run', 'already_launched' (idempotent reuse), 'launched_tracker_pending' (rare, soft-fail), 'launched' (happy path). Status: 'quota_exceeded' (429).",
    properties: {
      mode: {
        type: "string",
        description: "'discover' | 'preview_only' | 'dry_run' | 'already_launched' | 'launched_tracker_pending' | 'launched'.",
      },
      status: {
        type: "string",
        description: "'quota_exceeded' on 429. Otherwise mode is set instead.",
      },
      available_titles: {
        type: "array",
        description: "Titles available across the selection (discover/preview_only modes).",
        items: { type: "string" },
      },
      recommendations: {
        type: "array",
        description: "Backend's title_suggestions (discover mode).",
        items: { type: "string" },
      },
      auto_included: {
        type: "array",
        description: "Backend's auto_included_titles (discover mode).",
        items: { type: "string" },
      },
      previously_enriched: {
        type: "array",
        description: "Titles previously enriched on this selection (discover mode).",
        items: { type: "string" },
      },
      enrichable_contacts: {
        type: "number",
        description: "Count of enrichable contacts at preview time.",
      },
      selected_lead_count: {
        type: "number",
        description: "How many leads the selection covers.",
      },
      preview: {
        type: "object",
        description: "Backend BulkEnrichPreview payload (preview_only/dry_run/launched modes).",
      },
      launched: {
        type: "boolean",
        description: "True when an enrichment job is in flight on the backend.",
      },
      would_launch: {
        type: "object",
        description: "What dry_run WOULD have launched (titles, email, phone).",
      },
      re_used: {
        type: "boolean",
        description: "True when an identical bulk was launched within the idempotency window (already_launched mode).",
      },
      bulk_id: {
        type: "string",
        description: "UUIDv4 to poll via leadbay_bulk_enrich_status.",
      },
      launched_at: {
        type: "string",
        description: "ISO timestamp of the (re-used or fresh) launch.",
      },
      durability: {
        type: "string",
        description: "'file' (persisted bulks.json) or 'memory'.",
      },
      seconds_since_original_launch: {
        type: "number",
        description: "Age of the re-used bulk record (already_launched mode).",
      },
      titles: {
        type: "array",
        description: "Titles ordered (echoed at launch).",
        items: { type: "string" },
      },
      email: { type: "boolean" },
      phone: { type: "boolean" },
      message: {
        type: "string",
        description: "Operator-facing summary of what happened.",
      },
      next_action: {
        type: "string",
        description: "Concrete next-step instruction for the agent.",
      },
      retry_after_seconds: {
        type: ["number", "null"],
        description: "Seconds until quota resets (quota_exceeded status).",
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

    // Phase 1/3: selection lock + select. Surface a tick so the agent can
    // tell the user the long op is in motion (otherwise the spinner is mute).
    ctx?.progress?.({
      progress: 1,
      total: 3,
      message: `Selecting ${leadIds.length} lead${leadIds.length === 1 ? "" : "s"}…`,
    });
    // Acquire selection lock — global state per token, must serialise.
    await client.acquireSelectionLock();
    try {
      const qs = leadIds
        .map((id) => `leadIds=${encodeURIComponent(id)}`)
        .join("&");
      await client.requestVoid("POST", `/leads/selection/select?${qs}`);

      try {
        // Phase 2/3: preview the enrichment (title discovery + counts).
        ctx?.progress?.({
          progress: 2,
          total: 3,
          message: "Previewing enrichment (titles + counts)…",
        });
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
              notification_id: res.record.notification_id ?? null,
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

        // Phase 3/3: launch the enrichment job on the backend.
        ctx?.progress?.({
          progress: 3,
          total: 3,
          message: `Launching enrichment for ${params.titles.length} title${params.titles.length === 1 ? "" : "s"}…`,
        });
        // Backend ADR docs/adr/notifications.md: launch now returns
        // BulkLaunchResponse { notification_id }. Capture it so:
        //   (a) bulk_enrich_status can read bulk_progress from a single
        //       /notifications call instead of fanning out per-lead,
        //   (b) the WS listener can correlate completion frames back to
        //       the agent's prior outputs.
        let launchResp: { notification_id: string | null } | null = null;
        try {
          launchResp = await client.request<{ notification_id: string | null }>(
            "POST",
            "/leads/selection/enrichment/launch",
            { titles: params.titles, email, phone }
          );
        } catch (err: any) {
          // iter-21: ctx.signal abort during launch → mark the pending
          // record cancelled so subsequent bulk_enrich_status returns
          // BULK_CANCELLED instead of "still launched". AbortError surfaces
          // as either err.name === "AbortError" or signal.aborted at catch
          // time; both are handled.
          const aborted =
            err?.name === "AbortError" || ctx?.signal?.aborted === true;
          if (bulkRecord && tracker) {
            try {
              if (aborted) {
                await tracker.markCancelled(bulkRecord.bulk_id);
              } else {
                await tracker.markFailed(bulkRecord.bulk_id);
              }
            } catch (e: any) {
              ctx?.logger?.warn?.(
                `enrich_titles: tracker.${aborted ? "markCancelled" : "markFailed"} failed: ${e?.message ?? e}`
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

        const notificationId = launchResp?.notification_id ?? null;
        if (bulkRecord && tracker) {
          try {
            await tracker.markLaunched(bulkRecord.bulk_id, notificationId);
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
          notification_id: notificationId,
          message: notificationId
            ? "Enrichment job launched. The MCP is now listening for the backend notification — when " +
              "enrichment finishes, a `_meta.notifications` entry will surface on your next tool response " +
              "(also visible in `leadbay_account_status.notifications`)."
            : bulkRecord
              ? "Enrichment job launched. Backend did not return a notification id this time; poll via " +
                "leadbay_bulk_enrich_status with the bulk_id."
              : "Enrichment job launched. No bulk_id tracker configured — poll leadbay_get_contacts per lead " +
                "after ~60s; contact.enrichment.done flips to true.",
          next_action: notificationId
            ? "Wait for the next `_meta.notifications` entry (typically <2 min for a small batch). If you want progress sooner, call leadbay_bulk_enrich_status({bulk_id})."
            : bulkRecord
              ? "Call leadbay_bulk_enrich_status({bulk_id}) after ~60s; pass include_contacts=true for the final read."
              : "Wait ~60s, then call leadbay_research_lead_by_id or leadbay_get_contacts on the leads you care about.",
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
