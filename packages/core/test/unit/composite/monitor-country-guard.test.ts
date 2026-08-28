/**
 * The Monitor / `city` family refuses country-level locations before any I/O
 * (product#3951).
 *
 * This is the family where the failure was actually observed: in the
 * 2026-08-02 acceptance eval an FR session passed a country label, the
 * resolver trigram-matched the commune of Francs, and six search variants were
 * burned inside that invisible fence before the user got a confident wrong
 * diagnosis.
 *
 * Four tools, three shapes of coverage:
 *  - pull_followups owns the guard;
 *  - followups_map inherits `pullFollowups.execute` VERBATIM, so its test is
 *    the only thing keeping that free ride honest if the wiring ever changes;
 *  - tour_plan needs its OWN guard because it fans out to pull_leads in
 *    parallel — delegating alone would still spend that request;
 *  - scan_portfolio_signals guards only when it is actually scoping by city.
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
import { pullFollowups } from "../../../src/composite/pull-followups.js";
import { followupsMap } from "../../../src/composite/followups-map.js";
import { tourPlan } from "../../../src/composite/tour-plan.js";
import { scanPortfolioSignals } from "../../../src/composite/scan-portfolio-signals.js";

const US_BASE = "https://api-us.leadbay.app";
const FR_BASE = "https://api-fr.leadbay.app";
const usClient = () => new LeadbayClient(US_BASE, "u.test-token", "us");
const frClient = () => new LeadbayClient(FR_BASE, "u.test-token", "fr");

beforeEach(() => resetHttpMock());

describe("leadbay_pull_followups — country guard", () => {
  it("refuses a country in `city` without persisting a filter", async () => {
    mockHttp([]);
    const result: any = await pullFollowups.execute(frClient(), { city: "France" });
    expect(result.status).toBe("country_level_location");
    expect(result.code).toBe("COUNTRY_LEVEL_LOCATION");
    expect(result.country_locations[0].param).toBe("city");
    // The store-then-apply mechanism POSTs /monitor/filter server-side, so a
    // guard that ran too late would leave a poisoned persisted filter behind.
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("returns a schema-valid empty envelope", async () => {
    mockHttp([]);
    const result: any = await pullFollowups.execute(frClient(), { city: "France" });
    // outputSchema requires `leads`; the agent must not see a malformed result.
    expect(result.leads).toEqual([]);
    expect(result.active_filters).toBeNull();
    expect(result.pagination).toBeNull();
    expect(result.total_excluded_by_pushback).toBe(0);
    expect(result._meta.region).toBe("fr");
  });

  it("carries no `error` flag, so the structured detail survives", async () => {
    // server.ts collapses any result with error:true to a bare text isError,
    // dropping country_locations and filing a Sentry event.
    mockHttp([]);
    const result: any = await pullFollowups.execute(frClient(), { city: "France" });
    expect("error" in result).toBe(false);
  });

  it("refuses a country routed through `city_id`", async () => {
    mockHttp([]);
    const result: any = await pullFollowups.execute(usClient(), {
      city_id: "United States",
    });
    expect(result.status).toBe("country_level_location");
    expect(result.country_locations[0].param).toBe("city_id");
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("refuses a supra-national scope", async () => {
    mockHttp([]);
    const result: any = await pullFollowups.execute(usClient(), { city: "EMEA" });
    expect(result.status).toBe("country_level_location");
    expect(result.country_locations[0].kind).toBe("supranational");
    expect(getHttpRequests()).toHaveLength(0);
  });
});

describe("leadbay_followups_map — inherits the guard", () => {
  it("refuses the same value through the inherited execute", async () => {
    // followups_map reuses pullFollowups.execute verbatim. If that wiring is
    // ever replaced with its own implementation, this test is what catches the
    // silently-unguarded copy.
    mockHttp([]);
    const result: any = await followupsMap.execute(frClient(), { city: "France" });
    expect(result.status).toBe("country_level_location");
    expect(result.code).toBe("COUNTRY_LEVEL_LOCATION");
    expect(getHttpRequests()).toHaveLength(0);
  });
});

describe("leadbay_tour_plan — country guard", () => {
  it("refuses a country before the parallel discover pull", async () => {
    // tour_plan fires pullFollowups and pullLeads with Promise.allSettled, so
    // relying on the delegate alone would still burn the pullLeads request.
    // Zero captured requests is the proof that its own guard ran first.
    mockHttp([]);
    const result: any = await tourPlan.execute(frClient(), { city: "France" });
    expect(result.status).toBe("country_level_location");
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("returns a schema-valid empty itinerary", async () => {
    mockHttp([]);
    const result: any = await tourPlan.execute(frClient(), { city: "France" });
    // outputSchema requires monitor_leads, discover_leads and map_locations.
    expect(result.monitor_leads).toEqual([]);
    expect(result.discover_leads).toEqual([]);
    expect(result.map_locations).toEqual([]);
    expect(result.map_summary.total_leads).toBe(0);
    expect(result.city).toBe("France");
  });
});

describe("leadbay_scan_portfolio_signals — country guard", () => {
  it("refuses a country when scoping by city", async () => {
    mockHttp([]);
    const result: any = await scanPortfolioSignals.execute(frClient(), {
      query: "M&A",
      city: "France",
    });
    expect(result.status).toBe("country_level_location");
    expect(result.matched).toEqual([]);
    expect(result.not_researched).toEqual([]);
    expect(result.scanned_count).toBe(0);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("IGNORES `city` when explicit leadIds are given", async () => {
    // The schema documents `city` as ignored on the leadIds path, so failing on
    // it there would be a false alarm on an argument the tool never reads.
    mockHttp([
      {
        method: "GET",
        path: /\/1\.6\/leads\/lead-1/,
        status: 200,
        body: { id: "lead-1", name: "Acme", location: null },
      },
    ]);
    const result: any = await scanPortfolioSignals.execute(frClient(), {
      query: "M&A",
      city: "France",
      leadIds: ["lead-1"],
      max_leads: 1,
    });
    expect(result.status).not.toBe("country_level_location");
    expect(getHttpRequests().length).toBeGreaterThan(0);
  });
});
