/**
 * Wrapped whole-country phrasings, and what "nationwide" means on a backend
 * whose own country we cannot name (product#3951).
 *
 * Two defects motivated this file, both found by review on the PR that added
 * the guard:
 *
 * 1. The whole-workspace labels were the ONLY one of the three vocabularies
 *    matched by exact key. `embeddedCountryKey` and `embeddedSupranationalKey`
 *    both peel scope wrappers first; this one did not. So "country-wide",
 *    "across the country" and "across the whole country" matched nothing, the
 *    guard returned no hit, and the value went on to /geo/search — landing in
 *    the same-named-town fence this module exists to prevent.
 *
 * 2. On `region: "custom"` a generic "nationwide" was classified supra-national.
 *    That is a category error with a user-visible cost: a supra-national scope
 *    is one no single backend can satisfy, so its hint FORBIDS the unfiltered
 *    read. But "nationwide" names no country, and every backend covers exactly
 *    one — the unfiltered read is precisely the right answer. Users on the
 *    documented LEADBAY_BASE_URL path were told their request had no answer.
 */
import { describe, it, expect } from "vitest";

import {
  countryLocationEnvelope,
  detectCountryLocations,
  type GuardRegion,
} from "../../../src/composite/_country-guard.js";

const hitsFor = (value: string, region: GuardRegion, axis: "include" | "exclude" = "include") =>
  detectCountryLocations(value, "city", region, axis);

/** Wrapped forms that reached /geo/search before the wrapper-aware lookup. */
const WRAPPED = [
  "country-wide",
  "country wide",
  "Country-Wide",
  "across the country",
  "across the whole country",
  "throughout the country",
  "all of the country",
  "the entire country",
];

describe("wrapped whole-country phrasings are caught", () => {
  for (const value of WRAPPED) {
    it(`${JSON.stringify(value)} is home_country on a known region`, () => {
      const hit = hitsFor(value, "us")[0];
      expect(hit?.kind).toBe("home_country");
      // The value is echoed verbatim so the agent can find it in its own call.
      expect(hit?.value).toBe(value);
    });

    it(`${JSON.stringify(value)} gets the omit-and-answer recovery`, () => {
      const envelope = countryLocationEnvelope(hitsFor(value, "us"), "us");
      expect(envelope.hint).toMatch(/OMIT/);
      expect(envelope.hint).toMatch(/Do NOT retry with another spelling/i);
    });
  }

  it("a named country inside a wrapper still wins over the generic reading", () => {
    // "all of France" must stay FOREIGN on US — the generic branch would have
    // called it "this whole workspace" and answered it with US leads.
    expect(hitsFor("all of France", "us")[0]?.kind).toBe("foreign_country");
    expect(hitsFor("across the United States", "us")[0]?.kind).toBe("home_country");
  });
});

describe("sub-country scope words are NOT whole-country", () => {
  // The bare noun "country" is in the vocabulary so the wrapper strip can reach
  // it. That must not spill onto words that merely contain or resemble it.
  for (const value of ["statewide", "citywide", "county-wide", "Country Club Hills", "Countryside"]) {
    it(`${JSON.stringify(value)} is left alone`, () => {
      expect(hitsFor(value, "us")).toHaveLength(0);
      expect(hitsFor(value, "fr")).toHaveLength(0);
    });
  }
});

describe("nationwide on a backend with no home country", () => {
  const GENERIC = ["nationwide", "everywhere", "the whole country", "across the country", "partout"];

  for (const value of GENERIC) {
    it(`${JSON.stringify(value)} is indeterminate with NO country named`, () => {
      const hit = hitsFor(value, "custom")[0];
      expect(hit?.kind).toBe("country_indeterminate");
      expect(hit?.country).toBeNull();
    });
  }

  it("the hint affirms the unfiltered read rather than forbidding it", () => {
    const envelope = countryLocationEnvelope(hitsFor("nationwide", "custom"), "custom");
    expect(envelope.hint).toMatch(/OMIT city entirely/);
    expect(envelope.hint).toMatch(/covers everything in this workspace/i);
    // The supra-national refusal is what this used to emit. It must be gone.
    expect(envelope.hint).not.toMatch(/Do NOT drop city and re-run/i);
    expect(envelope.hint).not.toMatch(/supra-national/i);
  });

  it("it withholds the country NAME, which is the only unknown", () => {
    const envelope = countryLocationEnvelope(hitsFor("nationwide", "custom"), "custom");
    expect(envelope.hint).toMatch(/do NOT name which country/i);
    expect(envelope.message).toMatch(/WHICH country the workspace covers is unknown/i);
    // No "null" leaked from the absent country into either string.
    expect(`${envelope.hint}${envelope.message}`).not.toMatch(/\bnull\b/);
  });

  it("a NAMED country on custom keeps its own hedged recovery", () => {
    // Unchanged behaviour: "France" on custom may or may not be home, so the
    // omit is offered as a condition, not an instruction.
    const envelope = countryLocationEnvelope(hitsFor("France", "custom"), "custom");
    expect(envelope.hint).toMatch(/If you meant this entire workspace/i);
    expect(envelope.hint).toMatch(/France specifically/);
  });

  it("EXCLUDING the whole workspace is still refused, not omitted", () => {
    const envelope = countryLocationEnvelope(
      hitsFor("nationwide", "custom", "exclude"),
      "custom",
      "read"
    );
    expect(envelope.hint).toMatch(/Excluding the whole workspace leaves nothing/i);
    expect(envelope.hint).not.toMatch(/OMIT/);
  });

  it("a WRITE with nothing else to scope by writes nothing", () => {
    const envelope = countryLocationEnvelope(
      hitsFor("nationwide", "custom"),
      "custom",
      "write"
    );
    expect(envelope.hint).toMatch(/Write NOTHING here/i);
  });
});
