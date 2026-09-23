import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext, MonitorFilterItem, NotePayload } from "../types.js";
import { resolveLeadOrder } from "../lead-order.js";

import { leadbay_pull_followups as PULL_FOLLOWUPS_DESCRIPTION } from "../tool-descriptions.generated.js";
import { resolveLocations } from "./_geo-helpers.js";
import {
  countryLocationStatus,
  setFilterCarriesOtherScope,
  detectCountryLocationsIn,
  detectCountryLocationsInSetFilter,
} from "./_country-guard.js";
import type { NextStepOption, NextSteps } from "./pull-leads.js";

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

// leadbay_report_outreach ends every note it writes with this line. For an
// email it holds the Gmail message id, the only link Leadbay keeps between a
// lead and the user's mailbox. The MCP cannot open a mailbox; the agent can.
// So the follow-up read hands the id back per lead and `reply_check` tells the
// agent to look for a reply in that thread (product#4172).
const LOGGED_GMAIL_ID =
  /— logged by AI agent \(verification: gmail_message_id=([^\s)]+)\)\s*$/;

const REPLY_CHECK =
  "`last_logged_email` on a lead is the Gmail message id logged when that email was sent. " +
  "Before rendering, open each message by that id with your mail tool, then read the thread it belongs to: an email sent " +
  "inside an earlier thread has a message id that is not a thread id. A message from the contact dated after " +
  "`logged_at` is a reply Leadbay has not seen: log it with leadbay_report_outreach({lead_id, " +
  "note: 'Replied: <one line of what they said>', verification: {source: 'gmail_message_id', ref: <the reply's message id>}}) " +
  "without epilogue_status, and show that row as replied. The outcome is the user's to state: ask them, as after any " +
  "outreach, and set it only from their answer. Once logged, the reply is older than the next " +
  "`logged_at`, so it is never reported twice. A message your mail tool cannot find was sent from another mailbox: skip it. " +
  "With no mail tool, tell the user replies were not checked.";

async function lastLoggedEmail(
  client: LeadbayClient,
  leadId: string
): Promise<{ gmail_message_id: string; logged_at: string } | null> {
  const notes = await client
    .request<NotePayload[]>("GET", `/leads/${leadId}/notes`)
    .catch(() => null);
  let last: { gmail_message_id: string; logged_at: string } | null = null;
  for (const n of Array.isArray(notes) ? notes : []) {
    const m = typeof n?.note === "string" ? LOGGED_GMAIL_ID.exec(n.note) : null;
    if (m && (!last || Date.parse(n.created_at) > Date.parse(last.logged_at))) {
      last = { gmail_message_id: m[1], logged_at: n.created_at };
    }
  }
  return last;
}

