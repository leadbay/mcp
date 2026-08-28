/**
 * Why is this lens empty? (product#3995)
 *
 * `GET /lenses/{id}/leads/wishlist` answers "how many leads" and nothing else.
 * On a lens whose criteria intersect to nothing it returns
 * `{items: [], pagination: {total: 0, pages: 0}, computing_wishlist: false,
 * computing_scores: false}` — indistinguishable, to the agent, from a lens
 * that is merely warming up. That silence is what let 3Bricks' agent burn 49
 * `extend_lens` and 333 `set_active_lens` calls over three weeks hunting leads
 * that could not exist, while every refill answered "queued" and consumed no
 * quota (E2E-verified on prod + FR staging 2026-08-28).
 *
 * So when — and ONLY when — a page comes back empty, we spend two reads to
 * turn that silence into a reason the agent can act on. `retryable` is the
 * load-bearing field: it is true exactly once (the lens is still computing),
 * and false everywhere else. An agent that honours it cannot loop.
 *
 * Everything here is derived from what the API actually reports. Nothing is
 * inferred about backend internals — a settled-empty lens whose flags are all
 * false and whose filter is unremarkable reports `unknown`, not a guess.
 */
import type { LeadbayClient } from "../client.js";
import type { FilterPayload, FilterCriterion } from "../types.js";

/** Admin-area depth at or below which an area is city-scale. See GeoMatch. */
const CITY_LEVEL = 7;

export type EmptyReasonCode =
  | "computing"
  | "no_candidates"
  | "no_new_leads"
  | "audience_too_narrow"
  | "unknown";

export interface NarrowLocation {
  id: string;
  name: string;
  /** 5=region, 6=county, 7=township-area, 8=city/town. */
  level: number;
}

export interface EmptyReason {
  code: EmptyReasonCode;
  /** The line to surface to the user. */
  message: string;
  /**
   * Whether pulling again can plausibly return leads. True ONLY while the
   * backend is still computing. On every other code the agent must report to
   * the user and stop — re-pulling or re-extending cannot change the result.
   */
  retryable: boolean;
  /** Present when the lens carries criteria — what to relax, by name. */
  criteria?: {
    sector_ids?: string[];
    excluded_sector_ids?: string[];
    location_ids?: string[];
    excluded_location_ids?: string[];
    sizes?: Array<{ min?: number; max?: number }>;
  };
  /**
   * Include-locations resolved to city-scale areas or smaller. On an empty
   * lens this is the first thing to name: it is the fingerprint of a whole-
   * country location that trigram-fell-through to a same-named village
   * (product#3951 — "France" → the commune of Francs), and of any geo scope
   * too tight to hold an audience.
   */
  narrow_locations?: NarrowLocation[];
}

/** The three diagnostic flags `GET /lenses` carries per row. */
interface LensDiagnosticRow {
  id: number | string;
  not_enough_lead_candidates?: boolean;
  not_enough_new_leads?: boolean;
  less_leads_than_targeted?: boolean;
}

function criteriaOf(filter: FilterPayload | null): FilterCriterion[] {
  return filter?.lens_filter?.items?.flatMap((i) => i.criteria ?? []) ?? [];
}

