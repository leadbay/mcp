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
 *
 * Extendability pre-flight (product#4000). `POST /extra_refill` answers
 * `200 {"accepted_seeds": []}` on a lens that cannot gain a single lead, and
 * the fill it queues consumes no quota and delivers nothing — so the caller
 * gets the same envelope whether the refill will work or is futile. 3Bricks'
 * agent read that as "queued", waited, found nothing, and extended again: 49
 * `extend_lens` + 333 `set_active_lens` calls over 22 days, then churn.
 * `GET /extra_refill_preview` already answers the question the POST hides —
 * `available_count` is the size of the pool the refill would draw from — so we
 * ask it first and refuse to queue a refill that has nothing to add. Measured
 * on FR staging 2026-08-28: the zero-candidate lens (7137) previews
 * `available_count: 0` while `POST /extra_refill` on it still returns 200.
 *
 * The pre-flight NEVER blocks a working refill: an unreadable preview (older
 * backend without the route, transient failure) falls through to the POST.
 */
import type { LeadbayClient } from "../client.js";
import type { Tool, LeadbayError, QuotaStatusPayload } from "../types.js";

import { leadbay_extend_lens as EXTEND_LENS_DESCRIPTION } from "../tool-descriptions.generated.js";
import { readAudienceShape } from "./_empty-lens-reason.js";

interface ExtendLensParams {
  lensId?: number;
  seed_lead_ids?: string[];
  extra_count?: number;
}

interface ExtraRefillResponse {
  accepted_seeds: string[];
}

type AudienceShapeCriteria = Awaited<
  ReturnType<typeof readAudienceShape>
>["criteria"];
type AudienceShapeLocations = Awaited<
  ReturnType<typeof readAudienceShape>
>["narrow_locations"];

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

/** `GET /lenses/{id}/extra_refill_preview`, the shape the FE reads too. */
interface ExtraRefillPreview {
  available_count?: number;
  capped?: boolean;
  cap?: number;
  quota_remaining?: number | null;
  max_requestable_count?: number;
}

/**
 * How many leads a refill on this lens could still draw. `null` means the
 * question could not be answered — which is NOT the same as zero and must
 * never block the refill.
 */
async function readAvailablePool(
  client: LeadbayClient,
  lensId: number,
): Promise<number | null> {
  try {
    const preview = await client.request<ExtraRefillPreview>(
      "GET",
      `/lenses/${lensId}/extra_refill_preview`,
    );
    return typeof preview?.available_count === "number"
      ? preview.available_count
      : null;
  } catch {
    return null;
  }
}

/** How many leads the lens holds today. `null` when unreadable. */
async function readLensLeadTotal(
  client: LeadbayClient,
  lensId: number,
): Promise<number | null> {
  try {
    const page = await client.request<{ pagination?: { total?: number } }>(
      "GET",
      `/lenses/${lensId}/leads/wishlist?count=1&page=0`,
    );
    return typeof page?.pagination?.total === "number"
      ? page.pagination.total
      : null;
  } catch {
    return null;
  }
}

/**
 * Turn "the pool is empty" into the line the agent should say, using the same
 * `code` vocabulary `leadbay_pull_leads` already emits in `empty_reason` — one
 * taxonomy across both tools, so an agent that learned to route on it once
 * routes correctly here too.
 *
 * Nothing is guessed: `held` decides between the two refinements, and when it
 * is unreadable we report the bare observation (`no_candidates`) rather than a
 * theory about which of the two it is.
 */
function noCandidatesReason(
  held: number | null,
  shape: Awaited<ReturnType<typeof readAudienceShape>>,
): {
  code: "audience_too_narrow" | "no_new_leads" | "no_candidates";
  message: string;
  retryable: false;
  criteria?: AudienceShapeCriteria;
  narrow_locations?: AudienceShapeLocations;
} {
  const { geoSentence, ...extras } = shape;
  // The sentence every branch ends with: what to do, and what not to do again.
  const futile =
    " Extending again is futile — a refill on a lens with an empty candidate pool reports queued, consumes no quota and delivers nothing.";

  if (held === 0) {
    return {
      code: "audience_too_narrow",
      retryable: false,
      message:
        "This lens holds no leads and has none left to add: its criteria intersect to nothing." +
        geoSentence +
        futile +
        " Tell the user which criteria are in play and offer to widen the audience (leadbay_adjust_audience).",
      ...extras,
    };
  }

  if (held !== null) {
    return {
      code: "no_new_leads",
      retryable: false,
      message:
        `Every company matching this lens has already been delivered — all ${held} of them — so there is nothing left to add.` +
        futile +
        " Tell the user; offer to widen the audience (leadbay_adjust_audience) or work the leads already in the lens (leadbay_pull_followups).",
      ...extras,
    };
  }

  return {
    code: "no_candidates",
    retryable: false,
    message:
      "This lens has no candidates left to add." +
      geoSentence +
      futile +
      " Tell the user and offer to widen the audience (leadbay_adjust_audience).",
    ...extras,
  };
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
          "queued | no_candidates | quota_exceeded | refresh_in_progress | no_valid_seeds",
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
      available_count: {
        type: ["number", "null"],
        description:
          "How many leads a refill on this lens could still draw, read from /extra_refill_preview before queueing. 0 means the refill was NOT queued (status=no_candidates). null means the pool could not be read and the refill was queued anyway.",
      },
      reason: {
        type: "object",
        description:
          "Only present on status=no_candidates. Same shape and `code` vocabulary as leadbay_pull_leads' empty_reason, so one routing rule covers both tools.",
        properties: {
          code: {
            type: "string",
            description:
              "audience_too_narrow (lens holds nothing and its criteria intersect to nothing) | no_new_leads (everything matching has already been delivered) | no_candidates (pool is empty; which of the two could not be determined)",
          },
          message: { type: "string" },
          retryable: {
            type: "boolean",
            description:
              "Always false here. Re-calling leadbay_extend_lens cannot change the outcome — widen the audience instead.",
          },
          criteria: {
            type: "object",
            description: "The criteria in play, so the agent can name them.",
          },
          narrow_locations: {
            type: "array",
            description:
              "Include-locations that resolved to city-scale or smaller — the usual thing to relax first.",
            items: { type: "object" },
          },
        },
        required: ["code", "message", "retryable"],
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

    // Extendability pre-flight — see the file header. One read, and only this
    // read, stands between the agent and a refill that cannot deliver.
    const availableCount = await readAvailablePool(client, lensId);
    if (availableCount === 0) {
      // Bad path only: two more reads to say WHICH kind of empty this is.
      const [shape, held] = await Promise.all([
        readAudienceShape(client, lensId),
        readLensLeadTotal(client, lensId),
      ]);
      const reason = noCandidatesReason(held, shape);
      return {
        status: "no_candidates" as const,
        lens: { id: lensId },
        available_count: 0,
        reason,
        message: reason.message,
      };
    }

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
        available_count: availableCount,
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
