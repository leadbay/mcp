/**
 * product#4176 — "what is this lens searching for" had no answer on the
 * default tool surface. `leadbay_my_lenses` returned {id, name, description,
 * is_active} and nothing else; the only read of a lens's criteria was
 * advanced-gated. Every lens in every response now carries all its metadata
 * and its own criteria, with sector and location ids named.
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
import { myLenses } from "../../../src/composite/my-lenses.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

const ME = (lastRequested: string) => ({
  id: "u-1",
  email: "u@example.com",
  language: "en",
  organization: { id: "org-1", name: "Acme" },
  last_requested_lens: lastRequested,
});

// Row shape as GET /lenses returns it live (FR prod, 2026-09-18).
const ROW = (id: string, name: string, lastActive: boolean) => ({
  id,
  user_id: "003b4728-af5b-4182-a438-56ef015b8211",
  default: false,
  name,
  multi_product_mode: false,
  use_hq_only: true,
  is_last_active: lastActive,
  not_enough_lead_candidates: false,
  not_enough_new_leads: false,
  less_leads_than_targeted: true,
});
const LENSES = [ROW("5885", "My first lens", true), ROW("5890", "C industrie manufacturière", false)];

const SECTORS_PATH = "/1.6/sectors/all?lang=en&includeInvisible=false";
const TAXONOMY = [
  { id: "3238", label: "Fitness and Recreational Sports Centers", visible: true },
  { id: "2662", label: "Warehousing and Storage", visible: true },
];

// Lens 5885's live shape on 2026-09-17: size only, plus an implicit filter
// the web app never shows.
const SIZE_ONLY = {
  lens_filter: {
    items: [{ criteria: [{ type: "size", is_excluded: false, sizes: [{ min: 20, max: 500 }] }] }],
  },
  implicit_filter: {
    items: [{ criteria: [{ type: "sector_ids", is_excluded: false, sectors: ["5052"] }] }],
  },
  locations: { results: [], parents: [] },
};
const SECTORS_AND_PLACE = {
  lens_filter: {
    items: [
      {
        criteria: [
          { type: "sector_ids", is_excluded: false, sectors: ["3238", "9999"] },
          { type: "sector_ids", is_excluded: true, sectors: ["2662"] },
          { type: "location_ids", is_excluded: false, locations: ["3"] },
          { type: "keywords", is_excluded: false, keywords: ["CNC"] },
        ],
      },
    ],
  },
  locations: {
    results: [{ id: "3", country: "FR", level: 4, name: "Hauts-de-France", parent_ids: ["3"] }],
    parents: [],
  },
};

beforeEach(() => resetHttpMock());

describe("leadbay_my_lenses returns every lens's criteria (product#4176)", () => {
  it("plain list: every lens has its metadata and named criteria", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/lenses", status: 200, body: LENSES },
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME("5885") },
      { method: "GET", path: "/1.6/lenses/5885/filter", status: 200, body: SIZE_ONLY },
      { method: "GET", path: "/1.6/lenses/5890/filter", status: 200, body: SECTORS_AND_PLACE },
      { method: "GET", path: SECTORS_PATH, status: 200, body: TAXONOMY },
    ]);

    const result: any = await myLenses.execute(newClient(), {});

    expect(result.status).toBe("listed");
    const first = result.lenses.find((l: any) => l.id === "5885");
    expect(first).toEqual({
      id: "5885",
      user_id: "003b4728-af5b-4182-a438-56ef015b8211",
      name: "My first lens",
      description: null,
      multi_product_mode: false,
      use_hq_only: true,
      not_enough_lead_candidates: false,
      not_enough_new_leads: false,
      less_leads_than_targeted: true,
      is_active: true,
      is_default: false,
      criteria: [{ type: "size", is_excluded: false, sizes: [{ min: 20, max: 500 }] }],
    });
    expect(result.lenses.find((l: any) => l.id === "5890").criteria).toEqual([
      {
        type: "sector_ids",
        is_excluded: false,
        sectors: [
          { id: "3238", name: "Fitness and Recreational Sports Centers" },
          { id: "9999", name: null },
        ],
      },
      { type: "sector_ids", is_excluded: true, sectors: [{ id: "2662", name: "Warehousing and Storage" }] },
      { type: "location_ids", is_excluded: false, locations: [{ id: "3", name: "Hauts-de-France" }] },
      { type: "keywords", is_excluded: false, keywords: ["CNC"] },
    ]);
    // The implicit filter is not the lens's own criteria and is not returned.
    expect(JSON.stringify(result)).not.toContain("5052");
    // One taxonomy read for the whole list.
    expect(getHttpRequests().filter((r) => r.path === SECTORS_PATH)).toHaveLength(1);
  });

  it("no lens has a sector criterion — no taxonomy read", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/lenses", status: 200, body: [LENSES[0]] },
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME("5885") },
      { method: "GET", path: "/1.6/lenses/5885/filter", status: 200, body: SIZE_ONLY },
    ]);

    const result: any = await myLenses.execute(newClient(), {});

    expect(result.lenses[0].criteria).toHaveLength(1);
    expect(getHttpRequests().some((r) => r.path.startsWith("/1.6/sectors/all"))).toBe(false);
  });

  it("one unreadable filter — that lens reads criteria: null, the list still returns", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/lenses", status: 200, body: LENSES },
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME("5885") },
      { method: "GET", path: "/1.6/lenses/5885/filter", status: 500, body: {} },
      { method: "GET", path: "/1.6/lenses/5890/filter", status: 200, body: SECTORS_AND_PLACE },
      { method: "GET", path: SECTORS_PATH, status: 200, body: TAXONOMY },
    ]);

    const result: any = await myLenses.execute(newClient(), {});

    expect(result.status).toBe("listed");
    expect(result.lenses.find((l: any) => l.id === "5885").criteria).toBeNull();
    expect(result.lenses.find((l: any) => l.id === "5890").criteria).toHaveLength(4);
  });

  it("switch: the refreshed list carries criteria, each filter read once", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/lenses", status: 200, body: LENSES },
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME("5885") },
      { method: "GET", path: "/1.6/lenses/5885/filter", status: 200, body: SIZE_ONLY },
      { method: "GET", path: "/1.6/lenses/5890/filter", status: 200, body: SECTORS_AND_PLACE },
      { method: "GET", path: SECTORS_PATH, status: 200, body: TAXONOMY },
      { method: "POST", path: "/1.6/lenses/5890/update_last_requested", status: 200, body: {} },
      { method: "GET", path: "/1.6/lenses", status: 200, body: LENSES },
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME("5890") },
    ]);

    const result: any = await myLenses.execute(newClient(), { switchToLensId: "5890" });

    expect(result.status).toBe("switched");
    const now = result.lenses.find((l: any) => l.id === "5890");
    expect(now.is_active).toBe(true);
    expect(now.criteria[2]).toEqual({
      type: "location_ids",
      is_excluded: false,
      locations: [{ id: "3", name: "Hauts-de-France" }],
    });
    expect(getHttpRequests().filter((r) => r.path.endsWith("/filter"))).toHaveLength(2);
  });
});
