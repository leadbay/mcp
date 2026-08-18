/**
 * Two more ways an agent could still be handed an unusable answer
 * (product#3951).
 *
 * 1. WRAPPED SUPRA-NATIONAL SCOPES. "EU-wide", "all of Europe", "across EMEA"
 *    are what a rep types, and only the bare labels were ever checked. The
 *    scope-wrapper strip existed, but it was applied while looking for a
 *    COUNTRY and nowhere else — so these produced no hit at all, reached
 *    /geo/search, and got fenced to a same-named town exactly as if the guard
 *    were absent. Worse than the un-guarded state, because the rule promises
 *    supra-national scopes get their own recovery.
 *
 * 2. CONTRADICTORY RECOVERIES. The per-kind hints are correct alone and
 *    mutually exclusive together — only the home country licenses an
 *    unfiltered re-run. `["France", "Canada"]` on FR concatenated "OMIT
 *    locations entirely" with "Do NOT simply drop locations and re-run",
 *    leaving no safe move. These tests read the joined hint STRING, because a
 *    contradiction is a property of the whole string and nothing downstream
 *    checks it.
 */

import { describe, it, expect } from "vitest";

import {
  detectCountryLocations,
  detectCountryLocationsIn,
  countryLocationEnvelope,
} from "../../../src/composite/_country-guard.js";

type Region = "us" | "fr" | "custom";

const hits = (input: unknown, region: Region, param = "locations", axis: "include" | "exclude" = "include") =>
  detectCountryLocations(input, param, region, axis);

const hint = (input: unknown, region: Region, param = "locations", axis: "include" | "exclude" = "include") =>
  countryLocationEnvelope(hits(input, region, param, axis), region).hint;

describe("wrapped supra-national scopes are caught before /geo/search", () => {
  const WRAPPED = [
    "EU-wide",
    "EU wide",
    "all of Europe",
    "the whole of Europe",
    "across EMEA",
    "throughout EMEA",
    "APAC-wide",
    "all of Asia",
    "anywhere in Europe",
    "entire EU",
  ] as const;

  it.each(WRAPPED)("%s classifies as supranational", (value) => {
    const found = hits(value, "fr", "city");
    expect(
      found,
      `"${value}" produced no hit, so the caller sends it to /geo/search and gets fenced to a same-named town`
    ).toHaveLength(1);
    expect(found[0].kind).toBe("supranational");
  });

  it("the bare labels still work, on both backends", () => {
    for (const region of ["us", "fr"] as const) {
      for (const value of ["EU", "Europe", "EMEA", "Worldwide", "LATAM"]) {
        expect(hits(value, region, "city")[0]?.kind, `${value} on ${region}`).toBe(
          "supranational"
        );
      }
    }
  });

  it("a named country inside a wrapper still beats the supra-national reading", () => {
    // "all of France" is France — home on FR, FOREIGN on US. Reading it as a
    // region would answer a France question with US leads, which is the failure
    // the kinds exist to separate.
    expect(hits("all of France", "fr", "city")[0].kind).toBe("home_country");
    expect(hits("all of France", "us", "city")[0].kind).toBe("foreign_country");
  });

  it("generic whole-workspace phrasings keep their own verdict", () => {
    // These name no country and no region: they mean THIS workspace, which is
    // the one case where omitting the filter is the whole answer.
    for (const value of ["the whole country", "nationwide", "everywhere"]) {
      expect(hits(value, "fr", "city")[0].kind, value).toBe("home_country");
    }
  });

  it("ordinary place names are still invisible to the wrapper strip", () => {
    for (const value of ["Whole Foods", "across the Bay", "Bay Area", "Asia Center"]) {
      expect(hits(value, "us", "locations"), value).toEqual([]);
    }
  });
});

