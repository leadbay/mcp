/**
 * leadbay_extend_lens — POST /lenses/{id}/extra_refill
 *
 * Queues an additive extra-refill on the lens, optionally biased by
 * agent-picked seeds. Subject to the per-org daily LENS_EXTRA_REFILL
 * quota (FREEMIUM=0 / TIER1=150 / TIER2=1000). The backend rejects the
 * full batch outright if it doesn't fit — no partial fulfillment.
 *
 * Backend contract: api-specs backend/1.6/routes/lenses/extra_refill.yml.
 *
 * Documented error envelopes (translated from raw API errors so the agent
 * can route on `status` instead of probing the LeadbayError shape):
 *   - 429 quota_exceeded     → { status: "quota_exceeded", ... }
 *   - 409 refresh_in_progress → { status: "refresh_in_progress", ... }
 *   - 400 no_valid_seeds      → { status: "no_valid_seeds", ... }
 *
 * Unexpected errors propagate via the LeadbayError throw path.
 */
import type { LeadbayClient } from "../client.js";
import type { Tool, LeadbayError, QuotaStatusPayload } from "../types.js";

import { leadbay_extend_lens as EXTEND_LENS_DESCRIPTION } from "../tool-descriptions.generated.js";

interface ExtendLensParams {
  lensId?: number;
  seed_lead_ids?: string[];
  extra_count?: number;
}

interface ExtraRefillResponse {
  accepted_seeds: string[];
}

function httpStatus(err: unknown): number | undefined {
  return (err as Partial<LeadbayError>)?._meta?.http_status;
}

async function readExtraRefillQuota(
  client: LeadbayClient,
): Promise<{ count: number | null; resets_at: string | null }> {
  try {
    const me = await client.resolveMe();
    const quota = await client.request<QuotaStatusPayload>(
      "GET",
      `/organizations/${me.organization.id}/quota_status`,
    );
    // Look in the org group first (admins get it, and the refill quota is
    // org-scoped there), then fall back to the user group — non-admin callers
    // only receive `user`, so reading org-only would make the row invisible for
    // them and skip the pre-check entirely. Match case-insensitively: the
    // backend emits this resource type as lowercase `lens_extra_refill` on the
    // live wire, though older shapes / fixtures use uppercase
    // `LENS_EXTRA_REFILL`. An exact-case === would miss the row and null out
    // used_today/resets_at on the quota_exceeded path.
    const isRefill = (r: { resource_type?: string }) =>
      r.resource_type?.toUpperCase() === "LENS_EXTRA_REFILL";
    const entry =
      quota.org?.resources?.find(isRefill) ??
      quota.user?.resources?.find(isRefill);
    return {
      count: entry?.count ?? null,
      resets_at: entry?.resets_at ?? null,
    };
  } catch {
    return { count: null, resets_at: null };
  }
}

export const extendLens: Tool<ExtendLensParams> = {
  name: "leadbay_extend_lens",
  annotations: {
    title: "Extend a lens with additional leads (extra refill)",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  description: EXTEND_LENS_DESCRIPTION,
  optional: true, // gated behind LEADBAY_MCP_WRITE=1 in MCP
  inputSchema: {
    type: "object",
    properties: {
      lensId: {
        type: "number",
        description:
          "Lens to extend. Defaults to the user's last-active lens.",
      },
      seed_lead_ids: {
        type: "array",
        description:
          "Optional list of lead UUIDs from leadbay_seed_candidates to bias the recommender. Omit or empty array → default-strategy fallback (same behaviour as a normal fill).",
        items: { type: "string" },
      },
      extra_count: {
        type: "number",
        description:
          "How many extra leads to request. Omit to use the backend default. The full requested count must fit into the remaining daily LENS_EXTRA_REFILL quota — otherwise the call is rejected outright (status: quota_exceeded).",
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        description:
          "queued | quota_exceeded | refresh_in_progress | no_valid_seeds",
      },
      lens: {
        type: "object",
        properties: { id: { type: "number" } },
      },
      accepted_seeds: {
        type: "array",
        description:
          "Subset of seed_lead_ids that passed validation and will bias the fill. Empty when no seeds were submitted (default-strategies fallback). Present only on status=queued.",
        items: { type: "string" },
      },
      message: {
        type: "string",
        description:
          "Human-readable summary. On error statuses, this is the line to surface to the user.",
      },
      quota: {
        type: "object",
        description:
          "Only present on status=quota_exceeded. Shows the org's daily LENS_EXTRA_REFILL state.",
        properties: {
          used_today: { type: ["number", "null"] },
          resets_at: { type: ["string", "null"] },
        },
      },
    },
    required: ["status", "lens"],
  },
  execute: async (client: LeadbayClient, params: ExtendLensParams) => {
    const lensId = params.lensId ?? (await client.resolveDefaultLens());

    const body: Record<string, unknown> = {
      seed_lead_ids: params.seed_lead_ids ?? [],
    };
    if (params.extra_count != null) {
      body.extra_count = params.extra_count;
    }

    try {
      const res = await client.request<ExtraRefillResponse>(
        "POST",
        `/lenses/${lensId}/extra_refill`,
        body,
      );
      return {
        status: "queued" as const,
        lens: { id: lensId },
        accepted_seeds: res.accepted_seeds,
        message:
          "Extra refill queued. Leads stream in asynchronously — call leadbay_pull_leads in ~30s to see them.",
      };
    } catch (err) {
      const status = httpStatus(err);

      if (status === 429) {
        const q = await readExtraRefillQuota(client);
        return {
          status: "quota_exceeded" as const,
          lens: { id: lensId },
          quota: { used_today: q.count, resets_at: q.resets_at },
          message:
            "Daily LENS_EXTRA_REFILL quota exhausted. Surface to user: (1) try a smaller extra_count, (2) wait for the daily reset" +
            (q.resets_at ? ` (resets at ${q.resets_at})` : "") +
            ", or (3) upgrade plan for a higher daily limit (TIER1=150, TIER2=1000).",
        };
      }

      if (status === 409) {
        return {
          status: "refresh_in_progress" as const,
          lens: { id: lensId },
          message:
            "A refresh or extra-refill is already running on this lens. Wait, then call leadbay_pull_leads in ~30s.",
        };
      }

      if (status === 400) {
        return {
          status: "no_valid_seeds" as const,
          lens: { id: lensId },
          message:
            "Every submitted seed failed validation (likely stale — the lens shape may have changed). Refetch via leadbay_seed_candidates and retry.",
        };
      }

      throw err;
    }
  },
};
