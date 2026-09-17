// product#4100 — a sector named in words must narrow a lens.
//
// GET /sectors/all returns rows keyed `label`; no row has ever carried `name`
// (1091 rows on api-us, 1368 on api-fr, checked 2026-09-15). The matcher read
// `name`, so every row scored 0 and every free-text sector came back as
// `ambiguous_sectors` with an empty `matches` list — no lens could be created
// or narrowed by sector name through the MCP, in either region.
//
// RED proof on main: both cases return status "ambiguous_sectors".

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { adjustAudience } from "../../../src/composite/adjust-audience.js";

const BASE = "https://api-fr.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "fr");

const ME = {
  id: "u-1",
  email: "u@example.com",
  organization: { id: "org-1", name: "Acme" },
  admin: false,
  last_requested_lens: 4242,
  language: "fr",
};
const LENS = { id: 4242, name: "My audience", user_id: "u-1", is_default: false, default: false };
const EMPTY_FILTER = {
  lens_filter: { items: [{ criteria: [] }] },
  locations: { results: [], parents: [] },
};
const SECTORS_PATH = "/1.6/sectors/all?lang=fr&includeInvisible=false";

/** Rows in the shape api-fr actually serves them. */
const TAXONOMY = [
  { id: "3706", label: "Construction", registry: "SIRENE", depth: 1, number_of_leads: 783569 },
  { id: "4300", label: "Restauration", registry: "SIRENE", depth: 2, number_of_leads: 503617 },
  { id: "4301", label: "Menuiserie", registry: "SIRENE", depth: 4, number_of_leads: 41000 },
];

const lensWrite = [
  { method: "GET" as const, path: "/1.6/lenses/4242", status: 200, body: LENS },
  { method: "GET" as const, path: "/1.6/lenses/4242/filter", status: 200, body: EMPTY_FILTER },
  { method: "POST" as const, path: "/1.6/lenses/4242/filter", status: 200, body: {} },
];

beforeEach(() => resetHttpMock());

describe("leadbay_adjust_audience — sectors named in words", () => {
  it("resolves a sector the taxonomy carries under `label`", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME },
      { method: "GET", path: SECTORS_PATH, status: 200, body: TAXONOMY },
      ...lensWrite,
    ]);

    const result: any = await adjustAudience.execute(newClient(), {
      sectors: ["Restauration"],
    });

    expect(result.status).toBe("applied");
    // The proof is what was written to the lens: the id behind the label.
    const write = getHttpRequests().find(
      (r) => r.method === "POST" && r.path === "/1.6/lenses/4242/filter"
    );
    const criteria = JSON.parse(write!.body!).items[0].criteria;
    expect(criteria).toContainEqual(
      expect.objectContaining({ type: "sector_ids", sectors: ["4300"] })
    );
  });

  it("names real candidates when the ask is ambiguous, instead of an empty list", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME },
      {
        method: "GET",
        path: SECTORS_PATH,
        status: 200,
        body: [
          { id: "1", label: "Menuiserie bois" },
          { id: "2", label: "Menuiserie PVC" },
        ],
      },
    ]);

    const result: any = await adjustAudience.execute(newClient(), {
      sectors: ["Menuiserie"],
    });

    expect(result.status).toBe("ambiguous_sectors");
    const entry = result.sector_ambiguities.find((a: any) => a.sector_text === "Menuiserie");
    // The matches used to come back empty, which told the user nothing.
    expect(entry.matches.map((m: any) => m.name).sort()).toEqual([
      "Menuiserie PVC",
      "Menuiserie bois",
    ]);
  });
});
