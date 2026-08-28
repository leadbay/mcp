/**
 * product#3995 — an empty lens must say WHY.
 *
 * The customer-visible defect: `pull_leads` on a lens whose criteria intersect
 * to nothing returns `{leads: [], total: 0, computing_wishlist: false,
 * computing_scores: false, next_steps: null}` and nothing else. The agent
 * cannot tell that from "still warming up", so it loops — 3Bricks' agent spent
 * 49 `extend_lens` + 333 `set_active_lens` calls on lenses that could not fill.
 *
 * The first test drives the PRODUCTION surface (`pullLeads.execute`) against
 * the exact wire response captured from prod lens 48101 on 2026-08-28, because
 * that is the shape a reviewer has to trust. The later tests pin the
 * individual branches.
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
import { pullLeads } from "../../../src/composite/pull-leads.js";

const BASE = "https://api-fr.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "fr");

/** Verbatim from prod lens 48101, 2026-08-28. */
const SETTLED_EMPTY_WISHLIST = {
  items: [],
  pagination: { page: 0, pages: 0, total: 0 },
  computing_wishlist: false,
  computing_scores: false,
};

/**
 * The E2E repro filter: whole-country "France" trigram-fell-through to the
 * commune of Francs (id 27925, level 8), ANDed with a size band.
 */
const FRANCE_FENCE_FILTER = {
  lens_filter: {
    items: [
      {
        criteria: [
          { type: "location_ids", is_excluded: false, locations: ["27925"] },
          {
            type: "size",
            is_excluded: false,
            sizes: [{ min: 200, max: 5000 }],
          },
        ],
      },
    ],
  },
  locations: {
    results: [
      { id: "27925", country: "FR", level: 8, name: "Francs", parent_ids: [] },
    ],
    parents: [],
  },
};

const lensRow = (over: Record<string, unknown> = {}) => [
  {
    id: "48101",
    name: "E2E-3995-empty-audience",
    default: false,
    is_last_active: true,
    not_enough_lead_candidates: false,
    not_enough_new_leads: false,
    less_leads_than_targeted: false,
    ...over,
  },
];

beforeEach(() => resetHttpMock());