describe("one argument, several kinds — one reconciled recovery", () => {
  it("home + foreign does not tell the agent both to omit and not to omit", () => {
    const text = hint(["France", "Canada"], "fr");
    // The two per-kind instructions, verbatim. Neither may survive.
    expect(text, "the bare OMIT instruction is unsafe here").not.toMatch(
      /Whole-workspace intent = OMIT locations entirely/
    );
    expect(text, "and so is the bare do-not-drop instruction").not.toMatch(
      /Do NOT simply drop locations and re-run/
    );
    // What replaces them: one pass over the argument, then what may be claimed.
    expect(text).toMatch(/Remove every one of "France", "Canada" from locations/);
    expect(text, "the home half IS answerable — say exactly how far it goes").toMatch(
      /answers the France part of the ask and nothing else/i
    );
    expect(text, "the foreign half is not").toMatch(/says nothing about Canada/i);
  });

  it("names each kind once, however many values it has", () => {
    const text = hint(["France", "Canada", "Germany"], "fr");
    expect(text).toMatch(/holds no Canada, Germany companies/);
    expect((text.match(/Remove every one of/g) ?? []).length).toBe(1);
  });

  it("keeps a valid sibling instead of emptying the argument", () => {
    const text = hint(["Paris", "France", "Canada"], "fr");
    expect(text).toMatch(/Do NOT omit locations/);
    expect(text).toMatch(/Remove ONLY "France", "Canada"/);
    expect(text).toMatch(/covers "Paris"/);
    expect(text).not.toMatch(/Omitting locations entirely/);
  });

  it("supranational + foreign licenses no unfiltered re-run at all", () => {
    const text = hint(["EU", "Canada"], "fr");
    expect(
      text,
      "with no home-country value there is nothing an unfiltered result answers"
    ).toMatch(/Do NOT re-run with locations omitted/);
    expect(text).toMatch(/"EU" is a supra-national scope/);
    expect(text).toMatch(/says nothing about Canada/i);
  });

  it("on the exclude axis it says why each exclusion fails, and applies none", () => {
    const text = hint(["France", "Canada"], "fr", "exclude_locations", "exclude");
    expect(text).toMatch(/excluding France would empty the ENTIRE workspace/);
    expect(text).toMatch(/excluding Canada removes nothing/);
    expect(
      text,
      "the agent must not report a carve-out that never happened"
    ).toMatch(/Do NOT present the result as though any of these exclusions had been applied/);
  });

  it("an exclusion beside a valid one keeps the valid one", () => {
    const text = hint(["Paris", "France", "Canada"], "fr", "exclude_locations", "exclude");
    expect(text).toMatch(/Remove ONLY "France", "Canada"/);
    expect(text).toMatch(/other exclusions still apply/i);
  });

  it("a custom backend claims nothing while still reconciling", () => {
    const text = hint(["France", "EMEA"], "custom");
    expect(text).toMatch(/claim nothing about whether France is inside it/);
    expect(text).toMatch(/"EMEA" is a supra-national scope/);
  });
});

describe("what reconciliation must NOT change", () => {
  it("a single kind on one argument keeps its own per-kind text", () => {
    expect(hint(["France"], "fr")).toMatch(/Whole-workspace intent = OMIT locations entirely/);
    expect(hint(["Canada"], "fr")).toMatch(/Do NOT simply drop locations and re-run/);
  });

  it("several foreign countries each get named — no value is silently dropped", () => {
    const text = hint(["Canada", "Germany"], "fr");
    expect(text).toMatch(/no Canada leads/);
    expect(text).toMatch(/no Germany leads/);
  });

  it("two DIFFERENT arguments still get their own instruction", () => {
    // Not a contradiction: locations and exclude_locations are separate asks,
    // and collapsing them would lose one of the two fixes.
    const found = detectCountryLocationsIn(
      [
        { input: ["Canada"], param: "locations" },
        { input: ["France"], param: "exclude_locations", axis: "exclude" },
      ],
      "fr"
    );
    const text = countryLocationEnvelope(found, "fr").hint;
    expect(text).toMatch(/Do NOT simply drop locations and re-run/);
    expect(text).toMatch(/Excluding France excludes this ENTIRE workspace/);
  });

  it("identical hints across arguments are still emitted once", () => {
    const found = detectCountryLocationsIn(
      [
        { input: ["Canada"], param: "locations" },
        { input: ["Canada"], param: "locations" },
      ],
      "fr"
    );
    const text = countryLocationEnvelope(found, "fr").hint;
    expect((text.match(/Do NOT simply drop locations and re-run/g) ?? []).length).toBe(1);
  });
});
