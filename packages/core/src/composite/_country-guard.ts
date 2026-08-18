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
  WHOLE_WORKSPACE_KEYS,
  embeddedCountryKey,
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
  kind:
    | "home_country"
    | "foreign_country"
    | "supranational"
    /**
     * A real country, on a backend whose own country we cannot determine
     * (LEADBAY_BASE_URL points at a custom/staging endpoint, so `region` is
     * "custom"). The value is still unusable — the admin-area index holds no
     * country nodes whatever the deployment — but we must NOT claim it is out
     * of universe: a custom FR staging backend really does serve France.
     */
    | "country_indeterminate";
  /** English country name; null for a supra-national scope. */
  country: string | null;
  /**
   * Whether the value was being INCLUDED or EXCLUDED.
   *
   * Load-bearing for the recovery, which reverses with polarity. "Omit the
   * argument and the result covers the whole workspace" is right for an include
   * of the home country and exactly backwards for an EXCLUDE of it — the user
   * asked to remove those companies, and omitting the exclusion returns every
   * one of them. And excluding a FOREIGN country is a harmless no-op, not an
   * unsupported request.
   */
  axis: "include" | "exclude";
  /**
   * The OTHER values on the same argument that are perfectly usable.
   *
   * `locations: ["Paris", "France"]` on the FR backend flags only "France", and
   * the tool returns before resolving anything — so an agent told to "omit
   * locations" drops Paris along with the country and re-runs unfiltered,
   * silently widening the very request it was fixing. The rule's own tiebreak
   * is "keep the city, drop the country", so the recovery has to know what
   * would survive. Empty for a scalar argument, which has no siblings to lose.
   */
  kept: readonly string[];
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

  // A NAMED country decides the verdict, even wrapped in a scope phrase. This
  // must run BEFORE the generic whole-workspace labels: "partout en France" and
  // "all of France" name France, so on a US workspace they are FOREIGN asks, and
  // treating them as "everything here" would answer them with US leads. It also
  // catches the canonical phrasings a bare exact match missed entirely — "whole
  // US", "the whole US", "across the United States" — which previously sailed
  // through to /geo/search and the same-named-town fence.
  const namedKey = embeddedCountryKey(key);

  // Generic "the whole of here" with NO country named ("nationwide", "partout",
  // "everywhere") means this workspace, so the recovery is the home-country one
  // (omit and answer) rather than the supra-national one (report the scope).
  if (namedKey === undefined && WHOLE_WORKSPACE_KEYS.has(key)) {
    const homeIso2 = homeCountryIso2(region);
    // No home country (custom backend) → we cannot claim it means "everything
    // here", so fall back to the conservative report-the-scope treatment.
    if (homeIso2 === undefined) return { kind: "supranational" };
    const homeEntry = COUNTRY_BY_KEY.get(countryKey(homeIso2));
    return { kind: "home_country", entry: homeEntry };
  }

  const entry = COUNTRY_BY_KEY.get(namedKey ?? key);
  if (!entry) return null;

  // Exemptions and the alpha-2 kill switch are keyed on the BARE label, so they
  // only apply when the value was already just a country name. "all of Georgia"
  // is still a scope phrase about the state and must not be rejected, but the
  // exemption lookup below needs the bare key to see it.
  const bareKey = namedKey ?? key;

  // (1) This bare label is a legitimate in-universe admin area (Georgia the
  //     US state, colloquial Jersey) — never warn about it.
  if (exemptKeysFor(region).has(bareKey)) return null;

  const home = homeCountryIso2(region);

  // (2) A dependent territory of the backend's own country IS in the universe:
  //     Guadeloupe/Martinique/Réunion on FR, Puerto Rico/Guam on US.
  //
  //     On a CUSTOM endpoint `home` is undefined, so a strict equality test
  //     exempted nothing and rejected Martinique on an FR staging backend and
  //     Puerto Rico on a US one — blocking real prospecting on the documented
  //     LEADBAY_BASE_URL path. With no known home country we cannot tell which
  //     territories are in the universe, so we take the permissive branch, the
  //     same choice exemptKeysFor() already makes for custom: a dependent
  //     territory is far more likely a local admin area than a user asking for
  //     a foreign island.
  if (entry.sovereign !== undefined && (home === undefined || entry.sovereign === home)) {
    return null;
  }

  // (3) The universe's own country — the "all of France" case.
  if (home !== undefined && entry.iso2 === home) {
    return { kind: "home_country", entry };
  }

  // (4) A 2-letter token that is also a local admin-area code is a state, not
  //     a country ("CA" = California, "IN" = Indiana, "LA" = Los Angeles).
  //     Checked AFTER (3) so the home country's own code still rejects.
  if (bareKey.length <= 2 && alpha2LooksLocal(region) && US_STATE_POSTAL_CODES.has(bareKey)) {
    return null;
  }

  // (5) With no known home country we cannot say whether this is the
  //     workspace's own country or a different one. The value is still refused
  //     (the trigram fall-through is a property of the admin-area index, not of
  //     the region), but the guidance must stop short of claiming there are no
  //     such leads here — on a custom FR backend that claim is simply false.
  if (home === undefined) return { kind: "country_indeterminate", entry };

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
  region: GuardRegion,
  axis: "include" | "exclude" = "include"
): CountryHit[] {
  if (input === undefined || input === null) return [];
  const list = Array.isArray(input) ? input : [input];
  const flagged: Array<{ value: string; verdict: NonNullable<ReturnType<typeof classify>> }> = [];
  // Everything on this argument that is NOT country-level. Collected in the
  // same pass so the recovery can say "drop the country, keep these" instead of
  // "omit the argument" — see CountryHit.kept.
  const kept: string[] = [];
  for (const value of list) {
    if (typeof value !== "string") {
      // A resolved numeric id is not classifiable here, but it IS a value the
      // caller asked for and must survive the recovery.
      if (value !== undefined && value !== null) kept.push(String(value));
      continue;
    }
    const verdict = classify(value, region);
    if (!verdict) {
      kept.push(value);
      continue;
    }
    flagged.push({ value, verdict });
  }
  return flagged.map(({ value, verdict }) => ({
    value,
    param,
    kind: verdict.kind,
    country: verdict.entry?.name ?? null,
    axis,
    kept,
  }));
}

