/**
 * leadbay_adjust_audience — geographic scoping (issue #3759).
 *
 * Retrofitting geo onto an existing lens: `locations` / `location_ids` /
 * `exclude_locations` resolve via /geo/search (mirroring the sector path),
 * ambiguity bails without mutating, ids pass through, and the resolved
 * location_ids criterion is written into the unwrapped {items} filter body
 * alongside (not replacing) any sector criteria.
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
import { adjustAudience } from "../../../src/composite/adjust-audience.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

const ME = {
  id: "u-1",
  email: "u@example.com",
  organization: { id: "org-1", name: "Acme" },
  admin: false,
  last_requested_lens: 4242,
  language: "en",
};
const USER_LENS = { id: 4242, name: "Mine", user_id: "u-1", is_default: false, default: false };
const SECTORS = [{ id: "1", name: "Fintech" }];
const EMPTY_FILTER = {
  lens_filter: { items: [{ criteria: [] }] },
  locations: { results: [], parents: [] },
};

const geoMatch = (q: RegExp, ...results: any[]) => ({
  method: "GET" as const,
  path: q,
  status: 200,
  body: { results, parents: [] },
});

beforeEach(() => resetHttpMock());

describe("leadbay_adjust_audience — geographic scoping", () => {
  it("free-text location resolves and is written as a location_ids criterion (unwrapped body)", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      geoMatch(/\/1\.5\/geo\/search\?q=Lyon/, { id: "999", country: "FR", level: 8, name: "Lyon", parent_ids: [] }),
      { method: "GET", path: "/1.5/lenses/4242", status: 200, body: USER_LENS },
      { method: "GET", path: "/1.5/lenses/4242/filter", status: 200, body: EMPTY_FILTER },
      { method: "POST", path: "/1.5/lenses/4242/filter", status: 200, body: {} },
    ]);

    const result: any = await adjustAudience.execute(newClient(), { locations: ["Lyon"] });
    expect(result.status).toBe("applied");

    const post = getHttpRequests().find(
      (r) => r.method === "POST" && r.path === "/1.5/lenses/4242/filter"
    );
    const body = JSON.parse(post!.body!);
    expect(body).toHaveProperty("items");
    expect(body).not.toHaveProperty("lens_filter");
    const locCrit = body.items[0].criteria.find((c: any) => c.type === "location_ids");
    expect(locCrit).toMatchObject({ type: "location_ids", is_excluded: false, locations: ["999"] });
  });

  it("ambiguous location bails without mutating the lens", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      geoMatch(
        /\/1\.5\/geo\/search\?q=Pa/,
        { id: "1", country: "FR", level: 8, name: "Pau", parent_ids: [] },
        { id: "2", country: "FR", level: 8, name: "Paris", parent_ids: [] },
        { id: "3", country: "FR", level: 8, name: "Pantin", parent_ids: [] }
      ),
    ]);

    const result: any = await adjustAudience.execute(newClient(), { locations: ["Pa"] });
    expect(result.status).toBe("ambiguous_locations");
    expect(result.location_ambiguities[0].location_text).toBe("Pa");

    const post = getHttpRequests().find(
      (r) => r.method === "POST" && r.path === "/1.5/lenses/4242/filter"
    );
    expect(post).toBeUndefined();
  });

  it("admin-area id passes through without a /geo/search call", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      { method: "GET", path: "/1.5/lenses/4242", status: 200, body: USER_LENS },
      { method: "GET", path: "/1.5/lenses/4242/filter", status: 200, body: EMPTY_FILTER },
      { method: "POST", path: "/1.5/lenses/4242/filter", status: 200, body: {} },
    ]);

    await adjustAudience.execute(newClient(), { location_ids: ["712345"] });

    const geo = getHttpRequests().find((r) => /\/1\.5\/geo\/search/.test(r.path));
    expect(geo).toBeUndefined();
    const post = getHttpRequests().find(
      (r) => r.method === "POST" && r.path === "/1.5/lenses/4242/filter"
    );
    const locCrit = JSON.parse(post!.body!).items[0].criteria.find(
      (c: any) => c.type === "location_ids"
    );
    expect(locCrit.locations).toEqual(["712345"]);
  });

  it("exclude_locations writes an is_excluded:true location criterion", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      geoMatch(/\/1\.5\/geo\/search\?q=Corsica/, { id: "888", country: "FR", level: 6, name: "Corsica", parent_ids: [] }),
      { method: "GET", path: "/1.5/lenses/4242", status: 200, body: USER_LENS },
      { method: "GET", path: "/1.5/lenses/4242/filter", status: 200, body: EMPTY_FILTER },
      { method: "POST", path: "/1.5/lenses/4242/filter", status: 200, body: {} },
    ]);

    await adjustAudience.execute(newClient(), { exclude_locations: ["Corsica"] });

    const post = getHttpRequests().find(
      (r) => r.method === "POST" && r.path === "/1.5/lenses/4242/filter"
    );
    const locCrit = JSON.parse(post!.body!).items[0].criteria.find(
      (c: any) => c.type === "location_ids"
    );
    expect(locCrit).toMatchObject({ type: "location_ids", is_excluded: true, locations: ["888"] });
  });

  it("location coexists with sectors — both criteria are written", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      { method: "GET", path: "/1.5/sectors/all?lang=en&includeInvisible=false", status: 200, body: SECTORS },
      geoMatch(/\/1\.5\/geo\/search\?q=Lyon/, { id: "999", country: "FR", level: 8, name: "Lyon", parent_ids: [] }),
      { method: "GET", path: "/1.5/lenses/4242", status: 200, body: USER_LENS },
      { method: "GET", path: "/1.5/lenses/4242/filter", status: 200, body: EMPTY_FILTER },
      { method: "POST", path: "/1.5/lenses/4242/filter", status: 200, body: {} },
    ]);

    await adjustAudience.execute(newClient(), { sectors: ["Fintech"], locations: ["Lyon"] });

    const post = getHttpRequests().find(
      (r) => r.method === "POST" && r.path === "/1.5/lenses/4242/filter"
    );
    const criteria = JSON.parse(post!.body!).items[0].criteria;
    expect(criteria.find((c: any) => c.type === "sector_ids")).toMatchObject({ sectors: ["1"] });
    expect(criteria.find((c: any) => c.type === "location_ids")).toMatchObject({ locations: ["999"] });
  });
});