describe("leadbay_pull_leads — empty_reason (product#3995)", () => {
  it("E2E: the prod repro response now names the narrow geo and forbids retrying", async () => {
    mockHttp([
      {
        method: "GET",
        path: /\/lenses\/48101\/leads\/wishlist/,
        status: 200,
        body: SETTLED_EMPTY_WISHLIST,
      },
      { method: "GET", path: "/1.6/lenses", status: 200, body: lensRow() },
      {
        method: "GET",
        path: "/1.6/lenses/48101/filter",
        status: 200,
        body: FRANCE_FENCE_FILTER,
      },
    ]);

    const res: any = await pullLeads.execute(newClient(), { lensId: 48101 });

    expect(res.leads).toHaveLength(0);
    expect(res.empty_reason).not.toBeNull();
    expect(res.empty_reason.code).toBe("audience_too_narrow");
    // The anti-loop guarantee.
    expect(res.empty_reason.retryable).toBe(false);
    // The criterion to relax, named.
    expect(res.empty_reason.narrow_locations).toEqual([
      { id: "27925", name: "Francs", level: 8 },
    ]);
    expect(res.empty_reason.criteria).toEqual({
      location_ids: ["27925"],
      sizes: [{ min: 200, max: 5000 }],
    });
    expect(res.empty_reason.message).toMatch(/Francs/);
    // The agent must be told extend_lens is futile here — that is the call it
    // burned 49 times.
    expect(res.empty_reason.message).toMatch(/extend_lens/);
  });

  it("a non-empty page costs no diagnostic reads and carries empty_reason:null", async () => {
    mockHttp([
      {
        method: "GET",
        path: /\/lenses\/48101\/leads\/wishlist/,
        status: 200,
        body: {
          items: [{ id: "lead-1", name: "ACME", score: 70 }],
          pagination: { page: 0, pages: 1, total: 1 },
          computing_wishlist: false,
          computing_scores: false,
        },
      },
      {
        method: "GET",
        path: "/1.6/leads/lead-1/ai_agent_responses",
        status: 200,
        body: [],
      },
    ]);

    const res: any = await pullLeads.execute(newClient(), { lensId: 48101 });

    expect(res.leads).toHaveLength(1);
    expect(res.empty_reason).toBeNull();
    const paths = getHttpRequests().map((r) => r.path);
    expect(paths.some((p) => p.endsWith("/lenses"))).toBe(false);
    expect(paths.some((p) => p.endsWith("/filter"))).toBe(false);
  });

  it("paging past the end of a healthy lens is not diagnosed as empty", async () => {
    mockHttp([
      {
        method: "GET",
        path: /\/lenses\/48101\/leads\/wishlist/,
        status: 200,
        body: {
          items: [],
          // The lens holds 160 leads; page 9 is simply past the end.
          pagination: { page: 9, pages: 8, total: 160 },
          computing_wishlist: false,
          computing_scores: false,
        },
      },
    ]);

    const res: any = await pullLeads.execute(newClient(), {
      lensId: 48101,
      page: 9,
    });

    expect(res.empty_reason).toBeNull();
    const paths = getHttpRequests().map((r) => r.path);
    expect(paths.some((p) => p.endsWith("/filter"))).toBe(false);
  });

  it("still computing → retryable, and no diagnostic reads are spent", async () => {
    mockHttp([
      {
        method: "GET",
        path: /\/lenses\/48101\/leads\/wishlist/,
        status: 200,
        body: { ...SETTLED_EMPTY_WISHLIST, computing_wishlist: true },
      },
    ]);

    const res: any = await pullLeads.execute(newClient(), { lensId: 48101 });

    expect(res.empty_reason.code).toBe("computing");
    expect(res.empty_reason.retryable).toBe(true);
    const paths = getHttpRequests().map((r) => r.path);
    expect(paths.some((p) => p.endsWith("/lenses"))).toBe(false);
    expect(paths.some((p) => p.endsWith("/filter"))).toBe(false);
  });

  it("not_enough_lead_candidates wins over the generic narrow-audience read", async () => {
    mockHttp([
      {
        method: "GET",
        path: /\/lenses\/48101\/leads\/wishlist/,
        status: 200,
        body: SETTLED_EMPTY_WISHLIST,
      },
      {
        method: "GET",
        path: "/1.6/lenses",
        status: 200,
        body: lensRow({ not_enough_lead_candidates: true }),
      },
      {
        method: "GET",
        path: "/1.6/lenses/48101/filter",
        status: 200,
        body: FRANCE_FENCE_FILTER,
      },
    ]);

    const res: any = await pullLeads.execute(newClient(), { lensId: 48101 });

    expect(res.empty_reason.code).toBe("no_candidates");
    expect(res.empty_reason.retryable).toBe(false);
    expect(res.empty_reason.narrow_locations).toHaveLength(1);
  });

  it("not_enough_new_leads routes to follow-ups rather than a wider audience only", async () => {
    mockHttp([
      {
        method: "GET",
        path: /\/lenses\/48101\/leads\/wishlist/,
        status: 200,
        body: SETTLED_EMPTY_WISHLIST,
      },
      {
        method: "GET",
        path: "/1.6/lenses",
        status: 200,
        body: lensRow({ not_enough_new_leads: true }),
      },
      {
        method: "GET",
        path: "/1.6/lenses/48101/filter",
        status: 200,
        body: FRANCE_FENCE_FILTER,
      },
    ]);

    const res: any = await pullLeads.execute(newClient(), { lensId: 48101 });

    expect(res.empty_reason.code).toBe("no_new_leads");
    expect(res.empty_reason.message).toMatch(/leadbay_pull_followups/);
  });

  it("a région-level scope is not reported as narrow geography", async () => {
    mockHttp([
      {
        method: "GET",
        path: /\/lenses\/48101\/leads\/wishlist/,
        status: 200,
        body: SETTLED_EMPTY_WISHLIST,
      },
      { method: "GET", path: "/1.6/lenses", status: 200, body: lensRow() },
      {
        method: "GET",
        path: "/1.6/lenses/48101/filter",
        status: 200,
        body: {
          lens_filter: {
            items: [
              {
                criteria: [
                  {
                    type: "location_ids",
                    is_excluded: false,
                    locations: ["12"],
                  },
                ],
              },
            ],
          },
          locations: {
            results: [
              {
                id: "12",
                country: "FR",
                level: 4,
                name: "Île-de-France",
                parent_ids: [],
              },
            ],
            parents: [],
          },
        },
      },
    ]);

    const res: any = await pullLeads.execute(newClient(), { lensId: 48101 });

    expect(res.empty_reason.code).toBe("audience_too_narrow");
    expect(res.empty_reason.narrow_locations).toBeUndefined();
    expect(res.empty_reason.criteria).toEqual({ location_ids: ["12"] });
  });

  it("an unfiltered lens that is still empty reports unknown, never a guess", async () => {
    mockHttp([
      {
        method: "GET",
        path: /\/lenses\/48101\/leads\/wishlist/,
        status: 200,
        body: SETTLED_EMPTY_WISHLIST,
      },
      { method: "GET", path: "/1.6/lenses", status: 200, body: lensRow() },
      {
        method: "GET",
        path: "/1.6/lenses/48101/filter",
        status: 200,
        body: { lens_filter: { items: [{ criteria: [] }] }, locations: { results: [], parents: [] } },
      },
    ]);

    const res: any = await pullLeads.execute(newClient(), { lensId: 48101 });

    expect(res.empty_reason.code).toBe("unknown");
    expect(res.empty_reason.retryable).toBe(false);
    expect(res.empty_reason.criteria).toBeUndefined();
  });

  it("a failing diagnostic read still yields retryable:false — the anti-loop guarantee holds", async () => {
    mockHttp([
      {
        method: "GET",
        path: /\/lenses\/48101\/leads\/wishlist/,
        status: 200,
        body: SETTLED_EMPTY_WISHLIST,
      },
      { method: "GET", path: "/1.6/lenses", status: 500, body: { error: "boom" } },
      {
        method: "GET",
        path: "/1.6/lenses/48101/filter",
        status: 500,
        body: { error: "boom" },
      },
    ]);

    const res: any = await pullLeads.execute(newClient(), { lensId: 48101 });

    expect(res.empty_reason.code).toBe("unknown");
    expect(res.empty_reason.retryable).toBe(false);
  });
});