function summariseCriteria(
  criteria: FilterCriterion[]
): EmptyReason["criteria"] | undefined {
  const out: NonNullable<EmptyReason["criteria"]> = {};
  for (const c of criteria) {
    if (c.type === "sector_ids") {
      const key = c.is_excluded ? "excluded_sector_ids" : "sector_ids";
      out[key] = [...(out[key] ?? []), ...((c as any).sectors ?? [])];
    } else if (c.type === "location_ids") {
      const key = c.is_excluded ? "excluded_location_ids" : "location_ids";
      out[key] = [...(out[key] ?? []), ...((c as any).locations ?? [])];
    } else if (c.type === "size" && !c.is_excluded) {
      out.sizes = [...(out.sizes ?? []), ...((c as any).sizes ?? [])];
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The resolved areas behind the include-side `location_ids`, kept only when
 * city-scale or smaller. `locations.results` is the backend's own resolution
 * of the ids in the filter, so no extra /geo/search round-trip is needed.
 */
function narrowLocationsOf(
  filter: FilterPayload | null,
  criteria: FilterCriterion[]
): NarrowLocation[] {
  const included = new Set(
    criteria
      .filter((c) => c.type === "location_ids" && !c.is_excluded)
      .flatMap((c) => ((c as any).locations ?? []) as string[])
  );
  if (included.size === 0) return [];
  const results = (filter?.locations?.results ?? []) as Array<{
    id?: unknown;
    name?: unknown;
    level?: unknown;
  }>;
  return results
    .filter(
      (r) =>
        typeof r.id === "string" &&
        included.has(r.id) &&
        typeof r.level === "number" &&
        r.level >= CITY_LEVEL
    )
    .map((r) => ({
      id: r.id as string,
      name: typeof r.name === "string" ? r.name : "",
      level: r.level as number,
    }));
}

function narrowGeoSentence(narrow: NarrowLocation[]): string {
  const names = narrow.map((n) => n.name).filter(Boolean);
  if (names.length === 0) return "";
  return ` Its geography is pinned to ${names.join(", ")} — a city-scale area or smaller, which on an empty lens is almost always the criterion to relax first.`;
}

/**
 * Diagnose an empty `pull_leads` page.
 *
 * `computing` short-circuits before any HTTP — a warming lens needs no
 * explanation beyond "wait". Every other path spends two reads (`GET /lenses`,
 * `GET /lenses/{id}/filter`), which is why callers MUST only reach here when
 * the page actually came back empty.
 *
 * Both reads soft-fail: a lens that is empty for an unreadable reason still
 * reports `unknown` with `retryable: false`, because the anti-loop guarantee
 * must not depend on a diagnostic call succeeding.
 */
export async function diagnoseEmptyLens(
  client: LeadbayClient,
  lensId: number,
  computing: { wishlist?: boolean; scores?: boolean }
): Promise<EmptyReason> {
  if (computing.wishlist || computing.scores) {
    return {
      code: "computing",
      retryable: true,
      message:
        "This lens is still computing its leads. Pull again in ~30s — do NOT report it as empty yet.",
    };
  }

  let row: LensDiagnosticRow | undefined;
  try {
    const lenses = await client.request<LensDiagnosticRow[]>("GET", "/lenses");
    row = lenses.find((l) => String(l.id) === String(lensId));
  } catch {
    // Soft-fail — the reason degrades, the anti-loop guarantee does not.
  }

  let filter: FilterPayload | null = null;
  try {
    filter = await client.request<FilterPayload>(
      "GET",
      `/lenses/${lensId}/filter`
    );
  } catch {
    // Same.
  }

  const criteria = criteriaOf(filter);
  const summary = summariseCriteria(criteria);
  const narrow = narrowLocationsOf(filter, criteria);
  const geo = narrowGeoSentence(narrow);
  const extras = {
    ...(summary ? { criteria: summary } : {}),
    ...(narrow.length > 0 ? { narrow_locations: narrow } : {}),
  };

  if (row?.not_enough_lead_candidates) {
    return {
      code: "no_candidates",
      retryable: false,
      message:
        "This lens's criteria match no companies in the database, so it cannot fill." +
        geo +
        " Tell the user and offer to widen the audience (leadbay_adjust_audience) — extending or re-pulling will not help.",
      ...extras,
    };
  }

  if (row?.not_enough_new_leads) {
    return {
      code: "no_new_leads",
      retryable: false,
      message:
        "Every company matching this lens has already been delivered — there are no NEW leads left on these criteria. Tell the user; offer to widen the audience (leadbay_adjust_audience) or work the existing leads via leadbay_pull_followups.",
      ...extras,
    };
  }

  if (summary) {
    return {
      code: "audience_too_narrow",
      retryable: false,
      message:
        "This lens is finished computing and holds zero leads: its criteria intersect to nothing." +
        geo +
        " Tell the user which criteria are in play and offer to widen the audience (leadbay_adjust_audience). Do NOT call leadbay_extend_lens — a refill on a zero-candidate lens reports queued, consumes no quota, and delivers nothing.",
      ...extras,
    };
  }

  return {
    code: "unknown",
    retryable: false,
    message:
      "This lens is finished computing and holds zero leads, and carries no audience criteria that would explain it. Report this to the user rather than retrying; leadbay_report_friction is the way to flag it to the Leadbay team.",
  };
}
