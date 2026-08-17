/**
 * Unit matrix for the single-country-universe guard (product#3951).
 *
 * The sweeps at the bottom are the point of this file. A country blocklist is
 * easy to write and easy to get catastrophically wrong: the raw ISO 3166-1 list
 * contains Guadeloupe, Martinique, Réunion and Guyane (legitimate FR admin
 * areas), Puerto Rico and Guam (legitimate US ones), and 26 alpha-2 codes that
 * are also US state postal codes. Asserting every US state and every French
 * région/département still resolves is what forces those exemptions to exist
 * rather than being trusted to a comment.
 */
import { describe, it, expect } from "vitest";

import { REGIONS } from "../../../src/client.js";
import {
  COUNTRIES,
  COUNTRY_KEY_COLLISIONS,
  HOME_COUNTRY_BY_REGION,
  REGION_EXEMPT_KEYS,
  countryKey,
} from "../../../src/composite/_country-names.js";
import {
  COUNTRY_LEVEL_LOCATION,
  countryLocationEnvelope,
  countryLocationStatus,
  detectCountryLocations,
  detectCountryLocationsIn,
  detectCountryLocationsInFilter,
  rejectCountryLocations,
  type GuardRegion,
} from "../../../src/composite/_country-guard.js";

const hitsFor = (value: unknown, region: GuardRegion = "us") =>
  detectCountryLocations(value, "locations", region);

const rejects = (value: string, region: GuardRegion = "us") =>
  hitsFor(value, region).length > 0;

describe("_country-names dataset integrity", () => {
  it("carries the full ISO 3166-1 list with unique codes", () => {
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(249);
    expect(new Set(COUNTRIES.map((c) => c.iso2)).size).toBe(COUNTRIES.length);
    expect(new Set(COUNTRIES.map((c) => c.iso3)).size).toBe(COUNTRIES.length);
  });

  it("no two countries fold to the same key", () => {
    // A collision means one country silently shadows another.
    expect(COUNTRY_KEY_COLLISIONS).toEqual([]);
  });

  it("every entry has both an English and a French name", () => {
    const missing = COUNTRIES.filter((c) => !c.name?.trim() || !c.nameFr?.trim());
    expect(missing.map((c) => c.iso2)).toEqual([]);
  });

  it("every backend region has a home country and an exemption set", () => {
    // Adding a third region (say `de`) without wiring these tables would give
    // that backend NO home country: "Germany" would be classified foreign on a
    // German universe, and every German admin area homonym would be refused.
    // Fail here rather than shipping a silently-wrong guard.
    const missingHome = Object.keys(REGIONS).filter(
      (region) => !(region in HOME_COUNTRY_BY_REGION)
    );
    const missingExempt = Object.keys(REGIONS).filter(
      (region) => !(region in REGION_EXEMPT_KEYS)
    );
    expect(missingHome, "add the region to HOME_COUNTRY_BY_REGION").toEqual([]);
    expect(missingExempt, "add the region to REGION_EXEMPT_KEYS").toEqual([]);
  });

  it("every home country resolves to a real entry in the dataset", () => {
    for (const iso2 of Object.values(HOME_COUNTRY_BY_REGION)) {
      expect(COUNTRIES.some((c) => c.iso2 === iso2)).toBe(true);
    }
  });

  it("marks the French and US dependent territories with their sovereign", () => {
    const fr = COUNTRIES.filter((c) => c.sovereign === "FR").map((c) => c.iso2);
    const us = COUNTRIES.filter((c) => c.sovereign === "US").map((c) => c.iso2);
    // Without these the guard would reject legitimate in-universe admin areas.
    expect(fr).toEqual(
      expect.arrayContaining(["GP", "MQ", "RE", "YT", "GF", "MF", "BL", "NC", "PF", "PM", "WF"])
    );
    expect(us).toEqual(
      expect.arrayContaining(["PR", "GU", "VI", "AS", "MP"])
    );
  });
});

