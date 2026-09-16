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
 * client-side on the lead's own city, falling back to its state only
 * when no city matched. `discover_filter_note` reports which field
 * carried the match so the prompt can be honest about coverage.
 */
import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";
import { pullFollowups } from "./pull-followups.js";
import { pullLeads } from "./pull-leads.js";
import { reportLeadInteractions } from "../interactions.js";
import {
  countryLocationStatus,
  detectCountryLocationsIn,
} from "./_country-guard.js";
import { expandAlias } from "./_geo-helpers.js";

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

/**
 * Lowercase, drop accents, and reduce every run of non-alphanumerics to a
 * single space. "Saint-Étienne", "saint etienne" and "SAINT ETIENNE" all
 * become "saint etienne", so a hyphen or an accent in either the hint or the
 * payload no longer decides the match.
 */
function normalizeGeo(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The administrative prefix the US admin-area index puts in front of a town's
 * real name. Live on prod today: "City of New York", "City of Albany", "Town
 * of Islip", "Town of Ramapo", and the index also holds "Village of New York
 * Mills" and "Borough of Woodmont". A user says "New York", so the prefix has
 * to come off before the two names are compared. Only the "<kind> of " form is
 * stripped: "The Village" and "Austin Township" are real names of real places
 * that are not Austin.
 */
const ADMIN_PREFIX = /^(?:city|town|village|borough|township|municipality) of /;

/** The town's own name, prefix removed and ready to compare. */
function townName(value: string): string {
  return normalizeGeo(value).replace(ADMIN_PREFIX, "");
}

/**
 * The place the user named. An agent passes "Austin, TX" or "Paris, France" as
 * often as a bare city name, and the tour is of the first segment; the rest is
 * the state and country that segment already implies. "NYC", "SF" and "LA" go
 * through the same alias table the Monitor half resolves with, because the
 * backend's admin-area index answers nothing for them.
 */
function cityHintCore(cityHint: string): { name: string; isCity: boolean } {
  const head = cityHint.split(",")[0] ?? "";

  // The alias table exists to say "this string names a city". When it fires,
  // the user named a town, so the regional fallback below must not run:
  // "Washington DC" expands to "Washington", and the state of Washington
  // would otherwise put a Redmond lead on a tour of the capital.
  //
  // An address names a place from the most specific part outwards, so the
  // leading segments are tried longest first: "Washington, DC" and
  // "Washington, DC, USA" both reach the key "washington dc", while a bare
  // "Washington" reaches nothing and also names a state (product#4150).
  // Segments are rejoined with spaces rather than having their punctuation
  // stripped, because the table holds "washington d.c." with its dots intact
  // and only a comma stands between it and "washington dc".
  const segments = cityHint.split(",").map((part) => part.trim()).filter(Boolean);
  for (let take = segments.length; take > 0; take -= 1) {
    const candidate = segments.slice(0, take).join(" ");
    const expanded = expandAlias(candidate);
    if (expanded !== candidate) {
      return { name: townName(expanded), isCity: true };
    }
  }

  // An administrative prefix is itself the claim that this is a town. The
  // `ambiguous_locations` recovery asks the agent to send the candidate's
  // `name`, which is spelled "City of New York" or "Town of Islip", so without
  // this a tour of New York City would fall back to the state and return
  // Buffalo.
  const prefixed = ADMIN_PREFIX.test(normalizeGeo(head));
  return { name: townName(head), isCity: prefixed };
}

/**
 * The lead's region. Kept OFF the city pass on purpose: every lead in the
 * state of New York carries `state: "New York"`, so matching it against a
 * city hint puts Buffalo and Albany on a tour of New York City. It is only
 * consulted when no lead's city matched, which is what a regional hint
 * ("Texas", "Île-de-France") looks like.
 */
function stateFieldOf(lead: any): string {
  const state = lead?.location?.state;
  return typeof state === "string" ? normalizeGeo(state) : "";
}

/**
 * Keep the Discover leads that are in the requested place.
 *
 * The comparison is equality, not containment. Containment is what broke:
 * "austin" contains "us", so every American lead matched a tour of Austin
 * (product#4138). Word-boundary containment still matches "york" against
 * "City of New York" and "angeles" against "Los Angeles", so the town names
 * have to be equal once the administrative prefix is off both sides.
 *
 * Two passes. Cities first, because a city hint is what a tour almost always
 * carries. Only when nothing matched by city do we read the hint as a region
 * and try the state field — which is also how the leads that carry a state
 * and no city get picked up.
 */
function filterDiscoverByCity(
  leads: any[],
  cityHint: string | undefined,
): { leads: any[]; matchedOn: "city" | "state" | null } {
  const hint = cityHint ? cityHintCore(cityHint) : { name: "", isCity: false };
  if (!hint.name) return { leads, matchedOn: null };

  const cityOf = (l: any) =>
    typeof l?.location?.city === "string" ? townName(l.location.city) : "";
  const byCity = leads.filter((l) => cityOf(l) === hint.name);
  if (byCity.length > 0) return { leads: byCity, matchedOn: "city" };
  if (hint.isCity) return { leads: [], matchedOn: "city" };

  const byState = leads.filter((l) => stateFieldOf(l) === hint.name);
  return { leads: byState, matchedOn: "state" };
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
 * A monitor (follow-up) lead is a "Customer" when it carries real engagement
 * history, "Qualified" when it's a scored account with no recorded action yet.
 * The fields that actually exist on the pull_followups payload (per the
 * follow-up rendering contract in snippets/rendering/pull-followups-table.md)
 * are `epilogue_status`, `last_prospecting_action_at`, and
 * `last_monitor_action_at` — NOT a bare `last_monitor_action`. Any of those
 * three being present means the account has been worked before.
 */
function hasMonitorHistory(lead: any): boolean {
  return Boolean(
    lead?.epilogue_status ||
      lead?.last_prospecting_action_at ||
      lead?.last_monitor_action_at,
  );
}

/**
 * Build the union map payload + coverage summary from the two lead buckets.
 * Monitor leads split into Customer (has engagement history) vs Qualified
 * (scored, untouched); Discover leads are always New.
 */
function buildMap(monitorLeads: any[], discoverLeads: any[]) {
  const mapLocations = [
    ...monitorLeads.map((l) =>
      toMapLocation(l, hasMonitorHistory(l) ? "★ Customer" : "★ Qualified"),
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
          "Free-text city or region (e.g. 'Limoges', 'Bay Area'). Resolved via the same /geo/search the followups_map uses. Ambiguous matches surface as `status: ambiguous_locations` with location_ambiguities[]; pick a location id and re-call with city_id. NEVER a country name — and unlike the Monitor tools the fix is NOT to omit this argument: a tour with no city returns arbitrary leads from the whole workspace, which is not an itinerary. Ask which city or region the user is visiting and pass that.",
      },
      city_id: {
        type: "string",
        description:
          "Pre-resolved admin_area id (numeric string). Bypasses the resolver. Pass `city` alongside it with the NAME of the area you picked: the id scopes the Monitor half, and the name is the only thing that can scope the Discover half, which has no server-side geo filter. With `city_id` alone, `discover_leads` comes back empty.",
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
          "'ambiguous_locations' when the passed `city` matched multiple admin areas — pick an id from location_ambiguities and re-call with city_id. 'country_level_location' when `city` was a country name — do NOT drop the argument (a city-less tour is arbitrary nationwide leads); ask which city or region to use. The itinerary arrays are empty and nothing was fetched.",
      },
      location_ambiguities: {
        type: "array",
        items: { type: "object" },
      },
      country_locations: {
        type: "array",
        description:
          "Per offending value: {value, param, kind, country}. Only present when `status === 'country_level_location'`. Unlike the Monitor tools, the recovery here is NOT to drop `city`: a tour with no city returns arbitrary leads from the whole workspace, which is not an itinerary. Ask which city or region the user is visiting and re-call with that — see `hint`.",
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
    // Guard here rather than relying on the delegated pullFollowups call:
    // the two pulls run in parallel, so leaving it to the delegate would
    // still spend the pullLeads request on a doomed tour. A country in `city`
    // would silently fence the itinerary to a same-named commune
    // (product#3951).
    const countryHits = detectCountryLocationsIn(
      [
        { input: params.city, param: "city" },
        { input: params.city_id, param: "city_id" },
      ],
      client.region
    );
    if (countryHits.length > 0) {
      const envelope = countryLocationStatus(countryHits, client.region);
      return {
        ...envelope,
        // The shared hint says "omit the geo argument and the result covers the
        // whole workspace" — right for a Monitor pull, WRONG here. tour_plan
        // accepts no city and then returns arbitrary nationwide leads, which is
        // not an itinerary; the prompt contract requires asking which city or
        // region the user is visiting (prompts/leadbay_plan_tour_in_city.md.tmpl).
        // So this tool overrides the recovery rather than forwarding advice that
        // would produce a confident, useless tour.
        hint:
          "A tour needs a place to walk around in, so there is nothing to omit here: do NOT re-call without `city`, which would return arbitrary leads from across the whole workspace as an itinerary. Ask which city or region the user is actually visiting, then re-call with that. Do NOT retry another spelling of the country.",
        monitor_leads: [],
        discover_leads: [],
        // A STRING, not null: the declared schema allows only a string, and a
        // client that validates structuredContent would reject the whole
        // rejection payload — hiding the very recovery hint it carries.
        discover_filter_note:
          "No Discover leads were fetched: the request named a country, which cannot scope an itinerary.",
        map_locations: [],
        map_summary: {
          total_leads: 0,
          leads_with_coords: 0,
          leads_without_coords: 0,
        },
        city: params.city ?? null,
        city_id: params.city_id ?? null,
        _meta: { region: client.region },
      };
    }

    const followupsCount = params.followups_count ?? DEFAULT_FOLLOWUPS_COUNT;
    const discoverCount = params.discover_count ?? DEFAULT_DISCOVER_COUNT;

    // Run both pulls in parallel — they hit independent backends (Monitor
    // vs Wishlist), so there's no dependency.
    const [followupsResult, leadsResult] = await Promise.allSettled([
      pullFollowups.execute(
        client,
        {
          // A pre-resolved id bypasses the resolver, which is what its own
          // schema promises. Forwarding the free text alongside it sends the
          // name back through /geo/search, and the name is the thing that was
          // ambiguous — so an agent recovering from `ambiguous_locations` by
          // picking an id would be handed the same ambiguity again. Here the
          // free text stays behind and scopes the Discover half instead.
          city: params.city_id ? undefined : params.city,
          city_id: params.city_id,
          count: followupsCount,
        },
        ctx,
      ),
      pullLeads.execute(
        client,
        { count: DISCOVER_OVER_PULL, _reportSeen: false },
        ctx,
      ),
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
            "City was ambiguous; re-call with `city_id` set to the id you pick AND `city` set to that candidate's `name`. The id scopes the follow-ups; the name is what scopes the Discover leads.",
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
    //
    // An id carries no name, and the backend has no id-to-name lookup, so
    // there is nothing to compare a lead's city against. `city` is an id too
    // when it is all digits — the geo resolver reads it that way, and a real
    // user sent `38112` on prod. The Monitor half is still correctly scoped
    // server-side; the Discover half returns empty rather than handing over
    // the whole lens as if it were the itinerary (product#4138).
    const cityName =
      params.city && !/^\d+$/.test(params.city.trim()) ? params.city : undefined;
    const knownId = params.city_id ?? (cityName ? undefined : params.city);
    const idOnly = Boolean(knownId) && !cityName;
    const { leads: filtered, matchedOn } = idOnly
      ? { leads: [] as any[], matchedOn: null as "city" | "state" | null }
      : filterDiscoverByCity(rawDiscover, cityName);
    const discoverLeads = filtered.slice(0, discoverCount);

    // Report only the leads this itinerary actually shows. pull_leads
    // over-pulls 30 and we keep the city matches, so letting it report all 30
    // would age out leads the user never read.
    const pulledLensId =
      leadsResult.status === "fulfilled"
        ? (leadsResult.value as any)?.lens?.id
        : null;
    if (pulledLensId != null) {
      reportLeadInteractions(
        client,
        pulledLensId,
        discoverLeads.map((l: any) => l.id),
        ["LEAD_SEEN"],
        ctx?.logger,
      );
    }

    // Say which field carried the match, and say plainly when nothing did.
    // The filter used to accept every lead in the country, so a zero here is
    // the honest answer the agent never used to get: the lens holds no
    // prospect in this city, and nearby ones must not be presented as if it
    // did.
    let filterNote: string;
    if (idOnly) {
      filterNote = `Discover leads need the NAME of the place, and this call passed an area id (${knownId}) and no name. Re-call with \`city\` set to the name of that area, keeping \`city_id\` so the Monitor half stays on the area you picked. The follow-ups below are already scoped to it.`;
    } else if (!cityName) {
      filterNote = `No city filter applied; returning top ${discoverLeads.length} Discover leads.`;
    } else if (matchedOn === null) {
      filterNote = `No usable city filter in '${params.city}'; returning top ${discoverLeads.length} Discover leads.`;
    } else if (filtered.length === 0) {
      filterNote = `No Discover lead in the active lens is in '${params.city}' (checked ${rawDiscover.length} candidates by city, then by state/region). Say so; do NOT present leads from elsewhere as if they were in '${params.city}'.`;
    } else {
      filterNote = `Matched ${filtered.length}/${rawDiscover.length} Discover leads to '${params.city}' by ${matchedOn === "city" ? "city" : "state/region"}; returning top ${discoverLeads.length}.`;
    }

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
