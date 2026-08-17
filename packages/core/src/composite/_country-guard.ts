/**
 * The single-country-universe guard (product#3951).
 *
 * Each Leadbay backend serves exactly ONE country, so a country name is never
 * a usable location criterion — whole-country intent means OMITTING the
 * location filter. And because the backend's admin-area search excludes
 * country nodes (product#3885), a country label does not fail loudly: it
 * trigram-falls-through to the nearest same-named town ("France" -> the
 * commune of Francs, "United States" -> Statesboro) and silently fences the
 * whole search to one village. In the 2026-08-02 E2E acceptance eval 3/3
 * independent agent sessions passed a country label anyway — one FR session
 * burned six search variants inside the invisible Francs fence and handed the
 * user a confident wrong diagnosis. Prose alone does not prevent this, so
 * every location-accepting tool pre-flights its geo arguments through here.
 *
 * This module owns the code/message/hint text ONCE. Callers pick the delivery
 * that matches their own idiom:
 *   - `rejectCountryLocations()` THROWS the `{error, code, message, hint}`
 *     business-error envelope, for tools that already throw on bad input.
 *   - `countryLocationStatus()` RETURNS a named status envelope, for the
 *     composites whose input-problem idiom is `status: "ambiguous_…"` plus a
 *     message and no write.
 *
 * Every call site runs this as the FIRST statement of `execute`, before any
 * HTTP — including before /geo/search, /users/me and the sector taxonomy — so
 * a country label costs nothing.
 */
import {
  COUNTRY_BY_KEY,
  HOME_COUNTRY_BY_REGION,
  REGION_EXEMPT_KEYS,
  SUPRANATIONAL_KEYS,
  US_STATE_POSTAL_CODES,
  countryKey,
  type CountryEntry,
} from "./_country-names.js";

/** Mirrors `LeadbayClient.region`. */
export type GuardRegion = "us" | "fr" | "custom";

export const COUNTRY_LEVEL_LOCATION = "COUNTRY_LEVEL_LOCATION" as const;

/** The status a returning tool surfaces. Deliberately NOT
 *  `ambiguous_locations`: that status means "pick an id from the candidates
 *  and re-call", which is the exact wrong instruction here — there is no id
 *  to pick, the value must be dropped. */
export const COUNTRY_LEVEL_STATUS = "country_level_location" as const;

export interface CountryHit {
  /** The offending value, verbatim as the agent sent it. */
  value: string;
  /** The argument it arrived on — "locations", "city", "location_ids", … */
  param: string;
  kind: "home_country" | "foreign_country" | "supranational";
  /** English country name; null for a supra-national scope. */
  country: string | null;
}

export interface CountryLocationEnvelope {
  code: typeof COUNTRY_LEVEL_LOCATION;
  message: string;
  hint: string;
}

function exemptKeysFor(region: GuardRegion): ReadonlySet<string> {
  if (region === "us") return REGION_EXEMPT_KEYS.us;
  if (region === "fr") return REGION_EXEMPT_KEYS.fr;
  // A custom/self-hosted backend has an unknown universe, so be maximally
  // permissive rather than risk blocking a legitimate local admin area.
  return new Set([...REGION_EXEMPT_KEYS.us, ...REGION_EXEMPT_KEYS.fr]);
}

/** Whether a 2-letter token on this backend is more likely a local admin-area
 *  code than a country code. True for US (state postal codes) and for custom
 *  (permissive). French département codes are numeric, so FR has no clash. */
function alpha2LooksLocal(region: GuardRegion): boolean {
  return region !== "fr";
}

function homeCountryIso2(region: GuardRegion): string | undefined {
  return region === "us" || region === "fr"
    ? HOME_COUNTRY_BY_REGION[region]
    : undefined;
}

function homeCountryName(region: GuardRegion): string | undefined {
  const iso2 = homeCountryIso2(region);
  // Every entry indexes its own alpha-2, so the code is itself a lookup key.
  return iso2 ? COUNTRY_BY_KEY.get(countryKey(iso2))?.name : undefined;
}

/** Classify one raw label. Returns null when the value is fine. */
function classify(
  value: string,
  region: GuardRegion
): { kind: CountryHit["kind"]; entry?: CountryEntry } | null {
  const key = countryKey(value);
  if (!key) return null;

  if (SUPRANATIONAL_KEYS.has(key)) return { kind: "supranational" };

  const entry = COUNTRY_BY_KEY.get(key);
  if (!entry) return null;

  // (1) This bare label is a legitimate in-universe admin area (Georgia the
  //     US state, colloquial Jersey) — never warn about it.
  if (exemptKeysFor(region).has(key)) return null;

  const home = homeCountryIso2(region);

  // (2) A dependent territory of the backend's own country IS in the universe:
  //     Guadeloupe/Martinique/Réunion on FR, Puerto Rico/Guam on US.
  if (entry.sovereign !== undefined && entry.sovereign === home) return null;

  // (3) The universe's own country — the "all of France" case.
  if (home !== undefined && entry.iso2 === home) {
    return { kind: "home_country", entry };
  }

  // (4) A 2-letter token that is also a local admin-area code is a state, not
  //     a country ("CA" = California, "IN" = Indiana, "LA" = Los Angeles).
  //     Checked AFTER (3) so the home country's own code still rejects.
  if (key.length <= 2 && alpha2LooksLocal(region) && US_STATE_POSTAL_CODES.has(key)) {
    return null;
  }

  return { kind: "foreign_country", entry };
}