describe("countryKey normalization", () => {
  it("folds articles, accents, punctuation and case", () => {
    expect(countryKey("la France")).toBe("france");
    expect(countryKey("les États-Unis")).toBe("etats unis");
    expect(countryKey("U.S.")).toBe("us");
    expect(countryKey("U.S")).toBe("us");
    expect(countryKey("  FRANCE  ")).toBe("france");
    expect(countryKey("France?")).toBe("france");
    expect(countryKey("(France)")).toBe("france");
  });

  it("folds the ELIDED French article — the bug the earlier guard had", () => {
    // Deleting apostrophes before the article strip left "lallemagne", so the
    // leading-article branch was dead for every elided French country name.
    expect(countryKey("l'Allemagne")).toBe("allemagne");
    expect(countryKey("l'Espagne")).toBe("espagne");
    expect(countryKey("l'Italie")).toBe("italie");
  });

  it("keeps qualified place names distinct from the bare country", () => {
    // This is the user's override path AND the anti-false-positive guarantee.
    expect(countryKey("Île-de-France")).not.toBe(countryKey("France"));
    expect(countryKey("China, ME")).not.toBe(countryKey("China"));
    expect(countryKey("Mexico, MO")).not.toBe(countryKey("Mexico"));
    expect(countryKey("Val-d'Oise")).toBe("val d oise");
  });
});

describe("rejected values — US universe", () => {
  const homeLabels = [
    "United States",
    "the United States",
    "United States of America",
    "U.S",
    "U.S.",
    "U.S.A.",
    "USA",
    "America",
    "us",
    "  US  ",
    "États-Unis",
    "les États-Unis",
    "etats-unis",
    "Etats Unis",
  ];
  for (const value of homeLabels) {
    it(`rejects the home country ${JSON.stringify(value)}`, () => {
      const hits = hitsFor(value, "us");
      expect(hits).toHaveLength(1);
      expect(hits[0].kind).toBe("home_country");
    });
  }

  const foreignLabels = [
    "France",
    "la France",
    "République Française",
    "FRA",
    "Germany",
    "Deutschland",
    "l'Allemagne",
    "DEU",
    "United Kingdom",
    "UK",
    "Great Britain",
    "Netherlands",
    "Holland",
    "United Arab Emirates",
    "UAE",
    "China",
    "Mexico",
    "Brazil",
    "Luxembourg",
    "Monaco",
    "Chad",
    "Bosnia and Herzegovina",
    "Bosnia & Herzegovina",
    "Côte d'Ivoire",
    "Ivory Coast",
    "Guadeloupe",
  ];
  for (const value of foreignLabels) {
    it(`rejects the foreign country ${JSON.stringify(value)}`, () => {
      const hits = hitsFor(value, "us");
      expect(hits).toHaveLength(1);
      expect(hits[0].kind).toBe("foreign_country");
    });
  }
});

describe("rejected values — FR universe", () => {
  for (const value of ["France", "la France", "République française", "FRA", "fr", "FR"]) {
    it(`rejects the home country ${JSON.stringify(value)}`, () => {
      expect(hitsFor(value, "fr")[0]?.kind).toBe("home_country");
    });
  }

  for (const value of [
    "United States",
    "USA",
    "États-Unis",
    "Georgia",
    "Géorgie",
    "Jersey",
    "Puerto Rico",
    "Suisse",
    "Switzerland",
    "Belgique",
    "Espagne",
    "Allemagne",
    "US",
  ]) {
    it(`rejects the out-of-universe ${JSON.stringify(value)}`, () => {
      expect(hitsFor(value, "fr")[0]?.kind).toBe("foreign_country");
    });
  }
});

describe("whole-workspace phrasings are HOME intent, not supra-national", () => {
  // These mean "the whole of MY country", so the recovery is the home one
  // (omit and answer) rather than report-the-scope. Grouping them with
  // EMEA/APAC gave the wrong advice for the commonest phrasing of all.
  for (const value of [
    "nationwide", "Nation-wide", "countrywide", "the whole country",
    "entire country", "everywhere", "anywhere", "all regions",
  ]) {
    it(`classifies ${JSON.stringify(value)} as home_country on US`, () => {
      const hits = hitsFor(value, "us");
      expect(hits).toHaveLength(1);
      expect(hits[0].kind).toBe("home_country");
      expect(hits[0].country).toBe("United States");
    });
  }

  for (const value of ["Toute la France", "partout", "partout en France", "Échelle nationale"]) {
    it(`classifies ${JSON.stringify(value)} as home_country on FR`, () => {
      expect(hitsFor(value, "fr")[0]?.kind).toBe("home_country");
    });
  }

  it("their hint is the omit-and-answer one", () => {
    const envelope = countryLocationEnvelope(hitsFor("nationwide", "us"), "us");
    expect(envelope.hint).toMatch(/OMIT/);
  });

  it("falls back to report-the-scope when there is no home country", () => {
    // A custom backend has an unknown universe, so "everywhere" cannot be
    // claimed to mean "everything here".
    expect(hitsFor("everywhere", "custom")[0]?.kind).toBe("supranational");
  });
});

