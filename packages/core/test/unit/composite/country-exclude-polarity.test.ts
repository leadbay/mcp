/**
 * Exclusion polarity, region normalization, and the tour payload's schema
 * validity (review follow-up, product#3951).
 *
 * The polarity bug is the interesting one: every recovery in this guard was
 * written for an INCLUDE, and each one inverts when the value arrives on an
 * exclude axis.
 *
 *   exclude the HOME country    -> "omit the argument and the result covers the
 *                                   whole workspace" is the exact OPPOSITE of
 *                                   what was asked: the user wanted those
 *                                   companies gone, and omitting the exclusion
 *                                   returns every one of them.
 *   exclude a FOREIGN country   -> a harmless NO-OP (nothing here is in it), not
 *                                   an "unsupported request".
 *
 * Also covered: a known regional base URL with a trailing slash must still
 * derive its region (the guard reads client.region, so a mislabel silently
 * downgrades a real home/foreign verdict to country_indeterminate), and the
 * tour rejection payload must satisfy its own declared outputSchema.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { createClient, LeadbayClient } from "../../../src/client.js";
import {
  countryLocationEnvelope,
  detectCountryLocations,
  detectCountryLocationsIn,
  detectCountryLocationsInSetFilter,
} from "../../../src/composite/_country-guard.js";
import { newLens } from "../../../src/composite/new-lens.js";
import { tourPlan } from "../../../src/composite/tour-plan.js";

const usClient = () => new LeadbayClient("https://api-us.leadbay.app", "u.t", "us");
const frClient = () => new LeadbayClient("https://api-fr.leadbay.app", "u.t", "fr");

const excludeHint = (value: string, region: "us" | "fr" | "custom") => {
  const hits = detectCountryLocations(value, "exclude_locations", region, "exclude");
  return countryLocationEnvelope(hits, region).hint;
};
const includeHint = (value: string, region: "us" | "fr" | "custom") => {
  const hits = detectCountryLocations(value, "locations", region, "include");
  return countryLocationEnvelope(hits, region).hint;
};

beforeEach(() => resetHttpMock());

describe("axis is carried on every hit", () => {
  it("defaults to include and records exclude when asked", () => {
    expect(detectCountryLocations("France", "locations", "fr")[0].axis).toBe("include");
    expect(
      detectCountryLocations("France", "exclude_locations", "fr", "exclude")[0].axis
    ).toBe("exclude");
  });

  it("reads is_excluded off a location_ids criterion", () => {
    const excluded = detectCountryLocationsInSetFilter(
      { criteria: [{ type: "location_ids", is_excluded: true, locations: ["France"] }] },
      "set_filter",
      "fr"
    );
    expect(excluded[0].axis).toBe("exclude");

    const included = detectCountryLocationsInSetFilter(
      { criteria: [{ type: "location_ids", is_excluded: false, locations: ["France"] }] },
      "set_filter",
      "fr"
    );
    expect(included[0].axis).toBe("include");
  });

  it("treats a missing is_excluded as an include", () => {
    const hits = detectCountryLocationsInSetFilter(
      { criteria: [{ type: "location_ids", locations: ["France"] }] },
      "set_filter",
      "fr"
    );
    expect(hits[0].axis).toBe("include");
  });
});

describe("EXCLUDING the home country", () => {
  it("never tells the agent to omit the exclusion", () => {
    // Omitting it returns every French company — the reverse of the request.
    const hint = excludeHint("France", "fr");
    expect(hint).not.toMatch(/OMIT `?exclude_locations/i);
    expect(hint).not.toMatch(/covers the whole workspace/i);
  });

  it("says the exclusion would empty the workspace, and that dropping it inverts the ask", () => {
    const hint = excludeHint("France", "fr");
    expect(hint).toMatch(/entire workspace/i);
    expect(hint).toMatch(/result would be empty/i);
    expect(hint).toMatch(/reverse of what was asked/i);
  });

  it("differs from the INCLUDE recovery for the same value", () => {
    // The include recovery is legitimately "omit and answer"; the exclude one
    // must not be.
    expect(includeHint("France", "fr")).toMatch(/OMIT/);
    expect(excludeHint("France", "fr")).not.toMatch(/OMIT `?exclude_locations/i);
  });
});

describe("EXCLUDING a foreign country", () => {
  it("is reported as a no-op, not as unsupported", () => {
    const hint = excludeHint("Germany", "us");
    expect(hint).toMatch(/no-op/i);
    expect(hint).toMatch(/changes nothing|unaffected/i);
    // The include wording — "there are no Germany leads to return" — is the
    // wrong frame for an exclusion the user can simply drop.
    expect(hint).not.toMatch(/does NOT answer a question about/i);
  });

  it("still differs from the include recovery", () => {
    expect(includeHint("Germany", "us")).toMatch(/does NOT answer a question about/i);
  });
});

describe("EXCLUDING on other kinds", () => {
  it("supra-national exclusion warns that dropping it includes everything", () => {
    const hint = excludeHint("EMEA", "fr");
    expect(hint).toMatch(/cannot be excluded as an admin area/i);
    expect(hint).toMatch(/would instead include everything/i);
  });

  it("custom backend refuses to guess which way the exclusion cuts", () => {
    const hint = excludeHint("France", "custom");
    expect(hint).toMatch(/unknown/i);
    expect(hint).toMatch(/everything or nothing/i);
  });
});

describe("leadbay_new_lens — exclude_locations carries the exclude axis", () => {
  it("marks the hit as an exclusion and gives the exclusion recovery", async () => {
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "Not France",
      exclude_locations: ["France"],
      confirm: true,
    });
    expect(result.status).toBe("country_level_location");
    expect(result.country_locations[0].axis).toBe("exclude");
    expect(result.hint).not.toMatch(/OMIT `?exclude_locations/i);
    expect(result.hint).toMatch(/entire workspace/i);
  });

  it("keeps the include recovery on the include axis", async () => {
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "All France",
      locations: ["France"],
      confirm: true,
    });
    expect(result.country_locations[0].axis).toBe("include");
    expect(result.hint).toMatch(/OMIT/);
  });

  it("reports both axes distinctly in one envelope", async () => {
    mockHttp([]);
    const result: any = await newLens.execute(usClient(), {
      name: "Mixed",
      locations: ["Canada"],
      exclude_locations: ["Mexico"],
      confirm: true,
    });
    expect(result.country_locations.map((h: any) => h.axis)).toEqual([
      "include",
      "exclude",
    ]);
  });
});

describe("createClient — region survives a trailing slash", () => {
  it("derives fr from a known regional URL written with a trailing slash", () => {
    // A perfectly ordinary env-var spelling. Comparing it raw labelled the
    // tenant "custom", which downgraded the guard to country_indeterminate.
    const client = createClient({ token: "u.t", baseUrl: "https://api-fr.leadbay.app/" });
    expect(client.region).toBe("fr");
    expect(detectCountryLocations("France", "city", client.region)[0]?.kind).toBe(
      "home_country"
    );
  });

  it("derives us with a trailing slash too", () => {
    expect(createClient({ token: "u.t", baseUrl: "https://api-us.leadbay.app/" }).region).toBe("us");
  });

  it("tolerates several trailing slashes", () => {
    expect(createClient({ token: "u.t", baseUrl: "https://api-fr.leadbay.app///" }).region).toBe("fr");
  });

  it("still calls a genuinely custom endpoint custom", () => {
    expect(
      createClient({ token: "u.t", baseUrl: "https://api-staging.leadbay.app/" }).region
    ).toBe("custom");
  });

  it("setBaseUrl derives the same way", () => {
    const client = createClient({ token: "u.t" });
    client.setBaseUrl("https://api-fr.leadbay.app/");
    expect(client.region).toBe("fr");
  });
});

describe("leadbay_tour_plan — the rejection payload is schema-valid", () => {
  it("returns discover_filter_note as a STRING, never null", async () => {
    // outputSchema declares `type: "string"`, and the happy path always returns
    // one. A null here made a validating client reject the whole rejection —
    // hiding the recovery hint it exists to deliver.
    mockHttp([]);
    const result: any = await tourPlan.execute(frClient(), { city: "France" });
    expect(typeof result.discover_filter_note).toBe("string");
    expect(result.discover_filter_note.length).toBeGreaterThan(0);
  });

  it("satisfies every required output field", async () => {
    mockHttp([]);
    const result: any = await tourPlan.execute(frClient(), { city: "France" });
    for (const field of ["monitor_leads", "discover_leads", "map_locations"]) {
      expect(Array.isArray(result[field]), field).toBe(true);
    }
    expect(typeof result.map_summary.total_leads).toBe("number");
  });

  it("still refuses to advise omitting the city", async () => {
    mockHttp([]);
    const result: any = await tourPlan.execute(frClient(), { city: "France" });
    expect(result.hint).toMatch(/do NOT re-call without `city`/i);
  });
});
