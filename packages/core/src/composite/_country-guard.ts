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
    if (WHOLE_WORKSPACE_KEYS.has(key)) {
      const homeIso2 = homeCountryIso2(region);
      // No home country (custom backend) → we cannot claim it means "everything
      // here", so fall back to the conservative report-the-scope treatment.
      if (homeIso2 === undefined) return { kind: "supranational" };
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

function hintFor(
  hit: CountryHit,
  region: GuardRegion,
  intent: GuardIntent,
  otherScope: boolean
): string {
  const narrow = NARROW_EXAMPLES[region];
  const home = homeCountryName(region);
  const holds = home ? `holds ${home} companies only` : "covers a single country";

  // A WRITE carrying an exclusion that cannot be dropped. First of everything,
  // because both branches below end in a re-call and here any re-call writes
  // the INVERSE of the request: the user asked for these companies gone, and
  // the lens would be persisted containing them. True whatever else survives —
  // a surviving sector or a surviving city does not make the inversion less
  // wrong, it just decides how much gets written.
  if (intent === "write" && excludeBlocksWrite(hit)) {
    const why =
      hit.kind === "home_country"
        ? `${hit.country} is this entire workspace, so excluding it asks for an empty audience`
        : hit.kind === "country_indeterminate"
          ? `this backend is custom-configured, so whether ${hit.country} covers it is unknown and the exclusion may remove everything`
          : `"${hit.value}" is a supra-national scope, which may well cover this whole workspace`;
    return `Do NOT drop ${hit.param} and re-call: ${why}, and writing the request WITHOUT the exclusion persists the opposite — an audience holding exactly what was asked to be removed. Write NOTHING here. Ask what should actually be carved out — ${narrow} — and only then write.`;
  }

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
  // Same rule as hintFor, at group level: one un-droppable exclusion in the
  // group blocks the write, whatever else is in it.
  if (intent === "write" && hits.some(excludeBlocksWrite)) {
    const blocked = hits.filter(excludeBlocksWrite).map((h) => `"${h.value}"`).join(", ");
    return `${surgical} Then STOP: do NOT re-call without ${blocked} — writing the request without ${blocked} persists the OPPOSITE of the exclusion, an audience holding exactly what was asked to be removed. Write NOTHING here. Ask what should actually be carved out — ${narrow} — and only then write.`;
  }

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
 * The single source of truth for the code, message and hint. Every hit is
 * reported, not just the first, so an agent fixes one envelope instead of
 * discovering its bad values one turn at a time.
 */
export function countryLocationEnvelope(
  hits: readonly CountryHit[],
  region: GuardRegion,
  intent: GuardIntent = "read",
  otherScope = false
): CountryLocationEnvelope {
  const message = hits.map((hit) => messageFor(hit, region)).join(" ");

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

  const hints: string[] = [];
  const push = (hint: string) => hints.push(hint);
  for (const group of groups.values()) {
    // Reconciled whenever the argument carries MORE THAN ONE offender, same
    // kind or not. Same-kind hints do not contradict each other on what to
    // claim, but they do on what to DO: two per-hit hints each said `Remove
    // ONLY "Canada"` / `Remove ONLY "Germany"` and re-call, so following either
    // one literally leaves the other country in place, and "ONLY" made that
    // read as deliberate. One argument gets one instruction.
    if (group.length === 1) push(hintFor(group[0], region, intent, otherScope));
    else push(reconciledHint(group, region, intent, otherScope));
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
  otherScope = false
): {
  status: typeof COUNTRY_LEVEL_STATUS;
  code: typeof COUNTRY_LEVEL_LOCATION;
  message: string;
  hint: string;
  country_locations: CountryHit[];
} {
  const envelope = countryLocationEnvelope(hits, region, intent, otherScope);
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
/**
 * Does this lens-filter payload carry scope OUTSIDE its location criteria?
 *
 * A sector, keyword or size criterion is real audience scope, and
 * `update_lens_filter` REPLACES the whole filter — so refusing to write when a
 * country rode along beside one would discard the criterion the user meant.
 * Only the absence of any non-location criterion makes the country the sole
 * scope, and only then does the write-stop apply.
 */
export function filterCarriesOtherScope(filter: unknown, region: GuardRegion): boolean {
  if (!filter || typeof filter !== "object") return false;
  const lensFilter = (filter as Record<string, unknown>).lens_filter as
    | Record<string, unknown>
    | undefined;
  const items = lensFilter?.items;
  if (!Array.isArray(items)) return false;
  for (const item of items) {
    const criteria = (item as Record<string, unknown> | null)?.criteria;
    if (!Array.isArray(criteria)) continue;
    for (const criterion of criteria) {
      const record = criterion as Record<string, unknown> | null;
      if (!record) continue;
      if (record.type !== "location_ids") return true;
      // A location criterion still counts when it names a real place beside the
      // country — the filter is replaced wholesale, so stopping loses it.
      if (geoScopeSurvives([{ input: record.locations, param: "locations" }], region)) {
        return true;
      }
    }
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
  for (const block of ["results", "parents"] as const) {
    const rows = locations?.[block];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const record = row as Record<string, unknown> | null;
      const name = record?.name;
      if (typeof name !== "string") continue;
      const id = record?.id;
      if (typeof id !== "string" && typeof id !== "number") continue;
      const axis = polarityById.get(String(id));
      if (axis === undefined) continue;
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