describe("rejected values — supra-national scopes", () => {
  for (const value of [
    "EU",
    "Europe",
    "European Union",
    "EMEA",
    "Worldwide",
    "Global",
    "Le monde entier",
  ]) {
    it(`rejects ${JSON.stringify(value)}`, () => {
      const hits = hitsFor(value, "us");
      expect(hits).toHaveLength(1);
      expect(hits[0].kind).toBe("supranational");
      expect(hits[0].country).toBeNull();
    });
  }
});

describe("allowed values — must never false-positive", () => {
  const usAllowed = [
    "Austin",
    "New York",
    "New York City",
    "Los Angeles",
    "Kansas City",
    "Paris",
    "Île-de-France",
    // The US state, which a rep names with the bare word.
    "Georgia",
    "Jersey",
    "Jersey City",
    // US territories — in-universe.
    "Puerto Rico",
    "Guam",
    "American Samoa",
    "Northern Mariana Islands",
    // Qualified homonyms — the documented override path.
    "Mexico City",
    "Mexico, MO",
    "China, ME",
    "Lebanon PA",
    "Panama City FL",
    "Monaco, PA",
    "Georgia, US",
    "Guadalajara",
    "Washington",
    "Bay Area",
  ];
  for (const value of usAllowed) {
    it(`allows ${JSON.stringify(value)} on the US universe`, () => {
      expect(rejects(value, "us")).toBe(false);
    });
  }

  const frAllowed = [
    "Île-de-France",
    "Paris",
    "Limoges",
    "Indre-et-Loire",
    "Val-d'Oise",
    "Corse",
    // FR overseas territories — in-universe.
    "Guadeloupe",
    "Martinique",
    "La Réunion",
    "Réunion",
    "Mayotte",
    "Guyane",
    "Nouvelle-Calédonie",
    "Polynésie française",
    "Saint-Martin",
    "Saint-Barthélemy",
    "Saint-Pierre-et-Miquelon",
    "Wallis-et-Futuna",
  ];
  for (const value of frAllowed) {
    it(`allows ${JSON.stringify(value)} on the FR universe`, () => {
      expect(rejects(value, "fr")).toBe(false);
    });
  }

  // ── The sweeps ──────────────────────────────────────────────────────────
  const US_STATES = [
    "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
    "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
    "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
    "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
    "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
    "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
    "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
    "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia",
    "Washington", "West Virginia", "Wisconsin", "Wyoming",
  ];
  const US_POSTAL = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI",
    "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN",
    "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH",
    "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
    "WV", "WI", "WY",
  ];

  it("allows every US state NAME on the US universe", () => {
    expect(US_STATES.filter((s) => rejects(s, "us"))).toEqual([]);
  });

  it("allows every US state POSTAL CODE on the US universe", () => {
    // 26 of these are also ISO alpha-2 country codes (CA, IN, LA, PA, ME, DE…).
    expect(US_POSTAL.filter((s) => rejects(s, "us"))).toEqual([]);
  });

  const FR_REGIONS = [
    "Auvergne-Rhône-Alpes", "Bourgogne-Franche-Comté", "Bretagne",
    "Centre-Val de Loire", "Corse", "Grand Est", "Hauts-de-France",
    "Île-de-France", "Normandie", "Nouvelle-Aquitaine", "Occitanie",
    "Pays de la Loire", "Provence-Alpes-Côte d'Azur",
  ];
  const FR_DEPARTEMENTS = [
    "Ain", "Aisne", "Allier", "Alpes-de-Haute-Provence", "Hautes-Alpes",
    "Alpes-Maritimes", "Ardèche", "Ardennes", "Ariège", "Aube", "Aude",
    "Aveyron", "Bouches-du-Rhône", "Calvados", "Cantal", "Charente",
    "Charente-Maritime", "Cher", "Corrèze", "Corse-du-Sud", "Haute-Corse",
    "Côte-d'Or", "Côtes-d'Armor", "Creuse", "Dordogne", "Doubs", "Drôme",
    "Eure", "Eure-et-Loir", "Finistère", "Gard", "Haute-Garonne", "Gers",
    "Gironde", "Hérault", "Ille-et-Vilaine", "Indre", "Indre-et-Loire",
    "Isère", "Jura", "Landes", "Loir-et-Cher", "Loire", "Haute-Loire",
    "Loire-Atlantique", "Loiret", "Lot", "Lot-et-Garonne", "Lozère",
    "Maine-et-Loire", "Manche", "Marne", "Haute-Marne", "Mayenne",
    "Meurthe-et-Moselle", "Meuse", "Morbihan", "Moselle", "Nièvre", "Nord",
    "Oise", "Orne", "Pas-de-Calais", "Puy-de-Dôme", "Pyrénées-Atlantiques",
    "Hautes-Pyrénées", "Pyrénées-Orientales", "Bas-Rhin", "Haut-Rhin",
    "Rhône", "Haute-Saône", "Saône-et-Loire", "Sarthe", "Savoie",
    "Haute-Savoie", "Seine-Maritime", "Seine-et-Marne", "Yvelines",
    "Deux-Sèvres", "Somme", "Tarn", "Tarn-et-Garonne", "Var", "Vaucluse",
    "Vendée", "Vienne", "Haute-Vienne", "Vosges", "Yonne",
    "Territoire de Belfort", "Essonne", "Hauts-de-Seine", "Seine-Saint-Denis",
    "Val-de-Marne", "Val-d'Oise",
  ];

  it("allows every French région on the FR universe", () => {
    expect(FR_REGIONS.filter((r) => rejects(r, "fr"))).toEqual([]);
  });

  it("allows every French département on the FR universe", () => {
    expect(FR_DEPARTEMENTS.filter((d) => rejects(d, "fr"))).toEqual([]);
  });
});

