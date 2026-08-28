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
  embeddedWholeWorkspaceKey,
  embeddedCountryKey,
  embeddedSupranationalKey,
  countryKey,
  type CountryEntry,
} from "./_country-names.js";

/** Mirrors `LeadbayClient.region`. */
export type GuardRegion = "us" | "fr" | "custom";

/**
 * Whether the guarded tool WRITES.
 *
 * The recovery diverges here, and only here. On a read tool "drop the country
 * and re-call" is exactly right — `pull_followups` with no `city` is every
 * follow-up, which is what a whole-country ask meant. On a WRITE tool with
 * nothing else in the argument it is the forbidden move: re-calling `new_lens`
 * / `adjust_audience` / `update_lens_filter` without the country persists a
 * lens or filter change that expresses no scope at all, to say something the
 * workspace already is. WORKFLOWS.md's "Country-wide scope" row forbids exactly
 * those three tools for exactly this ask, and requires that NOTHING be written.
 *
 * The stop is narrow on purpose. It fires only when the offending value was the
 * request's ONLY scope — see the `otherScope` argument threaded alongside it.
 * `newLens({sectors: ["Healthcare"], locations: ["France"]})` is a Healthcare
 * lens with a redundant country attached, and refusing to write it would
 * discard the criterion the user actually cared about.
 */
