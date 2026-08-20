/**
 * When a country-level value DOMINATES the rest of the request (product#3951).
 *
 * Four review findings, one theme: the guard was treating the country as a bad
 * value to be removed, when in several cases it is the load-bearing half of the
 * request and the "rest" only made sense as a qualifier on it.
 *
 * 1. `new_lens({sectors:["Healthcare"], locations:["Canada"]})` on US asked for
 *    CANADIAN healthcare. Dropping the country and writing the rest persisted a
 *    real US-healthcare lens nobody requested. "Healthcare" was an adjective on
 *    "Canada", not a second, independently valid request.
 * 2. `exclude: ["France","Paris"]` on FR asks for an empty result; Paris is a
 *    detail inside it. "Remove only France and re-call" silently downgraded that
 *    to a Paris-only exclusion and returned most of France as though it answered.
 * 3. A `set_filter` country criterion beside a `last_action_date` criterion was
 *    invisible to the recovery, which said "omit it and the result covers
 *    everything" while the date filter still applied.
 * 4. `pull_followups` defaults `filtered` to true, so omitting `city` still
 *    reads through the previously persisted Monitor filter.
 */
import { describe, it, expect } from "vitest";

import {
  countryLocationEnvelope,
  detectCountryLocations,
  detectCountryLocationsIn,
  detectCountryLocationsInSetFilter,
  countryLocationStatus,
} from "../../../src/composite/_country-guard.js";

describe("a foreign include stops the whole write", () => {
  const canadianHealthcare = () =>
    detectCountryLocationsIn(
      [{ input: ["Canada"], param: "locations" }],
      "us"
    );

  it("does not offer the drop-and-re-call recovery", () => {
    // otherScope=true — sectors ARE present, which is exactly the case that
    // used to license writing the remainder.
    const envelope = countryLocationEnvelope(canadianHealthcare(), "us", "write", true);
    expect(envelope.hint).toMatch(/Write NOTHING/);
    expect(envelope.hint).not.toMatch(/re-call ONCE with the rest of the request intact/);
  });

  it("says why the remainder is not a request of its own", () => {
    const envelope = countryLocationEnvelope(canadianHealthcare(), "us", "write", true);
    expect(envelope.hint).toMatch(/were qualifying/i);
    expect(envelope.hint).toMatch(/territory nobody asked about/i);
  });

  it("a supra-national include stops a write the same way", () => {
    const hits = detectCountryLocations(["EMEA"], "locations", "us");
    const envelope = countryLocationEnvelope(hits, "us", "write", true);
    expect(envelope.hint).toMatch(/Write NOTHING/);
  });

  it("but the HOME country still carries the rest through", () => {
    // The one genuinely droppable case: the value is redundant, so the other
    // criteria really are the whole request.
    const hits = detectCountryLocations(["United States"], "locations", "us");
    const envelope = countryLocationEnvelope(hits, "us", "write", true);
    expect(envelope.hint).toMatch(/re-call ONCE with the rest of the request intact/);
    expect(envelope.hint).not.toMatch(/Write NOTHING/);
  });

  it("and a READ with a foreign include is unaffected", () => {
    const envelope = countryLocationEnvelope(canadianHealthcare(), "us", "read", true);
    expect(envelope.hint).not.toMatch(/Write NOTHING/);
  });
});

describe("a mixed non-foreign EXCLUDE fails closed", () => {
  const franceAndParis = (region: "fr" | "us" = "fr") =>
    detectCountryLocations(["France", "Paris"], "exclude_locations", region, "exclude");

  it("does not authorize a narrowed re-call", () => {
    const envelope = countryLocationEnvelope(franceAndParis(), "fr");
    expect(envelope.hint).not.toMatch(/Remove ONLY/);
    expect(envelope.hint).toMatch(/Do NOT re-call with only "Paris" excluded/);
  });

  it("names the substitution that would otherwise go unnoticed", () => {
    const envelope = countryLocationEnvelope(franceAndParis(), "fr");
    expect(envelope.hint).toMatch(/much narrower question/i);
    expect(envelope.hint).toMatch(/nothing in the result would show the substitution/i);
  });

  it("a FOREIGN exclusion keeps its surgical recovery — it is a provable no-op", () => {
    const hits = detectCountryLocations(["Canada", "Paris"], "exclude_locations", "fr", "exclude");
    const envelope = countryLocationEnvelope(hits, "fr");
    expect(envelope.hint).toMatch(/Remove ONLY "Canada"/);
  });

  it("a mixed INCLUDE is unchanged — dropping the country there is correct", () => {
    const hits = detectCountryLocations(["France", "Paris"], "locations", "fr");
    const envelope = countryLocationEnvelope(hits, "fr");
    expect(envelope.hint).toMatch(/Remove ONLY "France"/);
    expect(envelope.hint).toMatch(/describe it as those places/i);
  });
});

describe("sibling criteria survive the recovery and are named", () => {
  const setFilter = {
    criteria: [
      { type: "location_ids", locations: ["France"] },
      { type: "last_action_date", last_days: 30 },
    ],
  };

  it("records the siblings on the hit", () => {
    const hits = detectCountryLocationsInSetFilter(setFilter, "set_filter", "fr");
    expect(hits).toHaveLength(1);
    expect(hits[0].siblingCriteria).toEqual(["last_action_date"]);
  });

  it("says to remove the whole criterion, not just its locations", () => {
    const hits = detectCountryLocationsInSetFilter(setFilter, "set_filter", "fr");
    const envelope = countryLocationEnvelope(hits, "fr");
    expect(envelope.hint).toMatch(/Remove the WHOLE `location_ids` criterion/);
    expect(envelope.hint).toMatch(/invalid, not neutral/);
  });

  it("forbids describing the result as covering everything", () => {
    const hits = detectCountryLocationsInSetFilter(setFilter, "set_filter", "fr");
    const envelope = countryLocationEnvelope(hits, "fr");
    expect(envelope.hint).toMatch(/`last_action_date`/);
    expect(envelope.hint).toMatch(/never as covering everything/i);
  });

  it("a lone country criterion gets no sibling note", () => {
    const hits = detectCountryLocationsInSetFilter(
      { criteria: [{ type: "location_ids", locations: ["France"] }] },
      "set_filter",
      "fr"
    );
    expect(hits[0].siblingCriteria).toBeUndefined();
    expect(countryLocationEnvelope(hits, "fr").hint).not.toMatch(/Remove the WHOLE/);
  });
});

describe("the omit caveat rides only on an omit recovery", () => {
  const CAVEAT = "PASS-FILTERED-FALSE";

  it("is appended when the recovery says OMIT", () => {
    const hits = detectCountryLocations("France", "city", "fr");
    expect(countryLocationStatus(hits, "fr", "read", false, CAVEAT).hint).toContain(CAVEAT);
  });

  it("is NOT appended to a foreign recovery, which forbids the unfiltered re-run", () => {
    const hits = detectCountryLocations("Canada", "city", "fr");
    expect(countryLocationStatus(hits, "fr", "read", false, CAVEAT).hint).not.toContain(CAVEAT);
  });

  it("is NOT appended to an exclusion recovery", () => {
    const hits = detectCountryLocations("France", "city", "fr", "exclude");
    expect(countryLocationStatus(hits, "fr", "read", false, CAVEAT).hint).not.toContain(CAVEAT);
  });

  it("is absent entirely when no caveat is passed", () => {
    const hits = detectCountryLocations("France", "city", "fr");
    expect(countryLocationStatus(hits, "fr").hint).not.toContain(CAVEAT);
  });
});