describe("input tolerance", () => {
  it("treats a bare scalar as a one-item list", () => {
    // The server does not validate inputSchema before dispatch, so a scalar
    // reaches the tool — letting it through was a real prior regression.
    expect(hitsFor("United States", "us")).toHaveLength(1);
  });

  it("ignores null, undefined, empty and non-string members", () => {
    for (const input of [null, undefined, [], [""], ["   "], [123], [{}], [["x"]], 42, {}]) {
      expect(detectCountryLocations(input, "locations", "us")).toEqual([]);
    }
  });

  it("reports EVERY offending value, not just the first", () => {
    const hits = hitsFor(["France", "Germany"], "us");
    expect(hits).toHaveLength(2);
    const envelope = countryLocationEnvelope(hits, "us");
    expect(envelope.message).toContain("France");
    expect(envelope.message).toContain("Germany");
  });

  it("leaves valid values in a mixed array untouched", () => {
    const hits = hitsFor(["France", "Berlin", "Austin"], "us");
    expect(hits.map((h) => h.value)).toEqual(["France"]);
  });

  it("names the param each value arrived on", () => {
    const hits = detectCountryLocationsIn(
      [
        { input: ["France"], param: "locations" },
        { input: "Germany", param: "exclude_locations" },
        { input: ["Spain"], param: "city" },
      ],
      "us"
    );
    expect(hits.map((h) => h.param)).toEqual([
      "locations",
      "exclude_locations",
      "city",
    ]);
    const envelope = countryLocationEnvelope(hits, "us");
    for (const param of ["locations", "exclude_locations", "city"]) {
      expect(envelope.message).toContain(param);
    }
  });
});

describe("custom region", () => {
  it("has no home country, so nothing is classified home_country", () => {
    expect(hitsFor("United States", "custom")[0]?.kind).toBe("foreign_country");
    expect(hitsFor("France", "custom")[0]?.kind).toBe("foreign_country");
  });

  it("uses the union of exemptions and omits the 'serves X only' clause", () => {
    expect(rejects("Georgia", "custom")).toBe(false);
    const envelope = countryLocationEnvelope(hitsFor("France", "custom"), "custom");
    expect(envelope.message).not.toContain("serves");
  });
});

