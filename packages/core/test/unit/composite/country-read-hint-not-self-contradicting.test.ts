/**
 * One recovery must not tell the agent both things.
 *
 * A `set_filter` carrying a country criterion BESIDE a real one — say
 * `location_ids: ["France"]` next to `last_action_date: 30` on an FR workspace
 * — produced a hint that opened "OMIT it, then say the result covers
 * EVERYTHING" and closed, in the caveat concatenated onto it, "describe it by
 * the criteria that remain, never as covering everything". Both sentences, one
 * string. The call returns no data, so the hint IS the recovery contract, and
 * an agent that acts on the first half reports a still-date-scoped retry as
 * whole-workspace coverage — the confidently-wrong-answer class this guard
 * exists to prevent (product#3951).
 *
 * Cause: `otherScope` was consulted only for `intent: "write"`, and both read
 * call sites hardcoded `false` while computing the real value one line above to
 * pick the caveat. So the two halves of the same recovery were built from
 * different beliefs about the same request.
 */
import { describe, it, expect } from "vitest";

import {
  countryLocationEnvelope,
  detectCountryLocationsIn,
  detectCountryLocationsInSetFilter,
  setFilterCarriesOtherScope,
} from "../../../src/composite/_country-guard.js";

const COUNTRY_BESIDE_A_DATE = {
  criteria: [
    { type: "location_ids", locations: ["France"] },
    { type: "last_action_date", last_days: 30 },
  ],
};

const LONE_COUNTRY = {
  criteria: [{ type: "location_ids", locations: ["France"] }],
};

describe("a READ whose request carries scope beyond the country", () => {
  const hintFor = (filter: unknown, region: "us" | "fr") => {
    const hits = detectCountryLocationsInSetFilter(filter, "set_filter", region);
    return countryLocationEnvelope(
      hits,
      region,
      "read",
      setFilterCarriesOtherScope(filter, region)
    ).hint;
  };

  it("does not claim the result covers everything", () => {
    const hint = hintFor(COUNTRY_BESIDE_A_DATE, "fr");
    expect(hint).not.toMatch(/say the result covers everything/i);
  });

  it("says the remaining criteria still scope it", () => {
    const hint = hintFor(COUNTRY_BESIDE_A_DATE, "fr");
    expect(hint).toMatch(/NOT as covering everything/i);
    expect(hint).toMatch(/rest of the request still scopes the result/i);
  });

  it("still says to omit the geo argument — the country is the only thing wrong", () => {
    expect(hintFor(COUNTRY_BESIDE_A_DATE, "fr")).toMatch(/OMIT set_filter/);
  });

  it("a LONE country criterion keeps the plain whole-workspace wording", () => {
    // The unqualified sentence is correct here and must not be softened: with
    // nothing else in the request, omitting really does answer it exactly.
    const hint = hintFor(LONE_COUNTRY, "fr");
    expect(hint).toMatch(/say the result covers everything/i);
    expect(setFilterCarriesOtherScope(LONE_COUNTRY, "fr")).toBe(false);
  });

  it("holds for the anonymous whole-workspace case on a custom backend", () => {
    // `country_indeterminate` with no named country tracks home_country, and
    // carried the same unconditional sentence.
    const hits = detectCountryLocationsIn(
      [{ input: ["nationwide"], param: "locations" }],
      "custom"
    );
    const scoped = countryLocationEnvelope(hits, "custom", "read", true).hint;
    expect(scoped).not.toMatch(/covers everything in this workspace/i);
    expect(scoped).toMatch(/NOT as covering this whole workspace/i);

    const alone = countryLocationEnvelope(hits, "custom", "read", false).hint;
    expect(alone).toMatch(/covers everything in this workspace/i);
  });
});

describe("the two halves of the recovery agree", () => {
  it("no hint both promises and forbids whole-workspace coverage", () => {
    for (const region of ["us", "fr"] as const) {
      for (const otherScope of [true, false]) {
        const hits = detectCountryLocationsInSetFilter(
          COUNTRY_BESIDE_A_DATE,
          "set_filter",
          region
        );
        const { hint } = countryLocationEnvelope(hits, region, "read", otherScope);
        const promises = /say the result covers everything(?! in)/i.test(hint);
        const forbids = /never as covering everything|NOT as covering everything/i.test(hint);
        expect(
          promises && forbids,
          `region=${region} otherScope=${otherScope} emitted both instructions:\n${hint}`
        ).toBe(false);
      }
    }
  });
});
