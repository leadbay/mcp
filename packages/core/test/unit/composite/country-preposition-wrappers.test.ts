/**
 * The plainest way a person names a country in a location argument.
 *
 * The wrapper list shipped covering the elaborate phrasings — "across the
 * United States", "dans toute la France", "partout en France" — and missing the
 * bare prepositions that carry most real traffic: "in the United States", "en
 * France", "aux États-Unis". Those values were classified as nothing, so the
 * guard returned no hit and the call went on to `/geo/search`, where the
 * admin-area index has no country nodes and the value trigram-matches a
 * same-named town (product#3951, product#3885). A guard that catches the fancy
 * spelling and misses the plain one is not a guard.
 *
 * The FRENCH supra-national labels were the same shape of gap: `EU` and
 * `European Union` were covered while `UE` and `Union européenne` were not — on
 * the one backend whose users write French.
 */
import { describe, it, expect } from "vitest";

import { detectCountryLocationsIn } from "../../../src/composite/_country-guard.js";

const hit = (value: string, region: "us" | "fr") =>
  detectCountryLocationsIn([{ input: [value], param: "locations" }], region)[0];

describe("bare-preposition wrappers around a country name", () => {
  const CASES: ReadonlyArray<{
    value: string;
    region: "us" | "fr";
    country: string;
    kind: string;
  }> = [
    { value: "in the United States", region: "us", country: "United States", kind: "home_country" },
    { value: "In the US", region: "us", country: "United States", kind: "home_country" },
    { value: "en France", region: "fr", country: "France", kind: "home_country" },
    { value: "dans la France", region: "fr", country: "France", kind: "home_country" },
    { value: "au Canada", region: "us", country: "Canada", kind: "foreign_country" },
    { value: "aux États-Unis", region: "fr", country: "United States", kind: "foreign_country" },
    // Accents are folded by countryKey, so the unaccented spelling a keyboard
    // without a French layout produces must land identically.
    { value: "aux Etats-Unis", region: "fr", country: "United States", kind: "foreign_country" },
    { value: "in France", region: "us", country: "France", kind: "foreign_country" },
  ];

  it.each(CASES)("$value on $region → $kind", ({ value, region, country, kind }) => {
    const found = hit(value, region);
    expect(found, `"${value}" reached /geo/search unguarded`).toBeDefined();
    expect(found.country).toBe(country);
    expect(found.kind).toBe(kind);
  });

  it("still prefers the LONGER wrapper when both could match", () => {
    // /^dans\s+/ must not eat "dans toute la France" before
    // /^dans\s+toute\s+la\s+/ gets it — both end on France, but only the
    // ordered list guarantees the wrapper strip is stable rather than lucky.
    expect(hit("dans toute la France", "fr").country).toBe("France");
    expect(hit("partout en France", "fr").country).toBe("France");
  });
});

describe("real place names are untouched by the new wrappers", () => {
  // The strip only counts when the REMAINDER is a recognized country, so
  // ordinary admin areas that happen to begin with these letters stay clean.
  // A false positive here would block legitimate prospecting, which is the
  // more expensive failure of the two.
  const SAFE: ReadonlyArray<{ value: string; region: "us" | "fr" }> = [
    { value: "Indiana", region: "us" },
    { value: "Indre-et-Loire", region: "fr" },
    { value: "Aubervilliers", region: "fr" },
    { value: "Austin", region: "us" },
    { value: "Aurillac", region: "fr" },
    { value: "Ennis", region: "us" },
    { value: "Auvergne-Rhône-Alpes", region: "fr" },
    { value: "Independence", region: "us" },
  ];

  it.each(SAFE)("$value on $region is not a country-level value", ({ value, region }) => {
    expect(hit(value, region), `"${value}" was wrongly rejected as a country`).toBeUndefined();
  });
});

describe("French supra-national labels", () => {
  const FR_SUPRA = ["UE", "Union européenne", "Union Europeenne", "Zone euro", "Amérique du Nord"];

  it.each(FR_SUPRA)("%s classifies as supranational on fr", (value) => {
    const found = hit(value, "fr");
    expect(found, `"${value}" reached /geo/search unguarded`).toBeDefined();
    expect(found.kind).toBe("supranational");
  });

  it("their English twins keep working", () => {
    expect(hit("EU", "fr").kind).toBe("supranational");
    expect(hit("European Union", "fr").kind).toBe("supranational");
  });

  it("a preposition wrapper around one is caught too", () => {
    // "des leads dans l'UE" is how the ask actually arrives; countryKey turns
    // the apostrophe into a separator, so the value reaching the guard is
    // "dans l ue".
    expect(hit("dans l'UE", "fr").kind).toBe("supranational");
  });
});