describe("envelope shapes", () => {
  it("rejectCountryLocations throws exactly the 4-field business envelope", () => {
    let thrown: any;
    try {
      rejectCountryLocations([{ input: ["France"], param: "locations" }], "us");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
    expect(Object.keys(thrown).sort()).toEqual(["code", "error", "hint", "message"]);
    expect(thrown.error).toBe(true);
    expect(thrown.code).toBe(COUNTRY_LEVEL_LOCATION);
    // No _meta: formatErrorForLLM would append a "(region=…, endpoint=…)"
    // diagnostic for a guard that never made a request.
    expect(thrown._meta).toBeUndefined();
  });

  it("rejectCountryLocations is a no-op for clean input", () => {
    expect(() =>
      rejectCountryLocations([{ input: ["Austin", "Texas"], param: "locations" }], "us")
    ).not.toThrow();
  });

  it("countryLocationStatus carries NO error flag", () => {
    // server.ts collapses any result with `error: true` to a bare text
    // isError, dropping structuredContent and filing a Sentry event.
    const status = countryLocationStatus(hitsFor("France", "us"), "us");
    expect("error" in status).toBe(false);
    expect(status.status).toBe("country_level_location");
    expect(status.code).toBe(COUNTRY_LEVEL_LOCATION);
    expect(status.country_locations).toHaveLength(1);
  });

  it("the HOME-country hint says omit, and not to re-spell", () => {
    const envelope = countryLocationEnvelope(hitsFor("United States", "us"), "us");
    expect(envelope.hint).toMatch(/OMIT/);
    expect(envelope.hint).toMatch(/not retry with another spelling/i);
  });

  it("the FOREIGN-country hint must NOT say to drop the argument and re-run", () => {
    // The accuracy bug this pins: "leads in France" on a US workspace is
    // UNSUPPORTED, not equivalent to "all US leads". Telling the agent to drop
    // the argument and retry produces whole-workspace data presented as an
    // answer about another country — the same confidently-wrong-result class
    // the guard exists to prevent.
    const envelope = countryLocationEnvelope(hitsFor("France", "us"), "us");
    expect(envelope.hint).toMatch(/do NOT simply drop/i);
    expect(envelope.hint).not.toMatch(/\bOMIT\b/);
    // It must say what the workspace actually holds, and name the country asked for.
    expect(envelope.hint).toMatch(/United States/);
    expect(envelope.hint).toMatch(/France/);
    // The qualified-town override survives.
    expect(envelope.hint).toMatch(/qualify the value/i);
  });

  it("the SUPRA-NATIONAL hint must NOT say to drop the argument and re-run", () => {
    // "EMEA" is not answered by one country's leads either.
    const envelope = countryLocationEnvelope(hitsFor("EMEA", "fr"), "fr");
    expect(envelope.hint).toMatch(/Do NOT drop/i);
    expect(envelope.hint).not.toMatch(/\bOMIT\b/);
    expect(envelope.hint).toMatch(/France/);
  });

  it("the foreign message states the workspace scope, not a retry", () => {
    const envelope = countryLocationEnvelope(hitsFor("Germany", "us"), "us");
    expect(envelope.message).toMatch(/outside this workspace/i);
    expect(envelope.message).toMatch(/no Germany companies/i);
  });
});

describe("detectCountryLocationsInFilter", () => {
  const criterionFilter = (locations: unknown) => ({
    lens_filter: {
      items: [{ criteria: [{ type: "location_ids", is_excluded: false, locations }] }],
    },
    locations: { results: [], parents: [] },
  });

  it("finds a country name in a location_ids criterion", () => {
    const hits = detectCountryLocationsInFilter(criterionFilter(["France"]), "fr");
    expect(hits).toHaveLength(1);
    expect(hits[0].param).toContain("criteria[].locations");
  });

  it("finds a country in the echoed resolved-areas block", () => {
    const hits = detectCountryLocationsInFilter(
      {
        lens_filter: { items: [{ criteria: [{ type: "location_ids", locations: ["27925"] }] }] },
        locations: { results: [{ id: "1", name: "France", level: 2 }], parents: [] },
      },
      "fr"
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].param).toContain("locations.results");
  });

  it("passes a clean filter through", () => {
    const hits = detectCountryLocationsInFilter(
      {
        lens_filter: { items: [{ criteria: [{ type: "location_ids", locations: ["416102"] }] }] },
        locations: { results: [{ id: "416102", name: "Île-de-France", level: 5 }], parents: [] },
      },
      "fr"
    );
    expect(hits).toEqual([]);
  });

  it("tolerates malformed filters without throwing", () => {
    for (const filter of [
      null,
      undefined,
      {},
      42,
      "nope",
      { lens_filter: {} },
      { lens_filter: { items: "no" } },
      { lens_filter: { items: [null] } },
      { lens_filter: { items: [{ criteria: "no" }] } },
      { lens_filter: { items: [{ criteria: [null] }] } },
      { locations: { results: "no" } },
      { locations: { results: [null, { name: 42 }] } },
    ]) {
      expect(() => detectCountryLocationsInFilter(filter, "us")).not.toThrow();
      expect(detectCountryLocationsInFilter(filter, "us")).toEqual([]);
    }
  });

  it("ignores criteria of other types", () => {
    const hits = detectCountryLocationsInFilter(
      { lens_filter: { items: [{ criteria: [{ type: "keywords", locations: ["France"] }] }] } },
      "fr"
    );
    expect(hits).toEqual([]);
  });
});
