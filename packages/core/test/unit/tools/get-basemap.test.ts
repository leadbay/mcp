/**
 * leadbay_get_basemap hands a map board the outline of the workspace's own
 * country. The route planner template calls it from the page, so no agent ever
 * has to find and publish an outline file — the gap that left boards built for
 * other users with pins floating on a blank background.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../../harness.js";

import { vi } from "vitest";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { getBasemap } from "../../../src/tools/get-basemap.js";

const client = (region: string) => new LeadbayClient(`https://api-${region}.leadbay.app`, "u.test-token", region);

beforeEach(() => resetHttpMock());

describe("leadbay_get_basemap", () => {
  it("returns France's départements for a French workspace", async () => {
    mockHttp([]);
    const r: any = await getBasemap.execute(client("fr"), {});
    expect(r.region).toBe("fr");
    const outline = JSON.parse(r.geojson);
    expect(outline.type).toBe("FeatureCollection");
    expect(outline.features).toHaveLength(96);
  });

  it("returns the US states for a US workspace", async () => {
    mockHttp([]);
    const r: any = await getBasemap.execute(client("us"), {});
    expect(r.region).toBe("us");
    const names = JSON.parse(r.geojson).features.map((f: any) => f.properties.nom);
    expect(names).toContain("Texas");
    expect(names).toContain("District of Columbia");
    expect(names).toHaveLength(52);
  });

  it("sends the outline as a JSON string, not an object", async () => {
    // The server pretty-prints every result; as an object the France outline
    // comes out ~2.5 MB instead of ~560 KB.
    mockHttp([]);
    const r: any = await getBasemap.execute(client("fr"), {});
    expect(typeof r.geojson).toBe("string");
    expect(JSON.stringify(r, null, 2).length).toBeLessThan(700_000);
  });

  it("makes no backend call — the outlines ship with the server", async () => {
    mockHttp([]);
    await getBasemap.execute(client("fr"), {});
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("says plainly when a region has no outline", async () => {
    mockHttp([]);
    await expect(getBasemap.execute(client("xx"), {})).rejects.toThrow(/No country outline for region "xx"/);
  });

  it("is read-only and stays inside the workspace", () => {
    expect(getBasemap.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
  });
});
