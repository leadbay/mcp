import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext, MonitorFilterItem } from "../types.js";
import { withAgentMemoryMeta } from "../agent-memory/index.js";

import { leadbay_pull_followups as PULL_FOLLOWUPS_DESCRIPTION } from "../tool-descriptions.generated.js";
import { resolveLocations } from "./_geo-helpers.js";

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
              "Array of FilterCriterion objects per the backend FilterCriterion anyOf schema (location_ids, sector_ids, size, keywords, last_action, last_action_date, liked, yc, custom_field, custom_field_comparison).",
            items: { type: "object" },
          },
        },
      },
      city: {
        type: "string",
        description:
          "Free-text city / region (e.g. 'Berlin', 'NYC', 'São Paulo'). The composite resolves it to an admin_area id via GET /geo/search and merges it into the active Monitor filter as a `location_ids` FilterCriterion. Ambiguous matches surface as `status: 'ambiguous_locations'` with `location_ambiguities[]` — the agent picks an id and re-calls via `city_id`.",
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
          "`ambiguous_locations` when a passed `city` matched multiple admin_areas; the agent picks an id from `location_ambiguities` and re-calls with `city_id`. Absent on the happy path.",
      },
      location_ambiguities: {
        type: "array",
        description:
          "Per ambiguous city: {location_text, matches:[{id, name, country, level, score}]}. Only present when `status === 'ambiguous_locations'`.",
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
        return withAgentMemoryMeta(client, {
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
        }, ctx);
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
    const qs = new URLSearchParams({
      personal: String(personal),
      liked: String(liked),
      filtered: String(filtered),
      count: String(count),
      page: String(page),
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

    return withAgentMemoryMeta(client, {
      active_filters: activeFilter,
      leads,
      pagination: monitor.pagination ?? null,
      total_excluded_by_pushback: excluded,
      _meta: {
        region: client.region,
        latency_ms: client.lastMeta?.latency_ms ?? null,
      },
    }, ctx);
  },
};
