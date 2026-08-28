/**
 * Scope is a property of the REQUEST, not of one argument (product#3951).
 *
 * `CountryHit.kept` only ever sees the argument its own value arrived on. So
 * `newLens({locations: ["France"], exclude_locations: ["Paris"]})` on FR
 * produced `kept: []`, and the previous `otherScope` calculation looked only at
 * sectors / sizes / base — geo fields were invisible to it. The guard therefore
 * declared the country the only scope passed and told the agent to write
 * nothing, discarding a perfectly good Paris exclusion.
 *
 * `geoScopeSurvives` counts usable values across ALL the geo arguments, and
 * `filterCarriesOtherScope` does the same inside a lens-filter payload, where
 * a location criterion naming a real place beside the country is scope too —
 * that filter is replaced wholesale, so stopping loses it.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { newLens } from "../../../src/composite/new-lens.js";
import { adjustAudience } from "../../../src/composite/adjust-audience.js";
import { updateLensFilter } from "../../../src/tools/update-lens-filter.js";
import {
  geoScopeSurvives,
  filterCarriesOtherScope,
} from "../../../src/composite/_country-guard.js";

const frClient = () => new LeadbayClient("https://api-fr.leadbay.app", "u.test-token", "fr");

beforeEach(() => resetHttpMock());

const CARRY = /re-call ONCE with the rest of the request intact/;
const STOP = /Write NOTHING/;

describe("geoScopeSurvives", () => {
  const P = (input: unknown, param = "locations") => [{ input, param }];

  it("sees a real place on a DIFFERENT argument", () => {
    expect(
      geoScopeSurvives(
        [
          { input: ["France"], param: "locations" },
          { input: ["Paris"], param: "exclude_locations" },
        ],
        "fr"
      )
    ).toBe(true);
  });

  it("reports none when every geo value is country-level", () => {
    expect(
      geoScopeSurvives(
        [
          { input: ["France"], param: "locations" },
          { input: ["Canada"], param: "exclude_locations" },
        ],
        "fr"
      )
    ).toBe(false);
  });

  it("counts a resolved numeric id — unclassifiable here, but a place all the same", () => {
    expect(geoScopeSurvives(P([416102], "location_ids"), "fr")).toBe(true);
    expect(geoScopeSurvives(P(["416102"], "location_ids"), "fr")).toBe(true);
  });

  it("ignores absent and empty arguments", () => {
    expect(geoScopeSurvives(P(undefined), "fr")).toBe(false);
    expect(geoScopeSurvives(P(null), "fr")).toBe(false);
    expect(geoScopeSurvives(P([]), "fr")).toBe(false);
    expect(geoScopeSurvives(P(["  "]), "fr")).toBe(false);
  });

  it("is region-aware: Georgia is a place on US and a country on FR", () => {
    expect(geoScopeSurvives(P(["Georgia"]), "us")).toBe(true);
    expect(geoScopeSurvives(P(["Georgia"]), "fr")).toBe(false);
  });
});

describe("the write-stop respects geography on another argument", () => {
  it("new_lens: an exclusion of a real city keeps the write alive", async () => {
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "France minus Paris",
      locations: ["France"],
      exclude_locations: ["Paris"],
      confirm: true,
    });
    expect(result.status).toBe("country_level_location");
    expect(
      result.hint,
      "stopping here throws away the Paris exclusion the user asked for"
    ).not.toMatch(STOP);
    expect(result.hint).toMatch(CARRY);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("adjust_audience: a location_id beside the country counts", async () => {
    mockHttp([]);
    const result: any = await adjustAudience.execute(frClient(), {
      locations: ["France"],
      location_ids: ["416102"],
    });
    expect(result.hint).toMatch(CARRY);
    expect(result.hint).not.toMatch(STOP);
  });

  it("but a country on EVERY geo argument still stops", async () => {
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "Nothing real",
      locations: ["France"],
      exclude_locations: ["Canada"],
      confirm: true,
    });
    expect(result.hint).toMatch(STOP);
    expect(getHttpRequests()).toHaveLength(0);
  });
});

describe("filterCarriesOtherScope sees a surviving location value", () => {
  const filterWith = (criteria: unknown[]) => ({
    lens_filter: { items: [{ criteria }] },
    locations: { results: [], parents: [] },
  });

  it("a location criterion naming a real place is scope", () => {
    expect(
      filterCarriesOtherScope(
        filterWith([{ type: "location_ids", locations: ["France", "Paris"] }]),
        "fr"
      )
    ).toBe(true);
  });

  it("a location criterion of nothing but countries is not", () => {
    expect(
      filterCarriesOtherScope(
        filterWith([{ type: "location_ids", locations: ["France"] }]),
        "fr"
      )
    ).toBe(false);
  });

  it("a second criterion naming a place counts even when the first is country-only", () => {
    expect(
      filterCarriesOtherScope(
        filterWith([
          { type: "location_ids", locations: ["France"] },
          { type: "location_ids", locations: ["416102"], is_excluded: true },
        ]),
        "fr"
      )
    ).toBe(true);
  });

  it("update_lens_filter does not discard that place", async () => {
    mockHttp([]);
    let thrown: any;
    try {
      await updateLensFilter.execute(frClient(), {
        lensId: 4242,
        filter: filterWith([
          { type: "location_ids", locations: ["France", "Paris"], is_excluded: false },
        ]) as any,
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown.code).toBe("COUNTRY_LEVEL_LOCATION");
    expect(thrown.hint).not.toMatch(STOP);
    expect(getHttpRequests()).toHaveLength(0);
  });
});
