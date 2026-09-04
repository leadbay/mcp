/**
 * `rejectCountryLocations` — the country-level fence guard, both directions.
 *
 * The guard originally recognized only US and France aliases, so `Canada`,
 * `United Kingdom`, `Germany` and every other country sailed through to
 * `/mcp/search` and hit the very failure the guard exists to stop: the backend
 * excludes countries from admin-area search, so the trigram resolver falls
 * through to an arbitrary same-named town and fences the whole job to one
 * village — silently.
 *
 * The fix builds the set from `Intl.DisplayNames` over every ISO 3166-1 code
 * in English and French. That is comprehensive, and comprehensiveness is
 * exactly what makes the SECOND half of this file load-bearing: a naive
 * country list also swallows `Georgia` (a US state, and a common one to fence
 * on) and every French overseas region, each of which carries its own ISO
 * entry. Rejecting those would trade a silent wrong fence for a loud wrong
 * rejection on a legitimate search.
 */

import { describe, it, expect } from "vitest";
import { rejectCountryLocations } from "../../../src/composite/_mcp-job-helpers.js";

/** The guard throws a plain error envelope, not an Error instance. */
function rejects(value: unknown): boolean {
  try {
    rejectCountryLocations(value);
    return false;
  } catch (e) {
    expect((e as { code?: string }).code).toBe("COUNTRY_LEVEL_LOCATION");
    return true;
  }
}

describe("rejectCountryLocations — countries are rejected", () => {
  it("rejects the two originally-covered countries", () => {
    for (const v of ["United States", "USA", "France", "la France"]) {
      expect(rejects([v]), v).toBe(true);
    }
  });

  it("rejects the countries the two-country allowlist let through", () => {
    // The regression Codex caught on #168: these reached /mcp/search untouched.
    for (const v of ["Canada", "United Kingdom", "Germany", "Spain", "Japan"]) {
      expect(rejects([v]), v).toBe(true);
    }
  });

  it("rejects French-language country names too", () => {
    for (const v of ["Allemagne", "Royaume-Uni", "Espagne", "Belgique"]) {
      expect(rejects([v]), v).toBe(true);
    }
  });

  it("still folds spelling variants — accents, articles, punctuation", () => {
    for (const v of ["  the United Kingdom ", "l'Allemagne", "ESPAGNE"]) {
      expect(rejects([v]), v).toBe(true);
    }
  });

  it("still catches a bare string passed where a list was declared", () => {
    expect(rejects("Germany")).toBe(true);
  });
});

describe("rejectCountryLocations — legitimate sub-national fences survive", () => {
  it("does not reject Georgia, which is a US state before it is a country", () => {
    for (const v of ["Georgia", "georgia", "Géorgie"]) {
      expect(rejects([v]), v).toBe(false);
    }
  });

  it("does not reject the French overseas regions", () => {
    // Each carries its own ISO 3166-1 entry, so a comprehensive country list
    // swallows all of them — while "leads in Martinique" is a normal ask.
    for (const v of [
      "Guadeloupe",
      "Martinique",
      "La Réunion",
      "Mayotte",
      "Guyane française",
      "Nouvelle-Calédonie",
    ]) {
      expect(rejects([v]), v).toBe(false);
    }
  });

  it("does not reject ordinary cities, states and regions", () => {
    for (const v of [
      "Austin",
      "Texas",
      "Lyon",
      "Nouvelle-Aquitaine",
      "Brooklyn",
    ]) {
      expect(rejects([v]), v).toBe(false);
    }
  });

  it("lets a town be disambiguated by its state, as the hint tells the user", () => {
    // "Lebanon" alone IS ambiguous and is rejected on purpose; qualifying it
    // folds to a two-word key that no country name matches.
    expect(rejects(["Lebanon"])).toBe(true);
    expect(rejects(["Lebanon, Kentucky"])).toBe(false);
  });

  it("no-ops on absent locations", () => {
    expect(rejects(undefined)).toBe(false);
    expect(rejects(null)).toBe(false);
    expect(rejects([])).toBe(false);
  });
});
