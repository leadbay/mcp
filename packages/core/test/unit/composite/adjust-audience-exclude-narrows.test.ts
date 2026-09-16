// product#4148 — excluding a sector must take it OFF the include list.
//
// Prod US lens 40979, 2026-09-16. The user asked to tighten a lens to
// construction instead of manufacturing. The call was
// {lensName:"Plant Buyers", sectors:["Construction"], exclude_sectors:["Manufacturing"]}
// and the saved filter came back with include ["830","731"] and exclude
// ["830"] — Manufacturing on both sides at once.
//
// RED proof on main: the include criterion still carries "830".

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../../harness.js";
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
  last_requested_lens: 40979,
  language: "en",
};
const LENSES = [
  { id: 40979, name: "Plant Buyers", user_id: "u-1", is_default: false, default: false },
];
const TAXONOMY = [
  { id: "830", label: "Manufacturing", registry: "NAICS", depth: 1 },
  { id: "731", label: "Construction", registry: "NAICS", depth: 1 },
];
const SECTORS_PATH = "/1.6/sectors/all?lang=en&includeInvisible=false";

/** The lens as it stood: scoped to Manufacturing. */
const MANUFACTURING_FILTER = {
  lens_filter: {
    items: [{ criteria: [{ type: "sector_ids", is_excluded: false, sectors: ["830"] }] }],
  },
  locations: { results: [], parents: [] },
};

const sectorCriteria = () => {
  const post = getHttpRequests().find(
    (r) => r.method === "POST" && r.path === "/1.6/lenses/40979/filter"
  );
  const criteria = JSON.parse(post!.body!).items[0].criteria as any[];
  return {
    include: criteria.find((c) => c.type === "sector_ids" && !c.is_excluded),
    exclude: criteria.find((c) => c.type === "sector_ids" && c.is_excluded),
  };
};

beforeEach(() => resetHttpMock());

describe("leadbay_adjust_audience — exclude narrows the include list", () => {
  it("replays lens 40979: excluding Manufacturing drops it from the include list", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME },
      { method: "GET", path: "/1.6/lenses", status: 200, body: LENSES },
      { method: "GET", path: SECTORS_PATH, status: 200, body: TAXONOMY },
      // exclude_sectors is resolved in a second pass — same two reads again.
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME },
      { method: "GET", path: SECTORS_PATH, status: 200, body: TAXONOMY },
      { method: "GET", path: "/1.6/lenses/40979", status: 200, body: LENSES[0] },
      { method: "GET", path: "/1.6/lenses/40979/filter", status: 200, body: MANUFACTURING_FILTER },
      { method: "POST", path: "/1.6/lenses/40979/filter", status: 200, body: {} },
    ]);

    const result: any = await adjustAudience.execute(newClient(), {
      lensName: "Plant Buyers",
      sectors: ["Construction"],
      exclude_sectors: ["Manufacturing"],
    });

    expect(result.status).toBe("applied");
    const { include, exclude } = sectorCriteria();
    expect(include.sectors).toEqual(["731"]);
    expect(exclude.sectors).toEqual(["830"]);
  });

  it("including a sector the lens excludes drops it from the exclude list", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME },
      { method: "GET", path: "/1.6/lenses", status: 200, body: LENSES },
      { method: "GET", path: SECTORS_PATH, status: 200, body: TAXONOMY },
      { method: "GET", path: "/1.6/lenses/40979", status: 200, body: LENSES[0] },
      {
        method: "GET",
        path: "/1.6/lenses/40979/filter",
        status: 200,
        body: {
          lens_filter: {
            items: [
              {
                criteria: [
                  { type: "sector_ids", is_excluded: false, sectors: ["731"] },
                  { type: "sector_ids", is_excluded: true, sectors: ["830"] },
                ],
              },
            ],
          },
          locations: { results: [], parents: [] },
        },
      },
      { method: "POST", path: "/1.6/lenses/40979/filter", status: 200, body: {} },
    ]);

    const result: any = await adjustAudience.execute(newClient(), {
      lensName: "Plant Buyers",
      sectors: ["Manufacturing"],
    });

    expect(result.status).toBe("applied");
    const { include, exclude } = sectorCriteria();
    expect(include.sectors).toEqual(["731", "830"]);
    // The exclude criterion held only 830 — emptied, it is dropped entirely.
    expect(exclude).toBeUndefined();
  });
});