/** Detect across several arguments in one pass, preserving order. */
export function detectCountryLocationsIn(
  params: ReadonlyArray<{
    input: unknown;
    param: string;
    /** Defaults to "include"; pass "exclude" for exclude_locations and friends. */
    axis?: "include" | "exclude";
  }>,
  region: GuardRegion
): CountryHit[] {
  const hits: CountryHit[] = [];
  for (const { input, param, axis } of params) {
    hits.push(...detectCountryLocations(input, param, region, axis ?? "include"));
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
    // "Filtering by it removes nothing" is true of an INCLUDE and false of an
    // exclusion, which would remove everything. Message and hint are surfaced
    // together, so leaving this un-branched contradicted the hint outright.
    const effect =
      hit.axis === "exclude"
        ? `so excluding it would remove every company in the workspace`
        : `so filtering by it removes nothing`;
    return `${hit.param} value "${hit.value}" names this whole workspace, not a place inside it — this backend serves ${hit.country} and nothing else, ${effect}. Country names are absent from the admin-area index (product#3885), so the value silently trigram-matches a same-named town instead ("France" → the commune of Francs, "United States" → Statesboro) and fences the search to one village.`;
  }
  if (hit.kind === "country_indeterminate") {
    return `${hit.param} value "${hit.value}" is a country name, which is never a usable location filter: country names are absent from the admin-area index (product#3885), so the value silently trigram-matches a same-named town and fences the search to one village. This backend is custom-configured, so which country it serves is unknown — ${hit.country} may or may not be it.`;
  }
  const foreignEffect =
    hit.axis === "exclude"
      ? `so excluding it removes nothing — there is nothing here to exclude`
      : `so it holds no ${hit.country} companies`;
  return `${hit.param} value "${hit.value}" is a country outside this workspace — this backend serves ${home} only, ${foreignEffect}. A country name is also absent from the admin-area index (product#3885), so it silently trigram-matches a same-named town and fences the search to one village.`;
}

