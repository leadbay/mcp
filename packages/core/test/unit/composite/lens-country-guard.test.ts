/**
 * The lens-writing tools refuse country-level locations before any I/O
 * (product#3951).
 *
 * `leadbay_new_lens` and `leadbay_adjust_audience` both persist geography as a
 * `location_ids` criterion, so a country label does lasting damage: the
 * admin-area index has no country nodes (product#3885), the value
 * trigram-matches a same-named commune ("France" → Francs), and the lens stays
 * fenced to one village for every later pull. adjust_audience is the worse of
 * the two — its criteria MERGE as a union, so the bad fence cannot be undone by
 * re-calling with the right value.
 *
 * Every assertion here pairs the named status with `getHttpRequests()` being
 * empty. That is the load-bearing half: it proves the guard ran before the
 * sector taxonomy, before /users/me, before GET /lenses/:id/filter and before
 * /geo/search — so a doomed call writes nothing and costs nothing.
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
import { newLens } from "../../../src/composite/new-lens.js";

const US_BASE = "https://api-us.leadbay.app";
const FR_BASE = "https://api-fr.leadbay.app";
const usClient = () => new LeadbayClient(US_BASE, "u.test-token", "us");
const frClient = () => new LeadbayClient(FR_BASE, "u.test-token", "fr");

beforeEach(() => resetHttpMock());

const ME = {
  id: "u-1",
  email: "u@example.com",
  organization: { id: "org-1", name: "Acme" },
  admin: false,
  last_requested_lens: 4242,
  language: "en",
};

// A lens OWNED by the caller — an org-default lens would branch into the
// draft/clone path and pull in endpoints unrelated to this guard.
const USER_LENS = { id: 4242, name: "Mine", user_id: "u-1", is_default: false, default: false };
const EMPTY_FILTER = {
  lens_filter: { items: [{ criteria: [] }] },
  locations: { results: [], parents: [] },
};

/** Every endpoint a successful adjust_audience geo write touches, so the
 *  "guard did NOT fire" cases can run the flow to completion and assert the
 *  real outcome rather than merely "didn't throw". */
const applyFlow = (geo: RegExp, area: Record<string, unknown>) => [
  { method: "GET" as const, path: geo, status: 200, body: { results: [area], parents: [] } },
  { method: "GET" as const, path: "/1.6/users/me", status: 200, body: ME },
  { method: "GET" as const, path: "/1.6/lenses/4242", status: 200, body: USER_LENS },
  { method: "GET" as const, path: "/1.6/lenses/4242/filter", status: 200, body: EMPTY_FILTER },
  { method: "POST" as const, path: "/1.6/lenses/4242/filter", status: 200, body: {} },
];

