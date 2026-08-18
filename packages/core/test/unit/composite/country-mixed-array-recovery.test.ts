/**
 * Two ways the guard could still hand back a wrong-shaped world (product#3951).
 *
 * 1. MIXED ARRAYS. `locations: ["Paris", "France"]` on the FR backend flags
 *    only "France", and every tool returns BEFORE resolving anything. So the
 *    recovery text is the only thing standing between the caller and a re-run
 *    that lost Paris: "omit `locations`" is destructive here, and widens the
 *    request it was meant to correct. The snippet's own tiebreak has always
 *    been "keep the city, drop the country" — these tests hold the runtime to
 *    it, and they read the hint STRING because that string is the whole
 *    product: nothing downstream enforces it.
 *
 * 2. "THE WHOLE OF <country>". `countryKey` renders it "whole of france", and
 *    the wrapper list stripped the shorter `whole ` first, leaving "of france"
 *    — a key matching no country. The guard then found nothing, the caller went
 *    on to /geo/search, and the same-named-town fence closed exactly as if the
 *    guard did not exist. Ordering inside a regex array is invisible at review
 *    time, so every containing/contained pair is pinned by behaviour here.
 */

import { describe, it, expect } from "vitest";

import {
  detectCountryLocations,
  countryLocationEnvelope,
} from "../../../src/composite/_country-guard.js";

const hintFor = (input: unknown, region: "us" | "fr" | "custom", param = "locations") =>
  countryLocationEnvelope(detectCountryLocations(input, param, region), region).hint;

describe("scope wrappers — 'the whole of <country>' resolves to the country", () => {
  // Each of these is a phrasing a rep actually types. The left column is what
  // the user said; the right is the classification it must reach.
  const CASES: ReadonlyArray<[string, "us" | "fr", string]> = [
    ["the whole of France", "fr", "home_country"],
    ["whole of France", "fr", "home_country"],
    ["The Whole Of France", "fr", "home_country"],
    ["the whole of France", "us", "foreign_country"],
    ["whole of the US", "us", "home_country"],
    ["whole of the United States", "us", "home_country"],
    ["whole of the US", "fr", "foreign_country"],
    // The shorter wrappers this one shadows must keep working.
    ["whole France", "fr", "home_country"],
    ["the whole US", "us", "home_country"],
    ["all of France", "fr", "home_country"],
    ["the entire US", "us", "home_country"],
    ["across the United States", "us", "home_country"],
  ];

  it.each(CASES)("%s on %s → %s", (value, region, kind) => {
    const hits = detectCountryLocations(value, "city", region);
    expect(
      hits,
      `"${value}" produced no hit on ${region}, so the caller proceeds to /geo/search and gets fenced to a same-named town — the exact failure this guard exists to prevent`
    ).toHaveLength(1);
    expect(hits[0].kind).toBe(kind);
  });

  it("still leaves ordinary place names alone", () => {
    // The wrapper strip only ever fires when what remains is a real country, so
    // these must stay invisible to the guard.
    // NOT "Isle of Man": that IS ISO 3166-1 IM, and on the FR backend it is
    // correctly foreign — the guard catching it is the feature, not a bug.
    for (const value of ["Whole Foods", "Isle of Wight", "Val-d'Oise", "Île-de-France"]) {
      expect(
        detectCountryLocations(value, "locations", "fr"),
        `${value} must not be treated as a country-level scope`
      ).toEqual([]);
    }
  });
});

