import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext, MonitorFilterItem } from "../types.js";
import { resolveLeadOrder } from "../lead-order.js";

import { leadbay_pull_followups as PULL_FOLLOWUPS_DESCRIPTION } from "../tool-descriptions.generated.js";
import { resolveLocations } from "./_geo-helpers.js";
import {
  countryLocationStatus,
  setFilterCarriesOtherScope,
  detectCountryLocationsIn,
  detectCountryLocationsInSetFilter,
} from "./_country-guard.js";

// B6/B7: coerce the legacy literal `"null"` LinkedIn string back to JSON null
// across every contact-shaped object the response emits.
function normalizeLinkedinPage(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return null;
  return trimmed;
}

function augmentContact(c: any): any {
  if (!c) return null;
  return {
    ...c,
    linkedin_page: normalizeLinkedinPage(c.linkedin_page ?? null),
  };
}

interface PullFollowupsParams {
  filtered?: boolean;
  personal?: boolean;
  liked?: boolean;
  count?: number;
  page?: number;
  // Sort order, `FIELD:ASC|DESC`. Omit to keep the backend's default ranking
  // (the order the Monitor tab shows), which is what a rep working top-down
  // expects — only pass this when the user asks for a different sort.
  order?: string;
  // Modify-filter mode: when set, the composite first POSTs this filter to
  // `/monitor/filter` (server-persisted), then re-pulls `/monitor` with
  // `?filtered=true`. Mirrors the app's store-then-apply mechanism.
  set_filter?: MonitorFilterItem;
  // Geo shortcut: pass a free-text city / region (e.g. "Berlin") to
  // resolve into an admin_area id and merge into set_filter as a
  // `location_ids` FilterCriterion. Ambiguous matches surface as
  // `status: "ambiguous_locations"`; the agent picks an id and re-calls
  // via `city_id`.
  city?: string;
  // Pre-resolved admin_area id (numeric string). Bypasses the resolver
  // — useful when the agent has already disambiguated.
  city_id?: string;
}

function mergeLocationIds(
  filter: MonitorFilterItem | undefined,
  ids: string[]
): MonitorFilterItem {
  // MonitorFilterItem.criteria is the wire shape: Array<Record<string, unknown>>
  // (the backend's anyOf can't be narrowed strictly without a discriminated
  // union it doesn't ship). We narrow per-criterion locally.
  const criteria: Array<Record<string, unknown>> = filter?.criteria
    ? [...filter.criteria]
    : [];
  const idx = criteria.findIndex(
    (c) => c?.type === "location_ids" && c?.is_excluded === false
  );
  if (idx >= 0) {
    const cur = criteria[idx];
    const existing = Array.isArray(cur.locations) ? (cur.locations as string[]) : [];
    const merged = Array.from(new Set([...existing, ...ids]));
    criteria[idx] = { ...cur, locations: merged };
  } else {
    criteria.push({
      type: "location_ids",
      is_excluded: false,
      locations: ids,
    });
  }
  return { criteria };
}

interface MonitorResponse {
  // Backend shape per MonitorRoutes.kt:getMonitor() → Database.monitor.findAll.
  // The wiki captures the URL params (personal, liked, filtered, count, page)
  // but doesn't pin the JSON envelope verbatim. Treating it as `any` here and
  // narrowing at the composite layer keeps the wrapper resilient if the
  // backend adds fields.
  items?: any[];
  leads?: any[];
  pagination?: any;
  [k: string]: unknown;
}