/**
 * Detect country-level values on one argument.
 *
 * Tolerant by design: the MCP server does not validate `inputSchema` before
 * dispatch, so an agent can send a bare string where an array is declared. A
 * scalar `locations: "United States"` sailing past the guard is a real
 * regression that happened once already, so a non-array is normalized to a
 * one-item list rather than treated as "no locations". Non-string members are
 * ignored.
 */
export function detectCountryLocations(
  input: unknown,
  param: string,
  region: GuardRegion
): CountryHit[] {
  if (input === undefined || input === null) return [];
  const list = Array.isArray(input) ? input : [input];
  const hits: CountryHit[] = [];
  for (const value of list) {
    if (typeof value !== "string") continue;
    const verdict = classify(value, region);
    if (!verdict) continue;
    hits.push({
      value,
      param,
      kind: verdict.kind,
      country: verdict.entry?.name ?? null,
    });
  }
  return hits;
}

/** Detect across several arguments in one pass, preserving order. */
export function detectCountryLocationsIn(
  params: ReadonlyArray<{ input: unknown; param: string }>,
  region: GuardRegion
): CountryHit[] {
  const hits: CountryHit[] = [];
  for (const { input, param } of params) {
    hits.push(...detectCountryLocations(input, param, region));
  }
  return hits;
}

const NARROW_EXAMPLES: Readonly<Record<GuardRegion, string>> = {
  us: `a city / county / state name ("Dallas, TX", "Texas", "Bay Area")`,
  fr: `a city / département / région name ("Limoges", "Indre-et-Loire", "Île-de-France")`,
  custom: `a city / county / state / région name`,
};

function messageFor(hit: CountryHit, region: GuardRegion): string {
  const home = homeCountryName(region);
  if (hit.kind === "supranational") {
    return `${hit.param} value "${hit.value}" is a supra-national scope, which is never an admin area — it cannot resolve to anything.`;
  }
  if (hit.kind === "home_country") {
    return `${hit.param} value "${hit.value}" names this whole workspace, not a place inside it — this backend serves ${hit.country} and nothing else, so filtering by it removes nothing. Country names are absent from the admin-area index (product#3885), so the value silently trigram-matches a same-named town instead ("France" → the commune of Francs, "United States" → Statesboro) and fences the search to one village.`;
  }
  const serves = home ? ` — this backend serves ${home} only` : "";
  return `${hit.param} value "${hit.value}" is a country outside this workspace${serves}, so it holds no ${hit.country} companies. A country name is also absent from the admin-area index (product#3885), so it silently trigram-matches a same-named town and fences the search to one village.`;
}

function hintFor(hit: CountryHit, region: GuardRegion): string {
  const narrow = NARROW_EXAMPLES[region];
  if (hit.kind === "foreign_country") {
    return `Drop ${hit.param}, or pass ${narrow} that is inside this workspace. If you truly meant a same-named town, qualify it ("Germany, OH") — a qualified place name is accepted.`;
  }
  return `Whole-workspace intent = OMIT ${hit.param} entirely, then say the result covers everything. To narrow, pass ${narrow}. Do NOT retry with another spelling or a nearby city.`;
}

/**
 * The single source of truth for the code, message and hint. Every hit is
 * reported, not just the first, so an agent fixes one envelope instead of
 * discovering its bad values one turn at a time.
 */
export function countryLocationEnvelope(
  hits: readonly CountryHit[],
  region: GuardRegion
): CountryLocationEnvelope {
  const message = hits.map((hit) => messageFor(hit, region)).join(" ");
  const hints: string[] = [];
  for (const hit of hits) {
    const hint = hintFor(hit, region);
    if (!hints.includes(hint)) hints.push(hint);
  }
  return { code: COUNTRY_LEVEL_LOCATION, message, hint: hints.join(" ") };
}

/**
 * For tools whose input-error idiom is to THROW. Throws the 4-field business
 * envelope `{error, code, message, hint}` that server.ts recognises
 * (`formatErrorForLLM` renders message + hint; `isLeadbayBusinessError`
 * classifies it for Sentry). No `_meta` on purpose: `formatErrorForLLM`
 * appends "(region=…, endpoint=…)" whenever `_meta.region` is present, which
 * reads as a broken diagnostic for a guard that never made a request.
 */
export function rejectCountryLocations(
  params: ReadonlyArray<{ input: unknown; param: string }>,
  region: GuardRegion
): void {
  const hits = detectCountryLocationsIn(params, region);
  if (hits.length === 0) return;
  const envelope = countryLocationEnvelope(hits, region);
  throw {
    error: true,
    code: envelope.code,
    message: envelope.message,
    hint: envelope.hint,
  };
}