describe("mixed arrays — the valid values survive the recovery", () => {
  it("records the siblings that must be kept", () => {
    const hits = detectCountryLocations(["Paris", "France"], "locations", "fr");
    expect(hits).toHaveLength(1);
    expect(hits[0].value).toBe("France");
    expect(hits[0].kept).toEqual(["Paris"]);
  });

  it("keeps every non-offending value, across several offenders", () => {
    const hits = detectCountryLocations(
      ["Paris", "Lyon", "France", "Germany"],
      "locations",
      "fr"
    );
    expect(hits.map((h) => h.value)).toEqual(["France", "Germany"]);
    // Both hits carry the same survivors: the agent removes two values and
    // keeps two, in ONE turn, rather than discovering them one at a time.
    for (const hit of hits) expect(hit.kept).toEqual(["Paris", "Lyon"]);
  });

  it("keeps a resolved numeric id, which is not classifiable but is still wanted", () => {
    const hits = detectCountryLocations(["416102", "France"], "location_ids", "fr");
    expect(hits[0].kept).toEqual(["416102"]);
  });

  it("keeps a non-string member rather than silently dropping it", () => {
    const hits = detectCountryLocations([416102, "France"], "location_ids", "fr");
    expect(hits[0].kept).toEqual(["416102"]);
  });

  it("a scalar argument has no siblings, so the OMIT recovery is unchanged", () => {
    const hits = detectCountryLocations("France", "city", "fr");
    expect(hits[0].kept).toEqual([]);
    expect(hintFor("France", "fr", "city")).toMatch(/OMIT city entirely/);
  });

  it("a lone country in an array is still a plain omit", () => {
    expect(hintFor(["France"], "fr")).toMatch(/OMIT locations entirely/);
  });
});

describe("mixed arrays — the hint says remove, never omit", () => {
  it("home country beside a city: keep the city, and do not call it workspace-wide", () => {
    const hint = hintFor(["Paris", "France"], "fr");
    expect(hint, "the destructive instruction must be gone").not.toMatch(
      /OMIT locations entirely/
    );
    expect(hint).toMatch(/Do NOT omit locations/);
    expect(hint, "it must name the value to strip").toMatch(/Remove ONLY "France"/);
    expect(hint, "it must name what survives").toContain('"Paris"');
    // The result is Paris, not the country — saying otherwise is the same
    // confidently-wrong answer in a new costume.
    expect(hint).toMatch(/NOT as the whole workspace/i);
  });

  it("foreign country beside a city: keep the city AND report the scope", () => {
    const hint = hintFor(["Paris", "Germany"], "fr");
    expect(hint).toMatch(/Remove ONLY "Germany"/);
    expect(hint).toContain('"Paris"');
    expect(hint, "the foreign case still has to say there is no Germany data").toMatch(
      /no Germany leads/i
    );
  });

  it("supra-national beside a city: keep the city, do not present it as the region", () => {
    const hint = hintFor(["Paris", "EMEA"], "fr");
    expect(hint).toMatch(/Remove ONLY "EMEA"/);
    expect(hint).toContain('"Paris"');
    expect(hint).not.toMatch(/OMIT locations entirely/);
  });

  it("custom backend beside a city: keep the city, claim nothing about the country", () => {
    const hint = hintFor(["Paris", "France"], "custom");
    expect(hint).toMatch(/Remove ONLY "France"/);
    expect(hint).toMatch(/custom-configured/i);
    expect(hint).not.toMatch(/OMIT locations entirely/);
  });

  it("excluding the home country beside a real exclusion keeps that exclusion", () => {
    // Dropping the whole argument here would ALSO stop excluding Paris, which
    // the user did ask for and which is perfectly honourable.
    const hits = detectCountryLocations(
      ["Paris", "France"],
      "exclude_locations",
      "fr",
      "exclude"
    );
    const { hint } = countryLocationEnvelope(hits, "fr");
    expect(hits[0].kept).toEqual(["Paris"]);
    expect(hint).toMatch(/Do NOT omit exclude_locations/);
    expect(hint).toMatch(/would empty the entire workspace/i);
    expect(hint, "the surviving exclusion must be said to still apply").toMatch(
      /other exclusions still apply/i
    );
  });

  it("excluding a foreign country beside a real exclusion is still a no-op, not a drop", () => {
    const hint = countryLocationEnvelope(
      detectCountryLocations(["Paris", "Germany"], "exclude_locations", "fr", "exclude"),
      "fr"
    ).hint;
    expect(hint).toMatch(/Remove ONLY "Germany"/);
    expect(hint).toContain('"Paris"');
  });
});