export const pullFollowups: Tool<PullFollowupsParams> = {
  name: "leadbay_pull_followups",
  annotations: {
    title: "Pull known leads to follow up on (Monitor view)",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: PULL_FOLLOWUPS_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      filtered: {
        type: "boolean",
        description:
          "Apply the user's stored Monitor filter (server-persisted via POST /monitor/filter). Default true.",
      },
      personal: {
        type: "boolean",
        description:
          "When true, restrict to leads this user has personally monitored (not org-wide). Default false.",
      },
      liked: {
        type: "boolean",
        description:
          "When true, restrict to leads the user has explicitly liked. Default false.",
      },
      count: {
        type: "number",
        description: "Leads per page, max 200 (default 20).",
      },
      order: {
        type: "string",
        description:
          "Optional sort, FIELD:ASC|DESC (SCORE, NAME, SIZE, SECTOR, STATUS, CONTACT_COUNT, LAST_PROSPECTING_ACTION_AT, LIKED). Omit for the Monitor's own ranking. An unknown value is rejected and the error lists every accepted order.",
      },
      page: {
        type: "number",
        description: "Page number, 0-indexed (default 0).",
      },
      set_filter: {
        type: "object",
        description:
          "Optional FilterItem ({criteria: FilterCriterion[]}). When provided, the composite POSTs it to /monitor/filter (server-persists across sessions) BEFORE fetching the filtered Monitor view. Use to refine 'leads to follow up' by city, sector, recency, action type, etc.",
        properties: {
          criteria: {
            type: "array",
            description:
              "Array of FilterCriterion objects per the backend FilterCriterion anyOf schema (location_ids, sector_ids, size, keywords, last_action, last_action_date, liked, yc, custom_field, custom_field_comparison). A `location_ids` criterion must carry sub-country admin areas only — a country name here is rejected with COUNTRY_LEVEL_LOCATION before anything is persisted.",
            items: { type: "object" },
          },
        },
      },
      city: {
        type: "string",
        description:
          "Free-text city / region (e.g. 'Berlin', 'NYC', 'São Paulo'). The composite resolves it to an admin_area id via GET /geo/search and merges it into the active Monitor filter as a `location_ids` FilterCriterion. Ambiguous matches surface as `status: 'ambiguous_locations'` with `location_ambiguities[]` — the agent picks an id and re-calls via `city_id`. NEVER a country name: this workspace serves exactly ONE country, so a whole-country ask means omitting `city` entirely.",
      },
      city_id: {
        type: "string",
        description:
          "Pre-resolved admin_area id (numeric string). Use when the user / agent has already picked one of the ambiguity candidates. Bypasses the resolver.",
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      active_filters: {
        type: ["object", "null"],
        description:
          "The FilterItem currently stored server-side for this user (via GET /monitor/filter). null when no filter is set or when filtered:false was passed.",
      },
      leads: {
        type: "array",
        description:
          "The page of monitored leads. Each lead carries the FullLead shape augmented with normalized linkedin_page on contacts and `recommended_contact`.",
        items: { type: "object" },
      },
      pagination: {
        type: ["object", "null"],
        description: "page / pages / total — the backend's pagination envelope when present.",
      },
      total_excluded_by_pushback: {
        type: "number",
        description:
          "Composite-derived count of leads in the page that were excluded because their `pushback_status` is active. The backend may or may not pre-filter; this exposes the count when the composite has to drop them itself.",
      },
      status: {
        type: "string",
        description:
          "`ambiguous_locations` when a passed `city` matched multiple admin_areas; the agent picks an id from `location_ambiguities` and re-calls with `city_id`. `country_level_location` when `city`, `city_id` or a `set_filter` `location_ids` criterion carried a country-level value — nothing was read and no filter was persisted; read `hint` for the recovery, which differs per case. Absent on the happy path.",
      },
      location_ambiguities: {
        type: "array",
        description:
          "Per ambiguous city: {location_text, matches:[{id, name, country, level, score}]}. Only present when `status === 'ambiguous_locations'`.",
        items: { type: "object" },
      },
      country_locations: {
        type: "array",
        description:
          "Per offending value: {value, param, kind, country, axis, kept}. Only present when `status === 'country_level_location'`. The recovery BRANCHES on `country_locations[].axis` and `[].kind`; `hint` states the one for THIS call — follow it verbatim. Dropping the argument is NOT the general answer: on an `exclude` axis it returns the very companies the user asked to remove, and for a `foreign_country` an unfiltered result is this workspace's own leads, which answer a different question. Never retry with another spelling or a nearby city.",
        items: { type: "object" },
      },
      _meta: {
        type: "object",
        description: "Operator context: region + last-call latency.",
        properties: {
          region: { type: "string" },
          latency_ms: { type: ["number", "null"] },
          agent_memory: { type: "object" },
        },
      },
    },
    required: ["leads"],
  },
  execute: async (
    client: LeadbayClient,
    params: PullFollowupsParams,
    ctx?: ToolContext
  ) => {
    const filtered = params.filtered ?? true;
    const personal = params.personal ?? false;
    const liked = params.liked ?? false;
    const page = params.page ?? 0;
    const count = Math.min(params.count ?? 20, 200);

    // A country name in `city` is refused before any request. It would not
    // fail loudly: the admin-area index has no country nodes, so the resolver
    // trigram-matches a same-named commune ("France" → Francs) and the whole
    // view is silently fenced to one village (product#3951). The envelope is
    // deliberately NOT wrapped in withAgentMemoryMeta — that helper calls
    // resolveMe(), which would make a doomed call cost an HTTP round-trip.
    // `set_filter` is checked alongside the shortcut args, not instead of them:
    // geography can arrive as a raw `location_ids` criterion that never touches
    // `city`/`city_id`. That path is the dangerous one — the criterion would
    // reach POST /monitor/filter, and the failed-POST handler below deliberately
    // falls through to read with the PREVIOUSLY stored filter, so the caller
    // would get a confident cohort from a stale filter instead of a named error.
    const countryHits = [
      ...detectCountryLocationsIn(
        [
          { input: params.city, param: "city" },
          { input: params.city_id, param: "city_id" },
        ],
        client.region
      ),
      ...detectCountryLocationsInSetFilter(
        params.set_filter,
        "set_filter",
        client.region
      ),
    ];
    if (countryHits.length > 0) {
      // What the caller asked for that ISN'T the country. A criterion of any
      // other type survives the recovery, and so does a `location_ids`
      // criterion that still holds a real place once the country comes off.
      const survivingCriteria =
        setFilterCarriesOtherScope(params.set_filter, client.region) ||
        countryHits.some((hit) => hit.kept.length > 0);

      // Two different recoveries, and giving the wrong one destroys data.
      //
      // With NOTHING else requested, omitting the geo argument is only half the
      // fix: `filtered` defaults to true, so the Monitor view is still read
      // through the filter persisted by an earlier call — an old Paris filter
      // comes back looking like the whole workspace.
      //
      // But when the caller DID ask for other criteria, `filtered:false`
      // bypasses them and `set_filter:{criteria:[]}` deletes them, turning a
      // requested date-scoped read into an all-dates org-wide one. There the
      // answer is to re-send the corrected filter, which overwrites the stale
      // one anyway — so the stale-filter problem solves itself and the advice
      // above would be actively destructive.
      const omitCaveat = survivingCriteria
        ? "Do NOT pass `filtered:false`, and do NOT send `set_filter:{criteria:[]}`: either one discards the other criteria in this request, turning a scoped read into an unscoped one. Re-call with `set_filter` carrying the SURVIVING criteria and the country criterion removed — that overwrites the stored filter with the corrected one, so no stale filter can leak in. Then describe the result by the criteria that remain, never as covering everything."
        : "Omitting the geo argument is NOT enough here: `filtered` defaults to true, so the Monitor view is still read through the filter persisted from an earlier call. Nothing else was requested, so pass `filtered:false` as well (or clear the stored filter with `set_filter:{criteria:[]}`) — otherwise a stale cohort comes back looking like the whole workspace. `active_filters` in the response reports what was actually applied; check it before describing the scope.";

      return {
        // `survivingCriteria` is passed, not `false`: it already decided the
        // caveat above, and the hint has to agree with it. Hardcoding false let
        // the hint say "OMIT it, then say the result covers everything" while
        // the caveat it was concatenated with ended "never as covering
        // everything" — one recovery telling the agent both.
        ...countryLocationStatus(
          countryHits,
          client.region,
          "read",
          survivingCriteria,
          omitCaveat
        ),
        leads: [],
        active_filters: null,
        pagination: null,
        total_excluded_by_pushback: 0,
        _meta: { region: client.region, latency_ms: null },
      };
    }

    // Geo-shortcut: resolve city / city_id → location_ids, then merge into
    // the effective set_filter. city_id bypasses the resolver; city goes
    // through /geo/search with the same ambiguity-surfacing pattern that
    // adjust_audience uses for sectors.
    let effectiveSetFilter: MonitorFilterItem | undefined = params.set_filter;
    const geoTexts: string[] = [];
    if (params.city) geoTexts.push(params.city);
    if (params.city_id) geoTexts.push(params.city_id);
    if (geoTexts.length > 0) {
      const { resolved, ambiguities } = await resolveLocations(client, geoTexts);
      if (ambiguities.length > 0) {
        return {
          status: "ambiguous_locations" as const,
          location_ambiguities: ambiguities,
          leads: [],
          active_filters: null,
          pagination: null,
          total_excluded_by_pushback: 0,
          _meta: {
            region: client.region,
            latency_ms: client.lastMeta?.latency_ms ?? null,
          },
        };
      }
      if (resolved.length > 0) {
        effectiveSetFilter = mergeLocationIds(effectiveSetFilter, resolved);
      }
    }

    // Modify-filter mode: store-then-apply (mirrors the Monitor app behavior).
    // The backend's filter is a single FilterItem per user, server-persisted.
    if (effectiveSetFilter) {
      try {
        await client.requestVoid("POST", "/monitor/filter", effectiveSetFilter);
      } catch (err: any) {
        ctx?.logger?.warn?.(
          `pull_followups: POST /monitor/filter failed: ${err?.message ?? err?.code ?? err}`
        );
        // Fall through — still try to read the Monitor view with whatever
        // filter is currently stored; the user sees a partial-success.
      }
    }

    // Fetch the stored filter (so we can surface it as `active_filters`) and
    // the Monitor view in parallel.
    // Canonicalize before validating: the enum is uppercase, but a caller
    // typing "name:asc" means the same thing.
    const resolved = resolveLeadOrder(params.order, "leadbay_pull_followups");
    if (resolved.error) return resolved.error;
    const order = resolved.order;

    const qs = new URLSearchParams({
      personal: String(personal),
      liked: String(liked),
      filtered: String(filtered),
      count: String(count),
      page: String(page),
      ...(order ? { order } : {}),
    }).toString();

    const [filterR, monitorR] = await Promise.allSettled([
      filtered
        ? client.request<MonitorFilterItem>("GET", "/monitor/filter")
        : Promise.resolve(null),
      client.request<MonitorResponse>("GET", `/monitor?${qs}`),
    ]);

    const activeFilter =
      filterR.status === "fulfilled" ? filterR.value ?? null : null;

    if (monitorR.status === "rejected") {
      throw monitorR.reason;
    }

    const monitor = monitorR.value ?? {};
    const rawLeads: any[] = Array.isArray(monitor.items)
      ? monitor.items
      : Array.isArray(monitor.leads)
        ? monitor.leads
        : Array.isArray(monitor)
          ? (monitor as unknown as any[])
          : [];

    // Composite-side pushback exclusion. The backend MAY exclude leads under
    // active pushback already — when it does, this no-ops. When it doesn't,
    // we ensure the agent never proposes following up on a snoozed lead.
    const now = Date.now();
    const isActivePushback = (lead: any): boolean => {
      const status = lead?.pushback_status;
      if (!status) return false;
      const until = lead?.pushback_until ?? lead?.pushback_status_set_at;
      if (!until) return true; // status set, no expiry visible → still active
      const ts = Date.parse(until);
      if (Number.isNaN(ts)) return true;
      return ts > now;
    };

    let excluded = 0;
    const leads = rawLeads
      .filter((lead) => {
        if (isActivePushback(lead)) {
          excluded += 1;
          return false;
        }
        return true;
      })
      .map((lead) => ({
        ...lead,
        recommended_contact: augmentContact(lead.recommended_contact),
        org_contacts: Array.isArray(lead.org_contacts)
          ? lead.org_contacts.map(augmentContact)
          : lead.org_contacts ?? null,
      }));

    return {
      active_filters: activeFilter,
      leads,
      pagination: monitor.pagination ?? null,
      total_excluded_by_pushback: excluded,
      _meta: {
        region: client.region,
        latency_ms: client.lastMeta?.latency_ms ?? null,
      },
    };
  },
};
