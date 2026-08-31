/**
 * The `set_filter` ingress is guarded too (review follow-up, product#3951).
 *
 * The first pass guarded only `city` / `city_id`, but both Monitor composites
 * also accept geography as a raw `location_ids` criterion inside `set_filter` —
 * a documented path that never touches those arguments.
 *
 * Leaving it open was worse than the bug it was meant to fix. The criterion
 * reaches `POST /monitor/filter`, and BOTH composites deliberately catch a
 * failed POST and carry on reading the Monitor view ("Fall through — still try
 * to read the Monitor view with whatever filter is currently stored"). So a
 * country in `set_filter` produced a confident, plausible cohort drawn from the
 * PREVIOUSLY persisted filter, presented as though it were the requested one —
 * a silently wrong answer, which is the whole failure class this guard exists to
 * prevent. On the success path it is just as bad: the country-fenced criterion
 * gets persisted server-side and survives the session.
 *
 * Every assertion pairs the named status with zero HTTP, which is what proves
 * nothing was persisted and no stale read happened.
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
import { scanPortfolioSignals } from "../../../src/composite/scan-portfolio-signals.js";
import {
  detectCountryLocationsInSetFilter,
} from "../../../src/composite/_country-guard.js";

const FR_BASE = "https://api-fr.leadbay.app";
const US_BASE = "https://api-us.leadbay.app";
const frClient = () => new LeadbayClient(FR_BASE, "u.test-token", "fr");
const usClient = () => new LeadbayClient(US_BASE, "u.test-token", "us");

/** A Monitor set_filter expressing geography the documented way. */
const geoFilter = (locations: unknown) => ({
  criteria: [{ type: "location_ids", is_excluded: false, locations }],
});

beforeEach(() => resetHttpMock());

describe("detectCountryLocationsInSetFilter", () => {
  it("finds a country in a location_ids criterion and names the path", () => {
    const hits = detectCountryLocationsInSetFilter(geoFilter(["France"]), "set_filter", "fr");
    expect(hits).toHaveLength(1);
    expect(hits[0].param).toBe("set_filter.criteria[].locations");
    expect(hits[0].kind).toBe("home_country");
  });

  it("ignores criteria that carry no geography", () => {
    const filter = {
      criteria: [
        { type: "keywords", keywords: ["France"] }, // a text match, not a geo filter
        { type: "liked" },
        { type: "size", sizes: [{ min: 10, max: 50 }] },
      ],
    };
    expect(detectCountryLocationsInSetFilter(filter, "set_filter", "fr")).toEqual([]);
  });

  it("passes a sub-country criterion through", () => {
    const hits = detectCountryLocationsInSetFilter(
      geoFilter(["Île-de-France", "416102"]),
      "set_filter",
      "fr"
    );
    expect(hits).toEqual([]);
  });

  it("tolerates malformed input without throwing", () => {
    for (const filter of [
      null, undefined, {}, 42, "nope",
      { criteria: "no" },
      { criteria: [null] },
      { criteria: [{ type: "location_ids" }] }, // no locations key
      { criteria: [{ type: "location_ids", locations: "France" }] }, // scalar
    ]) {
      expect(() => detectCountryLocationsInSetFilter(filter, "set_filter", "fr")).not.toThrow();
    }
    // …but a SCALAR country still counts: the server does not validate the
    // schema before dispatch, so this shape really does arrive.
    expect(
      detectCountryLocationsInSetFilter(
        { criteria: [{ type: "location_ids", locations: "France" }] },
        "set_filter",
        "fr"
      )
    ).toHaveLength(1);
  });
});

describe("leadbay_pull_followups — set_filter ingress", () => {
  it("refuses a country in set_filter without persisting a filter", async () => {
    mockHttp([]);
    const result: any = await pullFollowups.execute(frClient(), {
      set_filter: geoFilter(["France"]) as any,
    });
    expect(result.status).toBe("country_level_location");
    expect(result.code).toBe("COUNTRY_LEVEL_LOCATION");
    expect(result.country_locations[0].param).toBe("set_filter.criteria[].locations");
    // Zero requests is the load-bearing assertion: no POST /monitor/filter, so
    // nothing was persisted — AND no GET /monitor, so no stale-filter cohort was
    // read and handed back as though it answered the request.
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("returns empty leads rather than a plausible stale page", async () => {
    mockHttp([]);
    const result: any = await pullFollowups.execute(frClient(), {
      set_filter: geoFilter(["France"]) as any,
    });
    expect(result.leads).toEqual([]);
    expect(result.active_filters).toBeNull();
  });

  it("catches a country alongside other legitimate criteria", async () => {
    mockHttp([]);
    const result: any = await pullFollowups.execute(usClient(), {
      set_filter: {
        criteria: [
          { type: "last_action_date", last_days: 30 },
          { type: "location_ids", is_excluded: false, locations: ["United States"] },
        ],
      } as any,
    });
    expect(result.status).toBe("country_level_location");
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("reports city AND set_filter offenders in one envelope", async () => {
    mockHttp([]);
    const result: any = await pullFollowups.execute(usClient(), {
      city: "Germany",
      set_filter: geoFilter(["Canada"]) as any,
    });
    expect(result.country_locations.map((h: any) => h.param)).toEqual([
      "city",
      "set_filter.criteria[].locations",
    ]);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("still applies a legitimate sub-country set_filter", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/monitor/filter", status: 200, body: {} },
      { method: "GET", path: /\/1\.6\/monitor\/filter/, status: 200, body: { criteria: [] } },
      { method: "GET", path: /\/1\.6\/monitor\?/, status: 200, body: { items: [], pagination: null } },
      { method: "GET", path: /\/1\.6\/users\/me/, status: 200, body: {
        id: "u-1", email: "u@example.com", organization: { id: "org-1", name: "Acme" }, language: "en",
      } },
    ]);
    const result: any = await pullFollowups.execute(frClient(), {
      set_filter: geoFilter(["416102"]) as any,
    });
    expect(result.status).not.toBe("country_level_location");
    // It reached the store-then-apply POST, which is the point.
    expect(
      getHttpRequests().some((r) => r.method === "POST" && r.path.includes("/monitor/filter"))
    ).toBe(true);
  });
});

describe("leadbay_followups_map — inherits the set_filter guard", () => {
  it("refuses a country in set_filter through the inherited execute", async () => {
    mockHttp([]);
    const result: any = await followupsMap.execute(frClient(), {
      set_filter: geoFilter(["France"]) as any,
    });
    expect(result.status).toBe("country_level_location");
    expect(getHttpRequests()).toHaveLength(0);
  });
});

describe("leadbay_scan_portfolio_signals — set_filter ingress", () => {
  it("refuses a country in set_filter before scanning or persisting", async () => {
    mockHttp([]);
    const result: any = await scanPortfolioSignals.execute(frClient(), {
      query: "M&A",
      set_filter: geoFilter(["France"]) as any,
    });
    expect(result.status).toBe("country_level_location");
    expect(result.country_locations[0].param).toBe("set_filter.criteria[].locations");
    expect(result.matched).toEqual([]);
    expect(result.scanned_count).toBe(0);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("IGNORES set_filter when explicit leadIds are given", async () => {
    // Same divergence as `city`: the schema documents set_filter as ignored on
    // the leadIds path, so failing on it there would be a false alarm.
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
      set_filter: geoFilter(["France"]) as any,
      leadIds: ["lead-1"],
      max_leads: 1,
    });
    expect(result.status).not.toBe("country_level_location");
    expect(getHttpRequests().length).toBeGreaterThan(0);
  });
});