/**
 * For tools whose input-error idiom is to RETURN a named status and write
 * nothing.
 *
 * Deliberately carries NO `error: true`: server.ts collapses any result with
 * that flag into a bare `{content, isError}`, dropping structuredContent and
 * every other field, and files a Sentry event — so an agent's ordinary input
 * mistake would both lose the structured detail and page us.
 */
export function countryLocationStatus(
  hits: readonly CountryHit[],
  region: GuardRegion
): {
  status: typeof COUNTRY_LEVEL_STATUS;
  code: typeof COUNTRY_LEVEL_LOCATION;
  message: string;
  hint: string;
  country_locations: CountryHit[];
} {
  const envelope = countryLocationEnvelope(hits, region);
  return {
    status: COUNTRY_LEVEL_STATUS,
    code: envelope.code,
    message: envelope.message,
    hint: envelope.hint,
    country_locations: [...hits],
  };
}

/**
 * Walk one `FilterCriterion[]` array for country-level values.
 *
 * The wire shape is the backend's `anyOf` over 10 typed criteria; only
 * `location_ids` carries geography. Defined once because the same criteria
 * array reaches us through two different envelopes — a lens `FilterPayload`
 * (`lens_filter.items[].criteria[]`) and a Monitor `set_filter`
 * (`criteria[]`) — and a rule enforced on one envelope but not the other is
 * how the `set_filter` bypass happened in the first place.
 */
function criteriaHits(
  criteria: unknown,
  param: string,
  region: GuardRegion
): CountryHit[] {
  if (!Array.isArray(criteria)) return [];
  const hits: CountryHit[] = [];
  for (const criterion of criteria) {
    const record = criterion as Record<string, unknown> | null;
    if (!record || record.type !== "location_ids") continue;
    hits.push(...detectCountryLocations(record.locations, param, region));
  }
  return hits;
}

/**
 * Walk a Monitor `set_filter` (`MonitorFilterItem`) for country-level values.
 *
 * This ingress is documented and load-bearing: `pull_followups` and
 * `scan_portfolio_signals` both accept geography as a raw `location_ids`
 * criterion, which never touches `city` / `city_id` and so never touched the
 * argument-level guard. Leaving it open was worse than the bug it was meant to
 * fix: the criterion reaches `POST /monitor/filter`, and both composites CATCH
 * a failed POST and continue reading the Monitor view with whatever filter was
 * previously persisted (pull-followups.ts, "Fall through — still try to read").
 * So the caller got a confident, plausible cohort drawn from a stale filter
 * instead of a named `country_level_location` — the exact
 * silently-wrong-answer class this guard exists to prevent.
 */
export function detectCountryLocationsInSetFilter(
  setFilter: unknown,
  param: string,
  region: GuardRegion
): CountryHit[] {
  if (!setFilter || typeof setFilter !== "object") return [];
  const criteria = (setFilter as Record<string, unknown>).criteria;
  return criteriaHits(criteria, `${param}.criteria[].locations`, region);
}

/**
 * Walk a raw `FilterPayload` for country-level values.
 *
 * Two ingress paths, both best-effort and both tolerant of junk:
 *  - `lens_filter.items[].criteria[]` entries of type `location_ids`, whose
 *    `locations` array should hold admin-area ids but regularly receives
 *    names from an agent hand-writing the payload.
 *  - `locations.results[]` / `locations.parents[]`, the backend's echoed
 *    resolved-areas block (see mergeFilter in adjust-audience.ts). A filter
 *    round-tripped through get_lens_filter carries area NAMES here, which is
 *    the only way to spot a country that arrived as a numeric id.
 *
 * A hand-written criterion with numeric ids and no echoed block stays
 * invisible — deciding whether id "1234" is a country needs a backend lookup
 * this client does not have. Narrowing the ingress is the most this layer can
 * do; the real fix is server-side (product#3939).
 */
export function detectCountryLocationsInFilter(
  filter: unknown,
  region: GuardRegion
): CountryHit[] {
  if (!filter || typeof filter !== "object") return [];
  const hits: CountryHit[] = [];
  const asRecord = filter as Record<string, unknown>;

  const lensFilter = asRecord.lens_filter as Record<string, unknown> | undefined;
  const items = lensFilter?.items;
  if (Array.isArray(items)) {
    for (const item of items) {
      hits.push(
        ...criteriaHits(
          (item as Record<string, unknown> | null)?.criteria,
          "filter.lens_filter.items[].criteria[].locations",
          region
        )
      );
    }
  }

  const locations = asRecord.locations as Record<string, unknown> | undefined;
  for (const axis of ["results", "parents"] as const) {
    const rows = locations?.[axis];
    if (!Array.isArray(rows)) continue;
    const names = rows
      .map((row) => (row as Record<string, unknown> | null)?.name)
      .filter((name): name is string => typeof name === "string");
    hits.push(
      ...detectCountryLocations(names, `filter.locations.${axis}[].name`, region)
    );
  }

  return hits;
}