/**
 * The recovery differs by KIND, and conflating them is its own accuracy bug.
 *
 * Only the HOME country is equivalent to "no filter": on a US workspace, "all of
 * the US" really does mean every lead. A FOREIGN country is UNSUPPORTED — "leads
 * in France" on a US workspace has no answer here, and re-running unfiltered
 * would hand back US leads as though they answered it, which is the same
 * confidently-wrong-result failure this guard exists to prevent. So the foreign
 * and supra-national hints must NOT tell the agent to drop the argument and
 * retry; they tell it to report the workspace's scope instead.
 */
function hintFor(hit: CountryHit, region: GuardRegion): string {
  const narrow = NARROW_EXAMPLES[region];
  const home = homeCountryName(region);
  const holds = home ? `holds ${home} companies only` : "covers a single country";

  // MIXED ARRAY — the argument also carries values that are fine. Answered
  // before anything else, because every hint below ends in some form of "drop
  // the argument" and here that is destructive: the tool returned before
  // resolving them, so "omit `locations`" on ["Paris", "France"] loses Paris
  // and re-runs unfiltered — widening the request instead of correcting it.
  // The rule's own tiebreak is "keep the city, drop the country". The kind
  // still decides what to TELL the user, so each one keeps its own sentence.
  if (hit.kept.length > 0) {
    const rest = hit.kept.map((v) => `"${v}"`).join(", ");
    const plural = hit.kept.length > 1 ? "are" : "is";
    const surgical = `Do NOT omit ${hit.param} — ${rest} ${plural} valid and would be lost with it. Remove ONLY "${hit.value}" and re-call with the rest.`;
    if (hit.kind === "home_country") {
      return hit.axis === "exclude"
        ? `${surgical} Excluding ${hit.country} would empty the entire workspace, so that part cannot be honoured at all; the other exclusions still apply.`
        : `${surgical} The result then covers ${rest} — describe it as those places, NOT as the whole workspace.`;
    }
    if (hit.kind === "foreign_country") {
      return `${surgical} And say this workspace ${holds}: there are no ${hit.country} leads in it either way, so the result speaks only for ${rest}.`;
    }
    if (hit.kind === "country_indeterminate") {
      return `${surgical} This backend is custom-configured, so claim nothing about whether ${hit.country} is inside it — report the result as covering ${rest}.`;
    }
    return `${surgical} And say what the workspace actually covers rather than presenting the result as "${hit.value}" — it speaks only for ${rest}.`;
  }

  // EXCLUDING a country inverts every recovery, so it is answered first. The
  // generic advice ("omit it and the result covers the whole workspace") is the
  // precise opposite of what an exclusion asked for.
  if (hit.axis === "exclude") {
    if (hit.kind === "home_country") {
      return `Excluding ${hit.country} excludes this ENTIRE workspace, so the result would be empty — and dropping ${hit.param} does the reverse of what was asked, returning every company instead. Neither is what the user wants: ask what they actually meant to carve out, then exclude ${narrow} instead.`;
    }
    if (hit.kind === "foreign_country") {
      return `Nothing in this workspace is in ${hit.country}, so this exclusion changes nothing — it is a no-op, not an unsupported request. Drop ${hit.param} and say the result is unaffected. To carve something out for real, exclude ${narrow}.`;
    }
    if (hit.kind === "country_indeterminate") {
      return `This backend is custom-configured, so whether ${hit.country} is inside this workspace is unknown — the exclusion may remove everything or nothing. Do not guess: ask what should be carved out, then exclude ${narrow}.`;
    }
    return `A supra-national scope cannot be excluded as an admin area, and dropping ${hit.param} would instead include everything. Say what the workspace covers and ask what should be carved out, then exclude ${narrow}.`;
  }

  if (hit.kind === "home_country") {
    return `Whole-workspace intent = OMIT ${hit.param} entirely, then say the result covers everything. To narrow, pass ${narrow}. Do NOT retry with another spelling or a nearby city.`;
  }

  if (hit.kind === "country_indeterminate") {
    // Deliberately claims nothing about what this workspace holds. Omitting is
    // only correct if the user meant the whole workspace, so it is offered as a
    // condition rather than an instruction.
    return `If you meant this entire workspace, OMIT ${hit.param} and say the result covers all of it. If you meant a place inside it, pass ${narrow}. Do NOT re-run unfiltered while presenting the result as an answer about ${hit.country} specifically, and do NOT retry another spelling.`;
  }

  if (hit.kind === "foreign_country") {
    // `home` is always defined here: an unknown home country routes to
    // country_indeterminate above rather than asserting "foreign".
    return `Do NOT simply drop ${hit.param} and re-run — an unfiltered result is ${home} data, which does NOT answer a question about ${hit.country}. Tell the user this workspace ${holds}, so there are no ${hit.country} leads to return. If they actually meant a same-named town inside it, qualify the value ("Germany, OH") — a qualified place name is accepted.`;
  }

  return `Do NOT drop ${hit.param} and re-run as though the result answered this — a supra-national ask is not the same as the whole workspace. Say the workspace ${holds}, then offer the whole-workspace view as an explicit choice. To narrow instead, pass ${narrow}.`;
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
    // The criterion carries its own polarity, and the recovery reverses with it.
    const axis = record.is_excluded === true ? "exclude" : "include";
    hits.push(...detectCountryLocations(record.locations, param, region, axis));
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
  // id -> polarity, harvested from the criteria so an echoed row can inherit the
  // polarity of the criterion that actually references it. Without this an
  // EXCLUDED country carried as a numeric id and revealed only by its echoed
  // name defaulted to "include", and the recovery then told the caller to omit
  // the location — returning the whole workspace instead of explaining that the
  // exclusion would empty it.
  const polarityById = new Map<string, "include" | "exclude">();
  if (Array.isArray(items)) {
    for (const item of items) {
      const criteria = (item as Record<string, unknown> | null)?.criteria;
      hits.push(
        ...criteriaHits(
          criteria,
          "filter.lens_filter.items[].criteria[].locations",
          region
        )
      );
      if (!Array.isArray(criteria)) continue;
      for (const criterion of criteria) {
        const record = criterion as Record<string, unknown> | null;
        if (!record || record.type !== "location_ids") continue;
        const axis = record.is_excluded === true ? "exclude" : "include";
        const ids = Array.isArray(record.locations) ? record.locations : [];
        for (const id of ids) {
          if (typeof id === "string" || typeof id === "number") {
            const key = String(id);
            // An id named by BOTH axes is contradictory input; the exclusion is
            // the destructive reading, so it wins.
            if (axis === "exclude" || !polarityById.has(key)) {
              polarityById.set(key, axis);
            }
          }
        }
      }
    }
  }

  const locations = asRecord.locations as Record<string, unknown> | undefined;
  for (const block of ["results", "parents"] as const) {
    const rows = locations?.[block];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const record = row as Record<string, unknown> | null;
      const name = record?.name;
      if (typeof name !== "string") continue;
      const id = record?.id;
      const axis =
        (typeof id === "string" || typeof id === "number"
          ? polarityById.get(String(id))
          : undefined) ?? "include";
      hits.push(
        ...detectCountryLocations(
          name,
          `filter.locations.${block}[].name`,
          region,
          axis
        )
      );
    }
  }

  return hits;
}
