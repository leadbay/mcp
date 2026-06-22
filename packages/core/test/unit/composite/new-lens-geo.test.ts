/**
 * leadbay_new_lens — geographic scoping (issue #3759).
 *
 * The Discover lens surface gained a `locations` / `exclude_locations`
 * dimension, mirroring the sector path: free text resolves via /geo/search,
 * ambiguity bails BEFORE the lens is created, ids pass through untouched, and
 * the resolved areas surface in the confirm preview. The backend accepts a
 * `location_ids` criterion in the unwrapped {items} filter body (verified live).
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

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

describe("leadbay_new_lens — geographic scoping", () => {
  it("happy path — free-text location resolves and is written as a location_ids criterion", async () => {
    mockHttp([
      // resolveLocations → /geo/search (single exact-name match resolves cleanly)
      {
        method: "GET",
        path: /\/1\.5\/geo\/search\?q=Indre-et-Loire/,
        status: 200,
        body: {
          results: [
            { id: "477", country: "FR", level: 6, name: "Indre-et-Loire", parent_ids: ["246", "477"] },
          ],
          parents: [],
        },
      },
      { method: "POST", path: "/1.5/lenses", status: 200, body: { id: 555, name: "Touraine", user_id: "u-1" } },
      { method: "POST", path: "/1.5/lenses/555/filter", status: 200, body: {} },
    ]);

    const result: any = await newLens.execute(newClient(), {
      name: "Touraine",
      locations: ["Indre-et-Loire"],
      base: 42,
      confirm: true,
    });

    expect(result.status).toBe("created");
    const filterPost = getHttpRequests().find(
      (r) => r.method === "POST" && r.path === "/1.5/lenses/555/filter"
    );
    const body = JSON.parse(filterPost!.body!);
    // Unwrapped write shape; criterion carries the resolved admin-area id.
    expect(body).toHaveProperty("items");
    expect(body).not.toHaveProperty("locations");
    const locCrit = body.items[0].criteria.find((c: any) => c.type === "location_ids");
    expect(locCrit).toMatchObject({ type: "location_ids", is_excluded: false, locations: ["477"] });
  });

  it("ambiguous location — lens is NOT created", async () => {
    mockHttp([
      {
        method: "GET",
        path: /\/1\.5\/geo\/search\?q=Pa/,
        status: 200,
        body: {
          results: [
            { id: "1", country: "FR", level: 8, name: "Pau", parent_ids: [] },
            { id: "2", country: "FR", level: 8, name: "Paris", parent_ids: [] },
            { id: "3", country: "FR", level: 8, name: "Pantin", parent_ids: [] },
          ],
          parents: [],
        },
      },
    ]);

    const result: any = await newLens.execute(newClient(), {
      name: "Vague",
      locations: ["Pa"],
      base: 42,
      confirm: true,
    });

    expect(result.status).toBe("ambiguous_locations");
    expect(result.location_ambiguities[0].location_text).toBe("Pa");
    // No lens was created.
    const createPost = getHttpRequests().find(
      (r) => r.method === "POST" && r.path === "/1.5/lenses"
    );
    expect(createPost).toBeUndefined();
  });

  it("admin-area id passes through without a /geo/search call", async () => {
    mockHttp([
      { method: "POST", path: "/1.5/lenses", status: 200, body: { id: 556, name: "ById", user_id: "u-1" } },
      { method: "POST", path: "/1.5/lenses/556/filter", status: 200, body: {} },
    ]);

    const result: any = await newLens.execute(newClient(), {
      name: "ById",
      locations: ["477"],
      base: 42,
      confirm: true,
    });

    expect(result.status).toBe("created");
    // Numeric id forwarded as-is — resolver never hits the network.
    const geo = getHttpRequests().find((r) => /\/1\.5\/geo\/search/.test(r.path));
    expect(geo).toBeUndefined();
    const filterPost = getHttpRequests().find(
      (r) => r.method === "POST" && r.path === "/1.5/lenses/556/filter"
    );
    const locCrit = JSON.parse(filterPost!.body!).items[0].criteria.find(
      (c: any) => c.type === "location_ids"
    );
    expect(locCrit.locations).toEqual(["477"]);
  });

  it("preview (no confirm) surfaces the resolved locations and creates nothing", async () => {
    mockHttp([
      {
        method: "GET",
        path: /\/1\.5\/geo\/search\?q=Indre-et-Loire/,
        status: 200,
        body: {
          results: [
            { id: "477", country: "FR", level: 6, name: "Indre-et-Loire", parent_ids: [] },
          ],
          parents: [],
        },
      },
    ]);

    const result: any = await newLens.execute(newClient(), {
      name: "Touraine",
      locations: ["Indre-et-Loire"],
      base: 42,
    });

    expect(result.status).toBe("preview");
    expect(result.will_create.locations).toContain("477");
    const createPost = getHttpRequests().find(
      (r) => r.method === "POST" && r.path === "/1.5/lenses"
    );
    expect(createPost).toBeUndefined();
  });
});
