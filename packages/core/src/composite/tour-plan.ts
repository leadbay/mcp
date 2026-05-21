/**
 * leadbay_tour_plan — mixed-mode itinerary for #3630 US1.
 *
 * Combines Monitor follow-ups in <city> (`pullFollowups`) with fresh
 * Discover leads from the active lens (`pullLeads`) so the agent can
 * propose "3 existing customers + 3 qualified prospects + 3 new
 * discoveries" on a single map.
 *
 * Discover leads don't have a server-side geo filter (the wishlist API
 * is lens-wide). We pull a larger page than requested, then filter
 * client-side by city/state match. This is a best-effort filter;
 * downstream the prompt should explicitly call out which discover
 * leads came from the requested city vs. nearby.
 */
import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";
import { pullFollowups } from "./pull-followups.js";
import { pullLeads } from "./pull-leads.js";

import { leadbay_tour_plan as TOUR_PLAN_DESCRIPTION } from "../tool-descriptions.generated.js";

interface TourPlanParams {
  city?: string;
  city_id?: string;
  /** Default 6 — covers "customers" + "qualified" buckets from #3630 US1. */
  followups_count?: number;
  /** Default 6 — over-pull to compensate for client-side geo filter. */
  discover_count?: number;
}

const DEFAULT_FOLLOWUPS_COUNT = 6;
const DEFAULT_DISCOVER_COUNT = 6;
const DISCOVER_OVER_PULL = 30; // pull this many then filter to discover_count

function cityMatches(lead: any, cityHint: string | undefined): boolean {
  if (!cityHint) return true;
  const hint = cityHint.toLowerCase();
  const loc = lead?.location ?? {};
  const haystacks = [loc.city, loc.state, loc.country, loc.full]
    .filter((v) => typeof v === "string")
    .map((v: string) => v.toLowerCase());
  return haystacks.some((h) => h.includes(hint) || hint.includes(h));
}

export const tourPlan: Tool<TourPlanParams> = {
  name: "leadbay_tour_plan",
  annotations: {
    title: "Plan a mixed-mode tour itinerary (known + fresh leads)",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: TOUR_PLAN_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      city: {
        type: "string",
        description:
          "Free-text city or region (e.g. 'Limoges', 'Bay Area'). Resolved via the same /geo/search the followups_map uses. Ambiguous matches surface as `status: ambiguous_locations` with location_ambiguities[]; pick a location id and re-call with city_id.",
      },
      city_id: {
        type: "string",
        description:
          "Pre-resolved admin_area id (numeric string). Bypasses the resolver.",
      },
      followups_count: {
        type: "number",
        description: `Top-N follow-up (Monitor) leads to return. Default ${DEFAULT_FOLLOWUPS_COUNT}.`,
      },
      discover_count: {
        type: "number",
        description: `Top-N Discover leads (active lens wishlist) to return after client-side city filter. Default ${DEFAULT_DISCOVER_COUNT}.`,
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      city: { type: ["string", "null"] },
      city_id: { type: ["string", "null"] },
      monitor_leads: {
        type: "array",
        description:
          "Follow-up (Monitor) leads in the requested city, sorted by AI / firmographic score. Each lead carries the same shape as pull_followups.",
        items: { type: "object" },
      },
      discover_leads: {
        type: "array",
        description:
          "Fresh Discover leads from the active lens, filtered client-side to match the city. Pulls a larger candidate set internally to compensate for the missing server-side geo filter.",
        items: { type: "object" },
      },
      discover_filter_note: {
        type: "string",
        description:
          "Human-readable summary of the client-side geo filter applied to Discover leads (e.g. 'matched 3/30 by city/state').",
      },
      status: {
        type: "string",
        description:
          "'ambiguous_locations' when the passed `city` matched multiple admin areas — pick an id from location_ambiguities and re-call with city_id.",
      },
      location_ambiguities: {
        type: "array",
        items: { type: "object" },
      },
      _meta: {
        type: "object",
        properties: {
          region: { type: "string" },
          latency_ms: { type: ["number", "null"] },
        },
      },
    },
    required: ["monitor_leads", "discover_leads"],
  },
  execute: async (
    client: LeadbayClient,
    params: TourPlanParams,
    ctx?: ToolContext,
  ) => {
    const followupsCount = params.followups_count ?? DEFAULT_FOLLOWUPS_COUNT;
    const discoverCount = params.discover_count ?? DEFAULT_DISCOVER_COUNT;

    // Run both pulls in parallel — they hit independent backends (Monitor
    // vs Wishlist), so there's no dependency.
    const [followupsResult, leadsResult] = await Promise.allSettled([
      pullFollowups.execute(
        client,
        {
          city: params.city,
          city_id: params.city_id,
          count: followupsCount,
        },
        ctx,
      ),
      pullLeads.execute(client, { count: DISCOVER_OVER_PULL }, ctx),
    ]);

    // Monitor side: surface ambiguity verbatim if the city was ambiguous.
    if (followupsResult.status === "fulfilled") {
      const r = followupsResult.value as any;
      if (r?.status === "ambiguous_locations") {
        return {
          status: "ambiguous_locations" as const,
          location_ambiguities: r.location_ambiguities,
          monitor_leads: [],
          discover_leads: [],
          discover_filter_note:
            "City was ambiguous; pick an id and re-call to proceed.",
          city: params.city ?? null,
          city_id: params.city_id ?? null,
          _meta: {
            region: client.region,
            latency_ms: client.lastMeta?.latency_ms ?? null,
          },
        };
      }
    }

    const monitorLeads =
      followupsResult.status === "fulfilled"
        ? ((followupsResult.value as any)?.leads ?? [])
        : [];
    if (followupsResult.status === "rejected") {
      ctx?.logger?.warn?.(
        `tour_plan: pull_followups failed: ${followupsResult.reason?.message ?? followupsResult.reason}`,
      );
    }

    const rawDiscover =
      leadsResult.status === "fulfilled"
        ? ((leadsResult.value as any)?.leads ?? [])
        : [];
    if (leadsResult.status === "rejected") {
      ctx?.logger?.warn?.(
        `tour_plan: pull_leads failed: ${leadsResult.reason?.message ?? leadsResult.reason}`,
      );
    }

    // Filter Discover leads by client-side city match. The Monitor side
    // already filtered server-side, so we don't re-filter those.
    const filtered = rawDiscover.filter((l: any) => cityMatches(l, params.city));
    const discoverLeads = filtered.slice(0, discoverCount);

    const filterNote = params.city
      ? `Matched ${filtered.length}/${rawDiscover.length} Discover leads to '${params.city}'; returning top ${discoverLeads.length}.`
      : `No city filter applied; returning top ${discoverLeads.length} Discover leads.`;

    return {
      city: params.city ?? null,
      city_id: params.city_id ?? null,
      monitor_leads: monitorLeads,
      discover_leads: discoverLeads,
      discover_filter_note: filterNote,
      _meta: {
        region: client.region,
        latency_ms: client.lastMeta?.latency_ms ?? null,
      },
    };
  },
};
