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

type TourMode = "★ Customer" | "★ Qualified" | "✦ New";

interface MapLocation {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  notes: string;
}

/**
 * Pre-shape one lead into a `places_map_display_v0` entry, with the mode
 * badge baked into the notes string. Returns null when the lead has no
 * usable lat/lng — the caller filters those out and counts them in
 * map_summary. Mirrors the proven builder in campaign-call-sheet.ts so the
 * agent never has to hand-construct the widget payload (the #3779 fix).
 */
function toMapLocation(lead: any, mode: TourMode): MapLocation | null {
  const pos = lead?.location?.pos;
  const valid =
    Array.isArray(pos) &&
    pos.length === 2 &&
    pos.every((n: unknown) => typeof n === "number");
  if (!valid) return null;

  const loc = lead.location;
  const c = lead.recommended_contact;
  // The contacts API sometimes sends the literal string "null" for an empty
  // name part (the same coercion bug pull-leads guards against). Drop those,
  // plus real nullish/blank values, so notes never read "Reach null null".
  const cleanName = (v: unknown): string =>
    typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null"
      ? v.trim()
      : "";
  const fullName = c ? [cleanName(c.first_name), cleanName(c.last_name)].filter(Boolean).join(" ") : "";
  const role = cleanName(c?.job_title) ? `, ${cleanName(c?.job_title)}` : "";
  const angle =
    lead.split_ai_summary?.next_step ??
    lead.split_ai_summary?.approach_angle ??
    lead.short_description ??
    "Worth a visit";

  let reach: string;
  if (c && fullName && c.phone_number) {
    reach = `Reach ${fullName}${role}: ${c.phone_number}${c.email ? `, ${c.email}` : ""}.`;
  } else if (c && fullName && c.email) {
    reach = `Reach ${fullName}${role}: ${c.email}.`;
  } else if (c && fullName) {
    reach = `Reach ${fullName} (enrich a channel).`;
  } else {
    reach = "Enrich a contact to reach this account.";
  }

  const notes = `${mode} — ${angle}. ${reach}`.slice(0, 280);
  return {
    name: lead.name,
    address:
      loc.full ??
      [loc.city, loc.state, loc.country].filter(Boolean).join(", "),
    latitude: pos[0],
    longitude: pos[1],
    notes,
  };
}

/**
 * Build the union map payload + coverage summary from the two lead buckets.
 * Monitor leads split by `last_monitor_action` (Customer vs Qualified);
 * Discover leads are always New regardless of any stray monitor fields.
 */
function buildMap(monitorLeads: any[], discoverLeads: any[]) {
  const mapLocations = [
    ...monitorLeads.map((l) =>
      toMapLocation(l, l?.last_monitor_action ? "★ Customer" : "★ Qualified"),
    ),
    ...discoverLeads.map((l) => toMapLocation(l, "✦ New")),
  ].filter((m): m is MapLocation => m !== null);

  const totalLeads = monitorLeads.length + discoverLeads.length;
  return {
    map_locations: mapLocations,
    map_summary: {
      total_leads: totalLeads,
      leads_with_coords: mapLocations.length,
      leads_without_coords: totalLeads - mapLocations.length,
    },
  };
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
      map_locations: {
        type: "array",
        description:
          "Pre-shaped entries for `places_map_display_v0` — pass each one verbatim ({name, address, latitude, longitude, notes}); the mode badge (★ Customer / ★ Qualified / ✦ New) is already in `notes`. Do NOT reshape or re-derive from `location.pos`. One entry per lead with valid coordinates; coordinate-less leads are omitted and counted in `map_summary`.",
        items: { type: "object" },
      },
      map_summary: {
        type: "object",
        description:
          "Deterministic coverage counts so the agent can footnote '+ N leads without coordinates' without re-counting.",
        properties: {
          total_leads: { type: "number" },
          leads_with_coords: { type: "number" },
          leads_without_coords: { type: "number" },
        },
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
    required: ["monitor_leads", "discover_leads", "map_locations"],
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
          map_locations: [],
          map_summary: {
            total_leads: 0,
            leads_with_coords: 0,
            leads_without_coords: 0,
          },
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
      ...buildMap(monitorLeads, discoverLeads),
      _meta: {
        region: client.region,
        latency_ms: client.lastMeta?.latency_ms ?? null,
      },
    };
  },
};