describe("leadbay_new_lens — country guard", () => {
  it("refuses a home-country location and creates nothing", async () => {
    mockHttp([]);
    const result: any = await newLens.execute(usClient(), {
      name: "US-wide",
      locations: ["United States"],
      confirm: true,
    });
    expect(result.status).toBe("country_level_location");
    expect(result.code).toBe("COUNTRY_LEVEL_LOCATION");
    expect(result.country_locations).toHaveLength(1);
    expect(result.country_locations[0].param).toBe("locations");
    expect(result.message).toContain("United States");
    // No taxonomy fetch, no /geo/search, no POST /lenses.
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("refuses a country on the EXCLUDE axis and names that param", async () => {
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "Not France",
      exclude_locations: ["France"],
      confirm: true,
    });
    expect(result.status).toBe("country_level_location");
    expect(result.country_locations[0].param).toBe("exclude_locations");
    // The recovery must NOT be "omit it" — this assertion originally demanded
    // exactly that, encoding the polarity bug: omitting an exclusion of the home
    // country returns every company the user asked to remove. Exclusion-specific
    // wording is covered in country-exclude-polarity.test.ts.
    expect(result.hint).not.toMatch(/OMIT `?exclude_locations/i);
    // And because new_lens WRITES, the recovery stops instead of re-calling.
    expect(result.hint).toMatch(/would empty the entire audience/i);
    expect(result.hint).toMatch(/Write NOTHING/);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("refuses a supra-national scope", async () => {
    mockHttp([]);
    const result: any = await newLens.execute(usClient(), {
      name: "Everywhere",
      locations: ["Worldwide"],
      confirm: true,
    });
    expect(result.status).toBe("country_level_location");
    expect(result.country_locations[0].kind).toBe("supranational");
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("reports both axes in one envelope", async () => {
    mockHttp([]);
    const result: any = await newLens.execute(usClient(), {
      name: "Mixed",
      locations: ["Canada"],
      exclude_locations: ["Mexico"],
      confirm: true,
    });
    expect(result.country_locations.map((h: any) => h.param)).toEqual([
      "locations",
      "exclude_locations",
    ]);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("does NOT fire on a legitimate sub-country location", async () => {
    // Île-de-France must survive: it contains "France" as a substring, so a
    // sloppier matcher would break the single most common French territory.
    mockHttp([
      {
        method: "GET",
        path: /\/1\.6\/geo\/search\?q=/,
        status: 200,
        body: {
          results: [
            { id: "416102", name: "Île-de-France", country: "FR", level: 5, parent_ids: [] },
          ],
          parents: [],
        },
      },
    ]);
    const result: any = await newLens.execute(frClient(), {
      name: "IDF",
      locations: ["Île-de-France"],
    });
    expect(result.status).not.toBe("country_level_location");
    // It got as far as resolving the area, which is the point.
    expect(getHttpRequests().length).toBeGreaterThan(0);
  });
});

describe("leadbay_adjust_audience — country guard", () => {
  it("refuses a country and neither reads nor writes the lens filter", async () => {
    mockHttp([]);
    const result: any = await adjustAudience.execute(usClient(), {
      locations: ["USA"],
    });
    expect(result.status).toBe("country_level_location");
    expect(result.code).toBe("COUNTRY_LEVEL_LOCATION");
    // The union-merge never ran: no /users/me, no GET filter, no POST filter.
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("refuses a country NAME routed through the id param", async () => {
    // Agents put names in id params routinely; location_ids skips the resolver
    // entirely, so this is the path that would otherwise reach the backend.
    mockHttp([]);
    const result: any = await adjustAudience.execute(usClient(), {
      location_ids: ["United States"],
    });
    expect(result.status).toBe("country_level_location");
    expect(result.country_locations[0].param).toBe("location_ids");
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("does NOT reject a numeric admin-area id — documents the known gap", async () => {
    // A country passed as a resolved numeric id stays invisible to this layer:
    // deciding whether "416102" is a country needs a backend lookup the client
    // does not have. Narrowing the ingress is all this guard can do; closing it
    // is server-side (product#3939). Asserted so the limit is recorded, not
    // assumed.
    mockHttp(applyFlow(/\/1\.6\/geo\/search/, {}).slice(1));
    const result: any = await adjustAudience.execute(usClient(), {
      location_ids: ["416102"],
    });
    expect(result.status).toBe("applied");
    expect(getHttpRequests().length).toBeGreaterThan(0);
  });

  it("allows Georgia on the US universe but refuses it on FR", async () => {
    // A US rep prospecting the STATE writes the bare word; on the FR backend
    // the same word can only mean the country, which is out of universe.
    mockHttp(
      applyFlow(/\/1\.6\/geo\/search\?q=Georgia/, {
        id: "9", name: "Georgia", country: "US", level: 4, parent_ids: [],
      })
    );
    const onUs: any = await adjustAudience.execute(usClient(), {
      locations: ["Georgia"],
    });
    expect(onUs.status).toBe("applied");

    resetHttpMock();
    mockHttp([]);
    const onFr: any = await adjustAudience.execute(frClient(), {
      locations: ["Georgia"],
    });
    expect(onFr.status).toBe("country_level_location");
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("allows a French overseas département on the FR universe", async () => {
    // Guadeloupe is ISO 3166-1 GP, so a naive country list would refuse a
    // legitimate in-universe French territory.
    mockHttp(
      applyFlow(/\/1\.6\/geo\/search\?q=Guadeloupe/, {
        id: "77", name: "Guadeloupe", country: "FR", level: 4, parent_ids: [],
      })
    );
    const result: any = await adjustAudience.execute(frClient(), {
      locations: ["Guadeloupe"],
    });
    expect(result.status).toBe("applied");
  });
});