export type GuardIntent = "read" | "write";

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
  /**
   * The admin-area ID that actually SELECTS this country, when the value was
   * discovered through an echoed name rather than passed as text.
   *
   * A lens filter carries `location_ids.locations: ["27925"]` and echoes
   * `{id: "27925", name: "France"}` in its denormalized `locations.results`
   * block. The guard can only recognize the country from that echoed NAME — but
   * the name is not what selects it. A recovery that says "remove the name"
   * leaves the id in the criterion, and because a bare numeric id is not
   * classifiable (product#3939), the corrected re-call persists the country
   * filter with the guard none the wiser. So the id travels with the hit and
   * the recovery names it.
   */
  selectedId?: string;
  /**
   * The OTHER criteria in the same filter, by `type`.
   *
   * `kept` only ever held survivors from the offending criterion's own
   * `locations` array, so a `set_filter` of
   * `[{location_ids: ["France"]}, {last_action_date: {last_days: 30}}]`
   * looked, to the recovery, exactly like a country on its own. It then said
   * "omit the criterion and the result covers everything" — but the date
   * criterion survives and the result is still a 30-day window. It also implied
   * deleting the `locations` property alone, which leaves a `location_ids`
   * criterion with nothing in it: invalid, not neutral.
   */
  siblingCriteria?: readonly string[];
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
  if (namedKey === undefined) {
    if (embeddedWholeWorkspaceKey(key) !== undefined) {
      const homeIso2 = homeCountryIso2(region);
      // No home country (custom backend). NOT supra-national: "nationwide"
      // names no country, and every backend covers exactly one, so the request
      // is unambiguous and the unfiltered read answers it exactly. Calling it
      // supra-national produced a hint that FORBADE that read, telling users on
      // the documented LEADBAY_BASE_URL path their nationwide ask could not be
      // answered. It routes to country_indeterminate with no entry: omit and
      // answer, while naming no country we cannot actually identify.
      if (homeIso2 === undefined) return { kind: "country_indeterminate" };
      const homeEntry = COUNTRY_BY_KEY.get(countryKey(homeIso2));
      return { kind: "home_country", entry: homeEntry };
    }
    // A WRAPPED supra-national scope — "EU-wide", "all of Europe", "across
    // EMEA". The exact-key check above catches only the bare label, and the
    // wrapper strip was applied while looking for a country and nowhere else,
    // so these reached /geo/search and got fenced to a same-named town. Last of
    // the three, so a named country ("all of France") and the generic
    // whole-workspace phrasings ("the whole country") keep their own verdicts.
    if (embeddedSupranationalKey(key) !== undefined) return { kind: "supranational" };
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
  axis: "include" | "exclude" = "include",
  selectedId?: string
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
    ...(selectedId === undefined ? {} : { selectedId }),
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

/**
 * Does any geo argument still carry a usable value once the country-level ones
 * are taken out?
 *
 * `CountryHit.kept` only ever sees the argument the offending value arrived on,
 * so `{locations: ["France"], exclude_locations: ["Paris"]}` produced `kept:
 * []` and looked like a country-only request — and the write-stop then threw
 * away a perfectly good Paris exclusion. Scope is a property of the REQUEST,
 * not of one argument, so it is counted across all of them.
 *
 * A non-string member counts: a resolved numeric admin-area id is not
 * classifiable here but is unmistakably a place the caller asked for.
 */
export function geoScopeSurvives(
  params: ReadonlyArray<{ input: unknown; param: string }>,
  region: GuardRegion
): boolean {
  for (const { input } of params) {
    if (input === undefined || input === null) continue;
    for (const value of Array.isArray(input) ? input : [input]) {
      if (typeof value !== "string") return true;
      if (countryKey(value) && classify(value, region) === null) return true;
    }
  }
  return false;
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
  if (hit.kind === "country_indeterminate" && hit.country === null) {
    // A generic "whole of here" phrase on a backend we cannot name. Unlike a
    // named country there is nothing to be uncertain ABOUT: it means this
    // workspace entirely, whichever country that is.
    return `${hit.param} value "${hit.value}" asks for this whole workspace, not a place inside it, so it is not a location filter — and no admin area is named "${hit.value}" either, so it would silently trigram-match a same-named town and fence the search to one village. This backend is custom-configured, so WHICH country the workspace covers is unknown.`;
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
/**
 * An exclusion a write must never be allowed to simply drop.
 *
 * Dropping an INCLUDE of a country widens the result, which is at worst
 * imprecise. Dropping an EXCLUDE inverts it: `exclude_locations: ["France"]` on
 * FR asks for an audience with nothing in it, and re-calling without the
 * exclusion persists an audience containing every company the user wanted gone
 * — the opposite of the request, written to the lens. Only a FOREIGN exclusion
 * is provably a no-op (there is nothing here to remove), so only that one is
 * safe to drop and carry on with. Supra-national and unknown-country
 * exclusions may well cover this workspace, so they stop too.
 */
function excludeBlocksWrite(hit: CountryHit): boolean {
  return hit.axis === "exclude" && hit.kind !== "foreign_country";
}

/**
 * An INCLUDE a write must never be allowed to simply drop either.
 *
 * `new_lens({sectors: ["Healthcare"], locations: ["Canada"]})` on a US
 * workspace asked for CANADIAN healthcare. Dropping the country and writing the
 * rest creates a US-healthcare lens — a real audience, persisted, that the user
 * never asked for and will read as though it were what they requested. The
 * sector is not independently valid scope once the territory it qualifies is
 * unsupported; "healthcare" was an adjective on "Canada", not a second request.
 *
 * Only the HOME country is safely droppable: there the value really is
 * redundant, so the remaining criteria ARE the whole request. A generic
 * "nationwide" on a custom backend is home-equivalent for the same reason — it
 * names no country, and every backend covers exactly one.
 */
function includeBlocksWrite(hit: CountryHit): boolean {
  if (hit.axis !== "include") return false;
  if (hit.kind === "home_country") return false;
  if (hit.kind === "country_indeterminate" && hit.country === null) return false;
  return true;
}

/** Either polarity, whichever way this particular value fails a write. */
function blocksWrite(hit: CountryHit): boolean {
  return excludeBlocksWrite(hit) || includeBlocksWrite(hit);
}

function hintFor(
  hit: CountryHit,
  region: GuardRegion,
  intent: GuardIntent,
  otherScope: boolean
): string {
  const narrow = NARROW_EXAMPLES[region];
  const home = homeCountryName(region);
  const holds = home ? `holds ${home} companies only` : "covers a single country";

  // A GENERIC whole-of-here phrase ("nationwide", "partout") on a backend whose
  // country we cannot name. Semantically this tracks home_country, NOT the
  // named-country indeterminate case: the request is unambiguous and the
  // unfiltered read answers it exactly. The only thing withheld is the name.
  const anonymousWhole = hit.kind === "country_indeterminate" && hit.country === null;
  const unnamed = "This backend is custom-configured, so do NOT name which country that is.";

  // A WRITE tool with nothing left to write. Ordered before everything else
  // because every recovery below ends in "re-call", and here the re-call is the
  // defect: a lens created or rewritten to express a country-wide scope is the
  // forbidden outcome, not the fix for it. Only when the argument is left EMPTY
  // — `kept.length > 0` means a real place survives and writing it is exactly
  // what the user asked for.
  if (intent === "write" && hit.kept.length === 0 && otherScope) {
    // The argument empties, but the REQUEST does not: sectors, sizes or a
    // non-geo criterion carry real scope. Writing that is exactly what the user
    // asked for, so the country comes off and the call goes through once.
    const carry = `Drop ${hit.param} from the call and re-call ONCE with the rest of the request intact — the rest of the request carries real scope and must not be lost with it.`;
    if (hit.kind === "home_country") {
      return hit.axis === "exclude"
        ? `${carry} Excluding ${hit.country} would empty the audience, so that part cannot be honoured at all — say so rather than silently ignoring it.`
        : `${carry} The lens then carries no geo criterion, which is correct: the workspace already covers all of ${hit.country}.`;
    }
    if (hit.kind === "foreign_country") {
      return `${carry} And say this workspace ${holds}, so there is no ${hit.country} audience to add — the result is scoped by the other criteria only.`;
    }
    if (anonymousWhole) {
      return hit.axis === "exclude"
        ? `${carry} Excluding the workspace's own country would empty the audience, so that part cannot be honoured at all — say so rather than silently ignoring it. ${unnamed}`
        : `${carry} The lens then carries no geo criterion, which is correct: the workspace already covers its entire country. ${unnamed}`;
    }
    if (hit.kind === "country_indeterminate") {
      return `${carry} This backend is custom-configured, so claim nothing about whether ${hit.country} is inside it.`;
    }
    return `${carry} And say what the workspace covers rather than presenting the audience as "${hit.value}".`;
  }

  if (intent === "write" && hit.kept.length === 0) {
    const stop = `A country-level value was the ONLY scope passed, so do NOT re-call this tool with ${hit.param} omitted: that persists a lens or filter change carrying no scope at all, to express something this workspace already is. Write NOTHING here.`;
    if (hit.kind === "home_country") {
      return hit.axis === "exclude"
        ? `${stop} Excluding ${hit.country} would empty the entire audience, so it cannot be written either. Ask what should actually be carved out — ${narrow} — and only then write.`
        : `${stop} Say the audience already covers all of ${hit.country}, then offer the axes that DO narrow it: sector, size, or ${narrow}.`;
    }
    if (hit.kind === "foreign_country") {
      return `${stop} Say this workspace ${holds}, so there is no ${hit.country} audience to scope to and none can be created. Ask what to target inside it — ${narrow}.`;
    }
    if (anonymousWhole) {
      return hit.axis === "exclude"
        ? `${stop} Excluding the workspace's own country would empty the entire audience, so it cannot be written either. Ask what should actually be carved out — ${narrow} — and only then write. ${unnamed}`
        : `${stop} Say the audience already covers the workspace entirely, then offer the axes that DO narrow it: sector, size, or ${narrow}. ${unnamed}`;
    }
    if (hit.kind === "country_indeterminate") {
      return `${stop} This backend is custom-configured, so claim nothing about whether ${hit.country} is inside it. Ask what should be targeted — ${narrow} — before writing anything.`;
    }
    return `${stop} A supra-national scope is not an admin area and cannot be persisted. Say what the workspace covers, then ask which part of it to target — ${narrow}.`;
  }

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

    // A mixed EXCLUSION is the one mixed case with no surgical answer. The
    // country is the DOMINANT half of `exclude: ["France", "Paris"]` on FR: it
    // asks for an empty result, and Paris is a detail inside it. "Remove only
    // France and re-call with the rest" silently downgrades that to a
    // Paris-only exclusion and hands back most of France as though it answered
    // — a far narrower question than the one asked, with nothing to signal the
    // substitution. Only a FOREIGN exclusion is a provable no-op and keeps its
    // surgical recovery below.
    if (hit.axis === "exclude" && hit.kind !== "foreign_country") {
      const empties =
        hit.kind === "home_country"
          ? `Excluding ${hit.country} excludes this ENTIRE workspace`
          : hit.kind === "country_indeterminate" && hit.country === null
            ? `Excluding the whole workspace`
            : hit.kind === "country_indeterminate"
              ? `This backend is custom-configured, so whether excluding ${hit.country} empties the workspace is unknown, and`
              : `A supra-national scope may well cover this whole workspace, so excluding it`;
      return `${empties} — so the request as written cannot be honoured, and there is no partial version of it to run. Do NOT re-call with only ${rest} excluded: that answers a much narrower question than the one asked, and nothing in the result would show the substitution. Ask what was actually meant to be carved out — ${narrow} — before re-calling at all.`;
    }

    if (hit.kind === "home_country") {
      return `${surgical} The result then covers ${rest} — describe it as those places, NOT as the whole workspace.`;
    }
    if (hit.kind === "foreign_country") {
      return `${surgical} And say this workspace ${holds}: there are no ${hit.country} leads in it either way, so the result speaks only for ${rest}.`;
    }
    if (anonymousWhole) {
      return `${surgical} The result then covers ${rest} — describe it as those places, NOT as the whole workspace.`;
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
    if (anonymousWhole) {
      return `Excluding the whole workspace leaves nothing, and dropping ${hit.param} does the reverse of what was asked, returning every company instead. Neither is what the user wants: ask what they actually meant to carve out, then exclude ${narrow} instead.`;
    }
    if (hit.kind === "country_indeterminate") {
      return `This backend is custom-configured, so whether ${hit.country} is inside this workspace is unknown — the exclusion may remove everything or nothing. Do not guess: ask what should be carved out, then exclude ${narrow}.`;
    }
    return `A supra-national scope cannot be excluded as an admin area, and dropping ${hit.param} would instead include everything. Say what the workspace covers and ask what should be carved out, then exclude ${narrow}.`;
  }

  // "Covers everything" is only true when the country was the whole scope. On a
  // READ that carries other criteria — a `last_action_date` beside the country
  // in the same `set_filter`, say — the geo argument comes off and the result
  // is still scoped by what remains, so the generic sentence is false. It also
  // contradicted the caveat the caller appends for exactly that case, which
  // ends "never as covering everything": one hint, two opposite instructions.
  const coversAll = !otherScope;

  if (hit.kind === "home_country") {
    return coversAll
      ? `Whole-workspace intent = OMIT ${hit.param} entirely, then say the result covers everything. To narrow, pass ${narrow}. Do NOT retry with another spelling or a nearby city.`
      : `Whole-workspace intent = OMIT ${hit.param} entirely. The rest of the request still scopes the result, so describe it by those criteria — NOT as covering everything. To narrow further, pass ${narrow}. Do NOT retry with another spelling or a nearby city.`;
  }

  if (anonymousWhole) {
    // The request names no country, so there is nothing to hedge: omitting the
    // argument answers it exactly. Only the country's NAME is withheld.
    return coversAll
      ? `Whole-workspace intent = OMIT ${hit.param} entirely, then say the result covers everything in this workspace. ${unnamed} To narrow, pass ${narrow}. Do NOT retry with another spelling or a nearby city.`
      : `Whole-workspace intent = OMIT ${hit.param} entirely. The rest of the request still scopes the result, so describe it by those criteria — NOT as covering this whole workspace. ${unnamed} To narrow further, pass ${narrow}. Do NOT retry with another spelling or a nearby city.`;
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
 * ONE recovery for an argument that carries country-level values of DIFFERENT
 * kinds.
 *
 * The per-kind hints above are each correct alone and mutually exclusive
 * together: `locations: ["France", "Canada"]` on FR produced "OMIT locations
 * entirely" immediately followed by "Do NOT simply drop locations and re-run",
 * and an agent handed both has no safe move left. The snippet is explicit that
 * the kinds are not interchangeable, so they cannot be concatenated — they have
 * to be reconciled.
 *
 * The reconciliation: the ARGUMENT is handled once (every country-level value
 * comes off it, and what survives decides whether it is dropped or trimmed),
 * then each kind contributes only the thing it alone knows — what may be
 * claimed about the result. The home country is the only kind that licenses an
 * unfiltered re-run, and even then only for its own half of the ask.
 */
function reconciledHint(
  hits: readonly CountryHit[],
  region: GuardRegion,
  intent: GuardIntent,
  otherScope: boolean
): string {
  const { param, axis, kept } = hits[0];
  const narrow = NARROW_EXAMPLES[region];
  const home = homeCountryName(region);
  const holds = home ? `holds ${home} companies only` : "covers a single country";
  const quoted = (values: readonly string[]) => values.map((v) => `"${v}"`).join(", ");
  const offending = quoted(hits.map((h) => h.value));
  const countriesOf = (kind: CountryHit["kind"]) => [
    ...new Set(
      hits.filter((h) => h.kind === kind).map((h) => h.country).filter((c): c is string => !!c)
    ),
  ];

  const homeCountry = countriesOf("home_country")[0];
  const foreign = countriesOf("foreign_country");
  const indeterminate = countriesOf("country_indeterminate");
  const supra = hits.filter((h) => h.kind === "supranational").map((h) => h.value);

  // What happens to the argument. Identical in both axes: the offending values
  // leave, and the survivors decide whether that empties it.
  const because =
    new Set(hits.map((h) => h.kind)).size > 1
      ? `they are country-level or wider, and mixing kinds makes none of them usable`
      : `not one of them is a usable location filter`;
  const surgical =
    kept.length > 0
      ? `Do NOT omit ${param} — ${quoted(kept)} ${kept.length > 1 ? "are" : "is"} valid and would be lost with it. Remove ALL of ${offending} in ONE re-call and keep the rest.`
      : `Remove every one of ${offending} from ${param} — ${because}.`;

  // A WRITE tool with an argument that would be left empty. Same reason as in
  // hintFor: the re-call every branch below ends in is itself the forbidden
  // outcome. Stated once for the whole group, since the group is one argument.
  if (intent === "write" && kept.length === 0 && otherScope) {
    return `${surgical} Then re-call ONCE with the rest of the request intact — the rest of the request carries real scope and must not be lost with this argument. Say what the audience actually covers: ${[
      homeCountry ? `it already spans all of ${homeCountry}` : undefined,
      foreign.length > 0 ? `this workspace ${holds}, so no ${foreign.join(", ")} audience can be added` : undefined,
      indeterminate.length > 0
        ? `this backend is custom-configured, so claim nothing about ${indeterminate.join(", ")}`
        : undefined,
      supra.length > 0 ? `${quoted(supra)} is a supra-national scope, not a place` : undefined,
    ]
      .filter(Boolean)
      .join("; ")}.`;
  }

  if (intent === "write" && kept.length === 0) {
    const cannot: string[] = [];
    if (homeCountry) {
      cannot.push(
        axis === "exclude"
          ? `excluding ${homeCountry} would empty the audience entirely`
          : `the audience already covers all of ${homeCountry}`
      );
    }
    if (foreign.length > 0) {
      cannot.push(
        `this workspace ${holds}, so there is no ${foreign.join(", ")} audience to scope to`
      );
    }
    if (indeterminate.length > 0) {
      cannot.push(
        `this backend is custom-configured, so whether ${indeterminate.join(", ")} is inside it is unknown`
      );
    }
    if (supra.length > 0) {
      cannot.push(`${quoted(supra)} is a supra-national scope, which cannot be persisted`);
    }
    return `${surgical} Then STOP: do NOT re-call this tool with ${param} omitted, which would persist a lens or filter change carrying no scope at all. Write NOTHING — ${cannot.join("; ")}. Say what the audience already covers, then offer the axes that DO narrow it: sector, size, or ${narrow}.`;
  }

  const say: string[] = [];
  if (axis === "exclude") {
    if (homeCountry) {
      say.push(
        `excluding ${homeCountry} would empty the ENTIRE workspace, so that part cannot be honoured at all`
      );
    }
    if (foreign.length > 0) {
      say.push(`excluding ${foreign.join(", ")} removes nothing — there is nothing here to exclude`);
    }
    if (indeterminate.length > 0) {
      say.push(
        `this backend is custom-configured, so whether ${indeterminate.join(", ")} is inside it is unknown and its exclusion may remove everything or nothing`
      );
    }
    if (supra.length > 0) {
      say.push(`${quoted(supra)} is a supra-national scope, which is not an admin area and cannot be excluded`);
    }
    const tail =
      kept.length > 0
        ? `The other exclusions still apply.`
        : `Do NOT present the result as though any of these exclusions had been applied.`;
    return `${surgical} Then say why: ${say.join("; ")}. ${tail} Ask what should actually be carved out, then exclude ${narrow}.`;
  }

  // INCLUDE. Only the home country makes an unfiltered re-run meaningful, and
  // only for its own half — so it is stated as a partial answer, never as THE
  // answer.
  const scope =
    kept.length > 0
      ? `The result then covers ${quoted(kept)} — describe it as those places only.`
      : homeCountry
        ? `Omitting ${param} entirely then returns the whole workspace, which IS ${homeCountry}: that answers the ${homeCountry} part of the ask and nothing else — say so in those words.`
        : `Do NOT re-run with ${param} omitted as though the unfiltered result answered this.`;

  if (foreign.length > 0) {
    say.push(
      `this workspace ${holds}, so it holds no ${foreign.join(", ")} companies and the result says nothing about ${foreign.join(", ")}`
    );
  }
  if (indeterminate.length > 0) {
    say.push(
      `this backend is custom-configured, so claim nothing about whether ${indeterminate.join(", ")} is inside it`
    );
  }
  if (supra.length > 0) {
    say.push(
      `${quoted(supra)} is a supra-national scope, not a place — say what the workspace covers and offer the whole-workspace view as an explicit choice, rather than letting the result stand for it`
    );
  }
  return `${surgical} ${scope} And be explicit that ${say.join("; ")}. To narrow, pass ${narrow}. Do NOT retry with another spelling.`;
}

/**
 * The whole write is fail-closed, in one instruction, when ANY exclusion in it
 * cannot be dropped.
 *
 * This is deliberately not a per-argument hint. Hints are otherwise built per
 * argument, and that produced two live instructions for one request:
 * `{locations: ["France"], exclude_locations: ["France"]}` emitted "drop
 * `locations` and re-call ONCE with the rest of the request intact" and then
 * "write nothing" — and an agent that acts on the first has already persisted
 * the inversion. The same contradiction appeared inside a single argument,
 * where the surgical "remove these and re-call" was prepended to the STOP.
 *
 * So a blocked exclusion dominates the entire request and this text carries no
 * re-call directive at all: nothing else can be written either, because it
 * would be written under a scope that inverts what was asked.
 */
function blockedWriteHint(
  hits: readonly CountryHit[],
  region: GuardRegion
): string {
  const narrow = NARROW_EXAMPLES[region];
  const blocked = hits.filter(blocksWrite);
  const quoted = (values: readonly string[]) => values.map((v) => `"${v}"`).join(", ");
  const names = quoted([...new Set(blocked.map((h) => h.value))]);

  const inverts = blocked.some(excludeBlocksWrite);
  const unsupported = blocked.some(includeBlocksWrite);

  const why = [
    ...new Set(
      blocked.map((hit) => {
        if (hit.axis === "exclude") {
          return hit.kind === "home_country"
            ? `"${hit.value}" is this entire workspace, so excluding it asks for an empty audience`
            : hit.kind === "country_indeterminate"
              ? `this backend is custom-configured, so whether "${hit.value}" covers it is unknown`
              : `"${hit.value}" is a supra-national scope, which may well cover this whole workspace`;
        }
        return hit.kind === "foreign_country"
          ? `"${hit.value}" is outside this workspace, so there is no such audience to create`
          : hit.kind === "country_indeterminate"
            ? `this backend is custom-configured, so whether "${hit.value}" is inside it is unknown`
            : `"${hit.value}" is a supra-national scope, which no single workspace can be scoped to`;
      })
    ),
  ].join("; ");

  // Country-level values that are NOT the blocker still have to come off
  // whenever the corrected call is finally made, so they are named once here
  // rather than in a second instruction that reads as an alternative.
  // Minus the blockers themselves: the same value can arrive on both axes, and
  // naming it twice reads as two different problems.
  const blockedValues = new Set(blocked.map((h) => h.value));
  const alsoBad = [
    ...new Set(
      hits.filter((h) => !blocksWrite(h) && !blockedValues.has(h.value)).map((h) => h.value)
    ),
  ];
  const also =
    alsoBad.length > 0
      ? ` When a corrected call is eventually made, ${quoted(alsoBad)} must come off it too — country-level values are never usable.`
      : "";

  // What a "corrected" re-call would actually persist. The two polarities fail
  // differently and an agent needs the one that applies to ITS call.
  const consequence = inverts
    ? `Any call that leaves ${names} out persists the OPPOSITE of the exclusion: an audience holding exactly what was asked to be removed. The rest of the request cannot be written either, because it would be written under that inverted scope.`
    : `Any call that leaves ${names} out persists an audience for THIS workspace instead — a real, saved audience for a territory nobody asked about. The rest of the request does not survive on its own: sectors, sizes and keywords were qualifying ${names}, not a second request to be written without it.`;

  const bothNote =
    inverts && unsupported
      ? " Both failures are present in this one call, and neither is fixed by dropping the other."
      : "";

  // The verb has to match the polarity. An exclusion asked to REMOVE something,
  // so "what should actually be carved out" is the question; an include asked to
  // target something. Getting this backwards reads as a non-sequitur at exactly
  // the moment the agent is deciding what to ask the user.
  const ask = inverts
    ? `Ask what should actually be carved out — ${narrow} — and write only once that is settled.`
    : `Ask what should actually be targeted — ${narrow} — and write only once that is settled.`;

  return `Write NOTHING, and do NOT re-call this tool in any form — not without ${names}, and not "with the rest of the request intact". ${why}. ${consequence}${bothNote}${also} ${ask}`;
}

/**
 * The single source of truth for the code, message and hint. Every hit is
 * reported, not just the first, so an agent fixes one envelope instead of
 * discovering its bad values one turn at a time.
 */
export function countryLocationEnvelope(
  hits: readonly CountryHit[],
  region: GuardRegion,
  intent: GuardIntent = "read",
  otherScope = false,
  /**
   * Appended ONLY when the recovery actually tells the caller to omit the
   * argument. Some tools need more than the omission to genuinely widen:
   * `pull_followups` defaults `filtered` to true, so a re-call without `city`
   * still reads through whatever Monitor filter was persisted earlier and hands
   * back that stale cohort as though it were the whole workspace.
   */
  omitCaveat?: string
): CountryLocationEnvelope {
  const message = hits.map((hit) => messageFor(hit, region)).join(" ");

  // Every recovery below is phrased as "remove the value". For a country the
  // guard only saw through an echoed NAME, removing the value is not enough and
  // not even the right edit: the criterion selects it by ID, and a bare id is
  // not classifiable (product#3939), so a re-call that dropped only the echoed
  // name would persist the country filter past a guard that could no longer see
  // it. Appended once for the whole request, after whichever recovery applies.
  const selectedIds = [
    ...new Set(
      hits
        .filter((hit) => hit.selectedId !== undefined)
        .map((hit) => `"${hit.selectedId}" (echoed as "${hit.value}")`)
    ),
  ];
  // The offending value lives in a criterion that has siblings. Two things go
  // wrong without this: the recovery reads as "omit and you cover everything"
  // when the siblings still scope the result, and "remove the locations" leaves
  // a `location_ids` criterion holding nothing, which is invalid rather than
  // neutral.
  const siblings = [
    ...new Set(hits.flatMap((hit) => hit.siblingCriteria ?? [])),
  ];
  // Whether removing the offending values actually EMPTIES the criterion. When
  // a real place survives on it, "remove the whole criterion" would discard
  // that place — the opposite mistake, and the same one the mixed-array branch
  // exists to prevent. So the emptiness half is conditional; the surviving-scope
  // half is not.
  const emptiesCriterion = hits
    .filter((hit) => (hit.siblingCriteria?.length ?? 0) > 0)
    .every((hit) => hit.kept.length === 0);
  const siblingNote =
    siblings.length === 0
      ? ""
      : `${
          emptiesCriterion
            ? " Removing it leaves that `location_ids` criterion holding nothing, so remove the WHOLE criterion rather than just its `locations` property — an empty `location_ids` criterion is invalid, not neutral."
            : " Keep the `location_ids` criterion itself — it still selects a real place once the country comes off."
        } The other criteria in this filter (${siblings
          .map((type) => `\`${type}\``)
          .join(", ")}) survive and keep scoping the result, so describe it by them and never as covering everything.`;

  const idNote =
    selectedIds.length === 0
      ? ""
      : ` ${selectedIds.length > 1 ? "These are" : "This is"} selected by ID, not by name: remove ${selectedIds.join(", ")} from the \`location_ids\` criterion in \`lens_filter.items[].criteria[]\` itself. Deleting the echoed \`locations.results[].name\` row alone leaves the id selected and the country filter in force.`;

  // Reconciled across the WHOLE request before anything per-argument is
  // emitted: one un-droppable exclusion fails the entire write closed, and a
  // per-argument hint sitting beside it would be a live instruction to perform
  // the mutation it forbids.
  if (intent === "write" && hits.some(blocksWrite)) {
    // No omitCaveat here: this branch forbids the re-call outright.
    const blocked = blockedWriteHint(hits, region) + siblingNote + idNote;
    return { code: COUNTRY_LEVEL_LOCATION, message, hint: blocked };
  }

  // Hints are built PER ARGUMENT+AXIS, not per value. Two arguments genuinely
  // need two instructions; two KINDS on one argument need one reconciled
  // instruction, because the per-kind recoveries contradict each other by
  // design (only the home country licenses an unfiltered re-run). Insertion
  // order is preserved so the envelope reads in the order the caller sent the
  // arguments.
  const groups = new Map<string, CountryHit[]>();
  for (const hit of hits) {
    const key = `${hit.param}\u0000${hit.axis}`;
    const group = groups.get(key);
    if (group) group.push(hit);
    else groups.set(key, [hit]);
  }

  // Sibling criteria ARE other scope, so they decide this the same way the
  // caller's flag does. Derived here rather than trusted from the argument:
  // `siblingNote` below is built from the very same `siblings`, and when the two
  // were computed independently they disagreed — both read call sites passed a
  // hardcoded `false` while siblings existed, so one string promised "the result
  // covers everything" and then forbade saying it. Reading both halves off one
  // fact makes that shape unrepresentable rather than merely fixed at the two
  // call sites that happened to have it.
  const scoped = otherScope || siblings.length > 0;

  const hints: string[] = [];
  const push = (hint: string) => hints.push(hint);
  for (const group of groups.values()) {
    // Reconciled whenever the argument carries MORE THAN ONE offender, same
    // kind or not. Same-kind hints do not contradict each other on what to
    // claim, but they do on what to DO: two per-hit hints each said `Remove
    // ONLY "Canada"` / `Remove ONLY "Germany"` and re-call, so following either
    // one literally leaves the other country in place, and "ONLY" made that
    // read as deliberate. One argument gets one instruction.
    if (group.length === 1) push(hintFor(group[0], region, intent, scoped));
    else push(reconciledHint(group, region, intent, scoped));
  }
  const joined = hints.join(" ");
  // Conditioned on the assembled text rather than re-deriving the branch, so it
  // cannot drift from what hintFor actually said.
  const caveat = omitCaveat !== undefined && joined.includes("OMIT") ? ` ${omitCaveat}` : "";
  const hint = joined + caveat + siblingNote + idNote;
  return { code: COUNTRY_LEVEL_LOCATION, message, hint };
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
  region: GuardRegion,
  intent: GuardIntent = "read",
  otherScope = false
): void {
  const hits = detectCountryLocationsIn(params, region);
  if (hits.length === 0) return;
  const envelope = countryLocationEnvelope(hits, region, intent, otherScope);
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
  region: GuardRegion,
  intent: GuardIntent = "read",
  otherScope = false,
  /** See `countryLocationEnvelope` — appended only to an OMIT recovery. */
  omitCaveat?: string
): {
  status: typeof COUNTRY_LEVEL_STATUS;
  code: typeof COUNTRY_LEVEL_LOCATION;
  message: string;
  hint: string;
  country_locations: CountryHit[];
} {
  const envelope = countryLocationEnvelope(hits, region, intent, otherScope, omitCaveat);
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
    // Everything else in this filter survives the recovery and keeps scoping
    // the result. Only visible here — a hit built from one criterion's
    // `locations` array cannot see the array it came from.
    const siblings = [
      ...new Set(
        criteria
          .filter((other) => other !== criterion)
          .map((other) => (other as Record<string, unknown> | null)?.type)
          .filter((type): type is string => typeof type === "string")
      ),
    ];
    hits.push(
      ...detectCountryLocations(record.locations, param, region, axis).map((hit) =>
        siblings.length === 0 ? hit : { ...hit, siblingCriteria: siblings }
      )
    );
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
/**
 * Does this lens-filter payload carry scope OUTSIDE its location criteria?
 *
 * A sector, keyword or size criterion is real audience scope, and
 * `update_lens_filter` REPLACES the whole filter — so refusing to write when a
 * country rode along beside one would discard the criterion the user meant.
 * Only the absence of any non-location criterion makes the country the sole
 * scope, and only then does the write-stop apply.
 */
/**
 * Ids whose echoed name is country-level.
 *
 * An opaque id counts as real scope everywhere else in this module — nothing
 * here can tell "416102" from a country, which is the documented limit
 * (product#3939). But when the SAME payload echoes a name for it, that limit
 * does not apply: the id is known to be a country, and treating it as surviving
 * scope told update_lens_filter to "remove the country and re-call with the
 * remainder" — where the remainder is nothing, so the corrected call replaces
 * the lens with an empty filter. WORKFLOWS.md requires writing nothing.
 */
function echoedCountryIds(filter: unknown, region: GuardRegion): Set<string> {
  const ids = new Set<string>();
  const locations = (filter as Record<string, unknown> | null)?.locations as
    | Record<string, unknown>
    | undefined;
  for (const block of ["results", "parents"] as const) {
    const rows = locations?.[block];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const record = row as Record<string, unknown> | null;
      const name = record?.name;
      const id = record?.id;
      if (typeof name !== "string") continue;
      if (typeof id !== "string" && typeof id !== "number") continue;
      if (classify(name, region) !== null) ids.add(String(id));
    }
  }
  return ids;
}

export function filterCarriesOtherScope(filter: unknown, region: GuardRegion): boolean {
  if (!filter || typeof filter !== "object") return false;
  const lensFilter = (filter as Record<string, unknown>).lens_filter as
    | Record<string, unknown>
    | undefined;
  const items = lensFilter?.items;
  if (!Array.isArray(items)) return false;
  const countryIds = echoedCountryIds(filter, region);
  for (const item of items) {
    const criteria = (item as Record<string, unknown> | null)?.criteria;
    if (!Array.isArray(criteria)) continue;
    for (const criterion of criteria) {
      const record = criterion as Record<string, unknown> | null;
      if (!record) continue;
      if (record.type !== "location_ids") return true;
      // A location criterion still counts when it names a real place beside the
      // country — the filter is replaced wholesale, so stopping loses it. Ids
      // the echoed block has already named as countries are not such places.
      const values = (Array.isArray(record.locations) ? record.locations : []).filter(
        (value) => !countryIds.has(String(value))
      );
      if (geoScopeSurvives([{ input: values, param: "locations" }], region)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Whether a Monitor `set_filter` still carries usable scope once the
 * country-level values come off it.
 *
 * The first version of this test lived inline in `pull_followups` and rejected
 * every criterion of type `location_ids` outright — on the assumption that a
 * location criterion holding a country holds nothing else. It can:
 * `{city: "France", set_filter: {criteria: [{type: "location_ids",
 * locations: ["99"]}]}}` puts the offender on `city`, so no hit knows about the
 * Paris id, and a type-only test then reported "nothing else was requested" and
 * advised `filtered:false` — discarding exactly the scope the caller asked for.
 * So the VALUES decide, not the type.
 *
 * No echoed-id discount here, unlike `filterCarriesOtherScope`: a Monitor
 * `set_filter` is the raw criteria array the caller sent, with no denormalized
 * `locations` block to cross-reference.
 */
export function setFilterCarriesOtherScope(
  setFilter: unknown,
  region: GuardRegion
): boolean {
  if (!setFilter || typeof setFilter !== "object") return false;
  const criteria = (setFilter as Record<string, unknown>).criteria;
  if (!Array.isArray(criteria)) return false;
  for (const criterion of criteria) {
    const record = criterion as Record<string, unknown> | null;
    if (!record) continue;
    // Any non-geo criterion is scope the recovery must not discard.
    if (record.type !== "location_ids") return true;
    const values = Array.isArray(record.locations) ? record.locations : [];
    if (geoScopeSurvives([{ input: values, param: "locations" }], region)) return true;
  }
  return false;
}

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
  // id -> the OTHER criteria in the same item, for exactly the same reason the
  // name path carries them. `criteriaHits` attaches siblings when the country
  // arrives as text; a country arriving as a bare ID is discovered further down
  // via its echoed name and used to build a separate hit, which had none. The
  // recovery then said "remove the id from the criterion" without "and remove
  // the criterion itself" — leaving a `location_ids` criterion holding nothing,
  // which is invalid rather than neutral, on the very retry it authorized.
  const siblingsById = new Map<string, string[]>();
  // id -> the other IDs selected by the SAME location_ids criterion. The echoed
  // path rebuilds its hit from one country NAME, so `kept` came out empty even
  // when the criterion also selected a real place: `locations: ["27925","99"]`
  // (France, Paris) produced "omit the whole locations property" alongside an id
  // note saying to remove only 27925. Following the first discards Paris;
  // following it literally leaves an invalid criterion. Neither is recoverable
  // from the text, so the sibling ids travel with the hit.
  const criterionIdsById = new Map<string, string[]>();
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
        const siblings = [
          ...new Set(
            criteria
              .filter((other) => other !== criterion)
              .map((other) => (other as Record<string, unknown> | null)?.type)
              .filter((type): type is string => typeof type === "string")
          ),
        ];
        const ids = Array.isArray(record.locations) ? record.locations : [];
        for (const id of ids) {
          if (typeof id === "string" || typeof id === "number") {
            const key = String(id);
            // An id named by BOTH axes is contradictory input; the exclusion is
            // the destructive reading, so it wins.
            if (axis === "exclude" || !polarityById.has(key)) {
              polarityById.set(key, axis);
            }
            if (siblings.length > 0) {
              siblingsById.set(key, [
                ...new Set([...(siblingsById.get(key) ?? []), ...siblings]),
              ]);
            }
            const others = ids
              .filter((other) => typeof other === "string" || typeof other === "number")
              .map((other) => String(other))
              .filter((other) => other !== key);
            if (others.length > 0) {
              criterionIdsById.set(key, [
                ...new Set([...(criterionIdsById.get(key) ?? []), ...others]),
              ]);
            }
          }
        }
      }
    }
  }

  // The echoed blocks are consulted ONLY to put a name on an id the criteria
  // already select. `results` and `parents` are both denormalized lookup data,
  // and `parents` in particular is a breadcrumb: a filter legitimately scoped to
  // Île-de-France echoes France as its ancestor, and reading that row as a
  // selected value rejected a filter whose criteria never mentioned a country.
  // So a row participates only when its id is actually referenced by a
  // location_ids criterion — which is also the only case the id-only bypass
  // needed it for. A country passed by NAME inside a criterion is caught by
  // criteriaHits above and does not depend on this at all.
  const locations = asRecord.locations as Record<string, unknown> | undefined;
  const echoedRows: Array<{ id: string; name: string }> = [];
  for (const block of ["results", "parents"] as const) {
    const rows = locations?.[block];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const record = row as Record<string, unknown> | null;
      const name = record?.name;
      if (typeof name !== "string") continue;
      const id = record?.id;
      if (typeof id !== "string" && typeof id !== "number") continue;
      echoedRows.push({ id: String(id), name });
    }
  }

  // Pass 1: which selected ids are themselves country-level. Needed before any
  // hit is built, because a SECOND country in the same criterion must never be
  // listed as a survivor to keep — that would tell the caller to preserve the
  // very thing the other hit is telling them to remove.
  const countryIds = new Set(
    echoedRows
      .filter(({ id, name }) => {
        const axis = polarityById.get(id);
        return (
          axis !== undefined &&
          detectCountryLocations(name, "probe", region, axis).length > 0
        );
      })
      .map(({ id }) => id)
  );

  // Pass 2: build the hits, each carrying what survives beside it.
  for (const { id, name } of echoedRows) {
    const axis = polarityById.get(id);
    if (axis === undefined) continue;
    const siblings = siblingsById.get(id);
    // An id with no echoed name is unclassifiable but still something the
    // caller asked for, so it survives — same rule detectCountryLocations
    // already applies to a raw numeric id on a plain argument.
    // Named where the echo can name them: the caller edits the criterion BY id,
    // so the id has to be the thing said — but "99" alone is not something a
    // human can check the recovery against.
    const nameById = new Map(echoedRows.map((row) => [row.id, row.name]));
    const kept = (criterionIdsById.get(id) ?? [])
      .filter((other) => !countryIds.has(other))
      .map((other) => {
        const label = nameById.get(other);
        return label === undefined ? other : `${other} (${label})`;
      });
    hits.push(
      ...detectCountryLocations(
        name,
        `filter.lens_filter.items[].criteria[].locations`,
        region,
        axis,
        id
      ).map((hit) => ({
        ...hit,
        ...(siblings === undefined ? {} : { siblingCriteria: siblings }),
        ...(kept.length === 0 ? {} : { kept }),
      }))
    );
  }

  return hits;
}
