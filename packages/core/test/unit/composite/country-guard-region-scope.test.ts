/**
 * The country-guard exemptions are per-universe, not process-wide.
 *
 * `Georgia` has to survive the guard on a US account — it is a state there,
 * and a common one to fence on. It must NOT survive on a France account,
 * where it can only mean the country and would hit the same arbitrary-locality
 * fencing the guard exists to prevent. The French overseas regions are the
 * exact mirror: legitimate fences on a France account, foreign countries on a
 * US one.
 *
 * A single global exemption set gave each of them a free pass on the wrong
 * side of that line.
 */

import { describe, it, expect } from "vitest";
import { rejectCountryLocations } from "../../../src/composite/_mcp-job-helpers.js";

function rejects(value: unknown, region?: string): boolean {
  try {
    rejectCountryLocations(value, region);
    return false;
  } catch (e) {
    expect((e as { code?: string }).code).toBe("COUNTRY_LEVEL_LOCATION");
    return true;
  }
}

describe("rejectCountryLocations — region-scoped exemptions", () => {
  it("Georgia is a state on US and a country on FR", () => {
    expect(rejects(["Georgia"], "us")).toBe(false);
    expect(rejects(["Georgia"], "fr")).toBe(true);
    expect(rejects(["Géorgie"], "fr")).toBe(true);
  });

  it("the French overseas regions are fences on FR and countries on US", () => {
    for (const v of ["Martinique", "Guadeloupe", "La Réunion", "Mayotte"]) {
      expect(rejects([v], "fr"), `${v} on fr`).toBe(false);
      expect(rejects([v], "us"), `${v} on us`).toBe(true);
    }
  });

  it("an unknown region falls back to permissive — never a false rejection", () => {
    // Without a region we cannot tell a state fence from a foreign country.
    // Wrongly rejecting a correct search is the louder failure, so the union
    // of exemptions applies.
    expect(rejects(["Georgia"], undefined)).toBe(false);
    expect(rejects(["Martinique"], "")).toBe(false);
    expect(rejects(["Georgia"], "zz")).toBe(false);
  });

  it("region casing and padding do not change the verdict", () => {
    expect(rejects(["Georgia"], " US ")).toBe(false);
    expect(rejects(["Georgia"], "FR")).toBe(true);
  });

  it("real countries are still rejected in every region", () => {
    for (const region of ["us", "fr", undefined]) {
      for (const v of ["Canada", "Germany", "United Kingdom", "France"]) {
        expect(rejects([v], region), `${v} on ${region}`).toBe(true);
      }
    }
  });

  it("ordinary cities and states survive in every region", () => {
    for (const region of ["us", "fr", undefined]) {
      for (const v of ["Austin", "Texas", "Lyon", "Nouvelle-Aquitaine"]) {
        expect(rejects([v], region), `${v} on ${region}`).toBe(false);
      }
    }
  });
});