// "Who was contacted, when, who went quiet" is answered from
// last_prospecting_action_at, which only moves when someone logs outreach. On
// the FR test org 283 of 284 Monitor leads had none (product#4174). When most
// of the page is in that state, the result carries the offer of the daily
// mailbox sync; its steps live in leadbay_report_outreach's description,
// because the agent cannot open the leadbay_sync_outreach prompt itself.
function outreachSyncOffer(leads: any[]): string | null {
  const unlogged = leads.filter((l) => !l?.last_prospecting_action_at).length;
  if (leads.length === 0 || unlogged * 2 <= leads.length) return null;
  return (
    `Leadbay has no outreach logged for ${unlogged} of the ${leads.length} leads on this page, ` +
    "so it cannot tell who was contacted, when, or who went quiet. After answering, offer once " +
    "to set up a daily task that reads the user's mailbox and calendar and logs each email and " +
    "meeting on the person in Leadbay. If they accept, take the instruction under \"Logging outreach " +
    "from the user's mailbox and calendar\" in the leadbay_report_outreach description: run it now " +
    "over the last 14 days, then schedule it as a daily task with that instruction word for word. " +
    "Without a mail or calendar tool, tell them to connect Gmail or Google Calendar first."
  );
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

/**
 * Deterministic NEXT STEPS for a Monitor page.
 *
 * Built in code, not left to the description's snippet table, for the reason
 * `pull_leads` already documents: a table row is a suggestion the model may or
 * may not pick from a dozen, whereas `next_steps` is mapped into the host
 * widget verbatim and in order, so the offer fires every time. The artifact
 * option sits at position 0 for the same reason it does there — a multi-item
 * batch is the canonical "scan / sort / return-to" result.
 *
 * This is a CALL board, not a triage board: a Monitor lead has already been
 * seen and worked, so the lead action is logging outreach, not deciding taste.
 * `pull_followups` is also the only tool that can filter by sector / location,
 * which is why the segment offer lives here rather than on `pull_leads`.
 */
export function buildFollowupNextSteps(
  leadCount: number,
  hasMore: boolean,
  nextPage: number | null,
  hasActiveFilter: boolean,
): NextSteps | null {
  if (leadCount === 0) return null; // nothing to work — an offer would be noise

  const options: NextStepOption[] = [];

  // Names the tool for the same reason pull-leads.ts does: an agent told only
  // to "build an artifact" hand-writes one, and a hand-written board logs no
  // outreach to Leadbay at all.
  //
  // This SUPERSEDES the old "call board" offer rather than sitting beside it.
  // The lead desk does the same job — work these rows, log what happened —
  // with the rest of the per-lead surface in the same row (contacts and the
  // enrich that buys them, CRM status, taste, qualify). Two offers for one
  // job would cost the coverage board its slot in a widget that caps at four,
  // and would leave the agent choosing between a board and a strictly better
  // version of it.
  options.push({
    label: "Contact and outreach",
    description:
      "Build an interactive board to contact these leads: contacts with their " +
      "email and phone, the enrich that buys a missing one, CRM status, " +
      "outreach logging, taste and requalify — one row per lead. " +
      "Call leadbay_get_artifact_runtime and follow its LEAD DESK recipe, building " +
      "from the leads in hand (do NOT re-call pull_followups).",
    kind: "build_artifact",
  });

  options.push({
    label: "Prep outreach",
    description: "Prepare a call opener and email for the top lead.",
    kind: "enrich_top_leads",
  });

  // A SECOND artifact, not a variant of the first: the call board is one card
  // per lead, this one is tiles + bars + a table measuring the whole book. It
  // is `build_artifact` for that reason — `refine_audience` would send the
  // agent to adjust the lens instead of building anything.
  //
  // This was once gated on `!hasActiveFilter`, on the reasoning that measuring
  // "how much sits in sector X" while looking at sector X is circular. That
  // suppressed the offer far more often than intended: the Monitor filter is
  // server-stored and survives sessions, so an account that filtered once never
  // saw the board again. A filter is a reason to FRAME the offer differently,
  // not to withhold it — "this slice against your whole book" is exactly the
  // question a filtered view provokes.
  // Names the tool and the helpers for the same reason the call board does.
  // This one needs it MORE: there is no falling back to a sensible hand-built
  // version. `lb.portfolioSectors` derives the sector list from the leads the
  // user actually holds; a hand-written list gets it wrong in both directions
  // (one real portfolio offered a sector holding 3 leads and omitted the
  // third-largest at 555). `lb.segmentCount` carries the trusted-echo check
  // that catches the stateful Monitor filter returning 200 with the PREVIOUS
  // filter still applied — a plausible number answering a different question.
  const coverageRecipe =
    " Call leadbay_get_artifact_runtime and follow its segment-coverage recipe — " +
    "`lb.portfolioSectors` for the sector list (never hardcode one) and " +
    "`lb.segmentCount` for each figure (it verifies the echoed filter).";
  options.push({
    label: "Coverage board",
    description:
      (hasActiveFilter
        ? "Build a coverage board measuring this filtered slice against the whole book — the filter is server-stored, so measure unfiltered for the denominator."
        : "Build a coverage board measuring how much of the portfolio sits in each sector or city.") +
      coverageRecipe,
    kind: "build_artifact",
  });

  if (hasMore && nextPage != null) {
    options.push({
      label: "Next page",
      description: `Pull page ${nextPage + 1} of the Monitor.`,
      kind: "pull_next_page",
    });
  }

  // The widget caps at 2–4; keep the first four, artifact offer included.
  return { question: "What do you want to do next?", options: options.slice(0, 4) };
}

/**
 * Did the filter we POSTed actually land?
 *
 * `POST /monitor/filter` answers 200 even when it stores nothing — a criterion
 * missing its `type` discriminator (`{sector_ids:[...]}` instead of
 * `{type:"sector_ids",sectors:[...]}`) is dropped silently and the PREVIOUS
 * filter stays in force. The caller then reads counts for a segment it never
 * asked about and has no way to tell. Compare what came back against what we
 * sent and say so.
 *
 * Compares the SET of criterion types, not the full objects: the backend
 * normalises a stored criterion (adding `is_excluded`, reordering keys), so a
 * deep equality check would report a false mismatch on every successful call.
 * A sent type absent from the echo is the signal that matters.
 */
export function filterLanded(
  sent: MonitorFilterItem | undefined,
  echoed: MonitorFilterItem | null,
): boolean | null {
  if (!sent) return null; // nothing was asked for, so nothing can have failed
  const sentCriteria = Array.isArray(sent.criteria) ? sent.criteria : [];
  if (sentCriteria.length === 0) return null;
  const typeOf = (c: unknown): string | null => {
    if (!c || typeof c !== "object") return null;
    const t = (c as { type?: unknown }).type;
    return typeof t === "string" && t ? t : null;
  };
  const echoedCriteria = Array.isArray(echoed?.criteria) ? echoed.criteria : [];
  const got = new Set(echoedCriteria.map(typeOf).filter((t): t is string => t != null));
  for (const c of sentCriteria) {
    if (c == null || typeof c !== "object") continue;
    const t = typeOf(c);
    // A criterion with no `type` CANNOT have been stored — that is precisely
    // the silent-drop shape. Inferring a type from its lone key would make the
    // echo appear to match (`{sector_ids:[…]}` "matching" a stored
    // `type:"sector_ids"`) and report success on the one case this exists to
    // catch.
    if (t == null) return false;
    if (!got.has(t)) return false;
  }
  return true;
}

export const pullFollowups: Tool<PullFollowupsParams> = {
  name: "leadbay_pull_followups",
  annotations: {
    title: "Pull known leads to follow up on (Monitor view)",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
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
      filter_applied: {
        type: ["boolean", "null"],
        description:
          "Whether the `set_filter` just sent actually landed. null when no set_filter was passed. FALSE means the backend answered 200 but stored nothing — every count and row below belongs to the PREVIOUS filter, echoed in `active_filters`, NOT to what was requested. Do not report those figures as the requested segment; re-send with a `type` discriminator on each criterion.",
      },
      leads: {
        type: "array",
        description:
          "The page of monitored leads. Each lead carries the FullLead shape augmented with normalized linkedin_page on contacts and `recommended_contact`. A lead whose latest email was logged with a Gmail message id also carries `last_logged_email: {gmail_message_id, logged_at}`.",
        items: { type: "object" },
      },
      reply_check: {
        type: "string",
        description:
          "Present when at least one lead carries `last_logged_email`: how to look for replies in the user's mailbox and log them before rendering.",
      },
      pagination: {
        type: ["object", "null"],
        description: "page / pages / total — the backend's pagination envelope when present.",
      },
      outreach_sync: {
        type: "string",
        description:
          "Present when more than half the leads on the page have no outreach logged: the offer of the daily mailbox and calendar sync, and how to run it.",
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
      next_steps: {
        type: ["object", "null"],
        description:
          "Deterministic follow-on offers, artifact option FIRST. Map `options[]` into the host's next-step widget VERBATIM and in order — do not reword, reorder or drop them. null when the page is empty. Each option: {label (≤5 words), description (the full sentence), kind}.",
        properties: {
          question: { type: "string" },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                description: { type: "string" },
                kind: { type: "string" },
              },
              required: ["label", "description", "kind"],
            },
          },
        },
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

    // Only a lead with notes can hold a logged email, so the rest cost nothing.
    const emails = await Promise.all(
      leads.map((lead) =>
        lead.notes_count > 0 ? lastLoggedEmail(client, lead.id) : null
      )
    );
    emails.forEach((email, i) => {
      if (email) leads[i].last_logged_email = email;
    });

    const pageInfo = monitor.pagination ?? null;
    const currentPage = typeof pageInfo?.page === "number" ? pageInfo.page : 0;
    const totalPages = typeof pageInfo?.pages === "number" ? pageInfo.pages : 0;
    const moreToCome = totalPages > currentPage + 1;
    const filterCriteria = (activeFilter as MonitorFilterItem | null)?.criteria;

    const landed = filterLanded(effectiveSetFilter, activeFilter);
    const outreachSync = outreachSyncOffer(leads);

    return {
      active_filters: activeFilter,
      filter_applied: landed,
      leads,
      pagination: pageInfo,
      total_excluded_by_pushback: excluded,
      ...(emails.some(Boolean) ? { reply_check: REPLY_CHECK } : {}),
      ...(outreachSync ? { outreach_sync: outreachSync } : {}),
      next_steps: buildFollowupNextSteps(
        leads.length,
        moreToCome,
        moreToCome ? currentPage + 1 : null,
        Array.isArray(filterCriteria) && filterCriteria.length > 0,
      ),
      _meta: {
        region: client.region,
        latency_ms: client.lastMeta?.latency_ms ?? null,
      },
    };
  },
};
