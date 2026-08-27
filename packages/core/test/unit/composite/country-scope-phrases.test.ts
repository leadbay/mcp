/**
 * Scope PHRASES, custom-region reachability, and the tour-specific recovery
 * (review follow-up, product#3951).
 *
 * Three defects, all of them mine, all invisible to typecheck and to a green
 * suite because they lived in classification and in guidance text:
 *
 *  1. The guard matched keys EXACTLY, so the canonical phrasings a user actually
 *     types — "whole US", "the whole US", "all of France", "across the United
 *     States" — matched nothing and sailed through to /geo/search and the
 *     same-named-town fence.
 *  2. Worse in the other direction: "partout en France" and "toute la France"
 *     sat in WHOLE_WORKSPACE_LABELS, so on a US workspace they were classified
 *     as the HOME country and the guidance recommended answering with US leads.
 *     A phrase that NAMES a country must be judged by that country.
 *  3. `createClient({baseUrl})` defaulted region to "us", so the
 *     country_indeterminate branch added for custom backends was unreachable in
 *     the documented LEADBAY_BASE_URL configuration.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { createClient, LeadbayClient } from "../../../src/client.js";
import { detectCountryLocations } from "../../../src/composite/_country-guard.js";
import { embeddedCountryKey, countryKey } from "../../../src/composite/_country-names.js";
import { tourPlan } from "../../../src/composite/tour-plan.js";

type Region = "us" | "fr" | "custom";
const kindOf = (value: string, region: Region) =>
  detectCountryLocations(value, "city", region)[0]?.kind;
const countryOf = (value: string, region: Region) =>
  detectCountryLocations(value, "city", region)[0]?.country;
const allowed = (value: string, region: Region) =>
  detectCountryLocations(value, "city", region).length === 0;

beforeEach(() => resetHttpMock());

describe("embeddedCountryKey", () => {
  it("peels generic scope wrappers down to the country", () => {
    for (const [phrase, expected] of [
      ["whole us", "us"],
      ["all of france", "france"],
      ["across the united states", "united states"],
      ["us wide", "us"],
      ["partout en france", "france"],
      ["toute la france", "france"],
      ["entire germany", "germany"],
      ["throughout spain", "spain"],
    ] as const) {
      expect(embeddedCountryKey(phrase), phrase).toBe(expected);
    }
  });

  it("finds nothing in ordinary place names", () => {
    // The wrappers only ever fire when a COUNTRY is left behind, so real places
    // that happen to start with a scope word are untouched.
    for (const phrase of [
      "whole foods",
      "across the bay",
      "ile de france",
      "all regions",
      "nationwide",
      "partout",
      "austin",
      "val d oise",
    ]) {
      expect(embeddedCountryKey(phrase), phrase).toBeUndefined();
    }
  });

  it("is a no-op for a bare country key", () => {
    expect(embeddedCountryKey(countryKey("France"))).toBe("france");
  });
});

describe("whole-country phrasings naming THIS workspace", () => {
  const usPhrases = [
    "whole US",
    "the whole US",
    "all of the US",
    "across the United States",
    "US-wide",
    "all of the United States",
    "throughout the US",
  ];
  for (const value of usPhrases) {
    it(`${JSON.stringify(value)} is home intent on a US workspace`, () => {
      // Previously matched nothing at all and reached /geo/search.
      expect(kindOf(value, "us")).toBe("home_country");
      expect(countryOf(value, "us")).toBe("United States");
    });
  }

  it("generic phrasings with no country named still mean this workspace", () => {
    for (const value of ["nationwide", "everywhere", "all regions", "entire country"]) {
      expect(kindOf(value, "us"), value).toBe("home_country");
    }
  });
});

describe("whole-country phrasings naming ANOTHER country", () => {
  // The accuracy bug: these name France, so on a US workspace they are FOREIGN.
  // Classifying them as home intent told the agent to answer with US leads.
  for (const value of ["all of France", "partout en France", "toute la France", "throughout France"]) {
    it(`${JSON.stringify(value)} is FOREIGN on a US workspace`, () => {
      expect(kindOf(value, "us")).toBe("foreign_country");
      expect(countryOf(value, "us")).toBe("France");
    });

    it(`${JSON.stringify(value)} is HOME on an FR workspace`, () => {
      expect(kindOf(value, "fr")).toBe("home_country");
    });
  }

  it("mirrors for a US phrase on an FR workspace", () => {
    expect(kindOf("whole US", "fr")).toBe("foreign_country");
    expect(countryOf("whole US", "fr")).toBe("United States");
  });
});

describe("scope phrases do not create false positives", () => {
  for (const value of [
    "Île-de-France",
    "all of Georgia", // the US state, wrapped in a scope word
    "Whole Foods",
    "across the Bay",
    "Austin",
    "Val-d'Oise",
    "New York",
  ]) {
    it(`allows ${JSON.stringify(value)} on the US workspace`, () => {
      expect(allowed(value, "us")).toBe(true);
    });
  }

  it("keeps the state exemption working through a wrapper", () => {
    // "Georgia" is exempt on US as the state; the wrapper must not turn it into
    // the country.
    expect(allowed("all of Georgia", "us")).toBe(true);
    // …and on FR, where Georgia can only be the country, it still rejects.
    expect(kindOf("Georgia", "fr")).toBe("foreign_country");
  });
});

describe("createClient — a custom baseUrl must not inherit the US region", () => {
  it("reports region 'custom' for a staging URL with no region pinned", () => {
    // This is the documented LEADBAY_BASE_URL path (bin.ts honours a baseUrl
    // "exactly", passing no region). Defaulting to "us" made every custom
    // endpoint look like a US tenant.
    const client = createClient({ token: "u.t", baseUrl: "https://api-staging.leadbay.app" });
    expect(client.region).toBe("custom");
  });

  it("still derives us / fr from the known regional URLs", () => {
    expect(createClient({ token: "u.t", baseUrl: "https://api-us.leadbay.app" }).region).toBe("us");
    expect(createClient({ token: "u.t", baseUrl: "https://api-fr.leadbay.app" }).region).toBe("fr");
  });

  it("still honours an explicitly pinned region over the URL", () => {
    const client = createClient({
      token: "u.t",
      baseUrl: "https://api-staging.leadbay.app",
      region: "fr",
    });
    expect(client.region).toBe("fr");
  });

  it("still defaults to us when neither baseUrl nor region is given", () => {
    expect(createClient({ token: "u.t" }).region).toBe("us");
  });

  it("makes the indeterminate verdict reachable on a custom backend", () => {
    // The whole point: a French staging backend must NOT be told it holds no
    // French leads.
    const client = createClient({ token: "u.t", baseUrl: "https://api-staging.leadbay.app" });
    expect(detectCountryLocations("France", "city", client.region)[0]?.kind).toBe(
      "country_indeterminate"
    );
  });
});

describe("leadbay_tour_plan — the recovery is tour-specific", () => {
  const frClient = () => new LeadbayClient("https://api-fr.leadbay.app", "u.t", "fr");

  it("does NOT tell the agent to omit the city", async () => {
    // The shared home-country hint says "omit the geo argument and the result
    // covers the whole workspace". For a tour that is wrong twice over:
    // tour_plan accepts no city and then returns arbitrary nationwide leads as
    // an itinerary, and the prompt contract requires asking for a city.
    mockHttp([]);
    const result: any = await tourPlan.execute(frClient(), { city: "France" });
    expect(result.status).toBe("country_level_location");
    // It may SAY "there is nothing to omit here"; what it must never do is
    // instruct omission the way the generic home-country hint does.
    expect(result.hint).not.toMatch(/OMIT `?city/i);
    expect(result.hint).not.toMatch(/covers the whole workspace/i);
    expect(result.hint).toMatch(/nothing to omit/i);
    expect(result.hint).toMatch(/do NOT re-call without `city`/i);
    expect(result.hint).toMatch(/which city or region/i);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("keeps the shared code, message and country_locations", async () => {
    // Only the recovery is overridden — the diagnosis stays single-sourced.
    mockHttp([]);
    const result: any = await tourPlan.execute(frClient(), { city: "France" });
    expect(result.code).toBe("COUNTRY_LEVEL_LOCATION");
    expect(result.message).toContain("France");
    expect(result.country_locations).toHaveLength(1);
  });

  it("catches a wrapped phrase too", async () => {
    mockHttp([]);
    const result: any = await tourPlan.execute(frClient(), { city: "toute la France" });
    expect(result.status).toBe("country_level_location");
    expect(getHttpRequests()).toHaveLength(0);
  });
});
