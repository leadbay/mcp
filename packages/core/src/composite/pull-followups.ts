import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext, MonitorFilterItem } from "../types.js";

import { leadbay_pull_followups as PULL_FOLLOWUPS_DESCRIPTION } from "../tool-descriptions.generated.js";

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
      _meta: {
        type: "object",
        description: "Operator context: region + last-call latency.",
        properties: {
          region: { type: "string" },
          latency_ms: { type: ["number", "null"] },
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

    // Modify-filter mode: store-then-apply (mirrors the Monitor app behavior).
    // The backend's filter is a single FilterItem per user, server-persisted.
    if (params.set_filter) {
      try {
        await client.requestVoid("POST", "/monitor/filter", params.set_filter);
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
