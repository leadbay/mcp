/**
 * leadbay_list_locations refuses to look up a country (product#3951).
 *
 * This is the highest-leverage single insertion point in the whole guard,
 * because this tool is the one that HANDS OUT the admin-area ids every other
 * tool filters on. The admin-area index has no country nodes (product#3885), so
 * `q: "France"` cannot return France — it returns the commune of Francs, and an
 * id copied from that result fences whatever it is pasted into to one village
 * with no visible sign. Refusing the lookup means the bad id is never minted.
 *
 * Matches this tool's own idiom: it returns an envelope (an empty `q` already
 * does) rather than throwing.
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
import { listLocations } from "../../../src/tools/list-locations.js";

const US_BASE = "https://api-us.leadbay.app";
const FR_BASE = "https://api-fr.leadbay.app";
const usClient = () => new LeadbayClient(US_BASE, "u.test-token", "us");
const frClient = () => new LeadbayClient(FR_BASE, "u.test-token", "fr");

const geoHit = (q: RegExp, ...results: any[]) => ({
  method: "GET" as const,
  path: q,
  status: 200,
  body: { results, parents: [] },
});

beforeEach(() => resetHttpMock());

describe("leadbay_list_locations — country guard", () => {
  it("refuses the home country and returns no ids to paste", async () => {
    mockHttp([]);
    const result: any = await listLocations.execute(frClient(), { q: "France" });
    expect(result.status).toBe("country_level_location");
    expect(result.code).toBe("COUNTRY_LEVEL_LOCATION");
    expect(result.results).toEqual([]);
    expect(result.parents).toEqual([]);
    expect(result.country_locations[0].param).toBe("q");
    // The measured failure: this lookup used to return the commune of Francs.
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("refuses the US home country on the US backend", async () => {
    mockHttp([]);
    const result: any = await listLocations.execute(usClient(), {
      q: "United States",
    });
    expect(result.status).toBe("country_level_location");
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("refuses a foreign country", async () => {
    mockHttp([]);
    const result: any = await listLocations.execute(usClient(), { q: "Germany" });
    expect(result.status).toBe("country_level_location");
    expect(result.country_locations[0].kind).toBe("foreign_country");
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("looks up an ordinary city normally", async () => {
    mockHttp([
      geoHit(/\/1\.6\/geo\/search\?q=Paris/, {
        id: "1", name: "Paris", country: "FR", level: 8, parent_ids: [],
      }),
    ]);
    const result: any = await listLocations.execute(frClient(), { q: "Paris" });
    expect(result.status).toBeUndefined();
    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe("Paris");
  });

  it("looks up Georgia on the US backend but refuses it on FR", async () => {
    mockHttp([
      geoHit(/\/1\.6\/geo\/search\?q=Georgia/, {
        id: "9", name: "Georgia", country: "US", level: 4, parent_ids: [],
      }),
    ]);
    const onUs: any = await listLocations.execute(usClient(), { q: "Georgia" });
    expect(onUs.results).toHaveLength(1);

    resetHttpMock();
    mockHttp([]);
    const onFr: any = await listLocations.execute(frClient(), { q: "Georgia" });
    expect(onFr.status).toBe("country_level_location");
  });

  it("still returns the empty envelope for a blank query", async () => {
    mockHttp([]);
    const result: any = await listLocations.execute(frClient(), { q: "   " });
    expect(result).toEqual({ results: [], parents: [] });
    expect(getHttpRequests()).toHaveLength(0);
  });
});
