/**
 * product#4000 — `leadbay_extend_lens` must check extendability before it
 * queues a refill.
 *
 * `POST /lenses/{id}/extra_refill` answers `200 {"accepted_seeds": []}`
 * whether the refill will deliver 50 leads or nothing at all, and the fill it
 * queues on a zero-candidate lens consumes no quota and adds no leads. That
 * silence is what 3Bricks' agent looped on: 49 `extend_lens` +
 * 333 `set_active_lens` calls over 22 days against lenses that could not fill.
 *
 * The first test drives the production surface against the wire shapes
 * captured from FR staging on 2026-08-28 — lens 7137 (the "Francs fence"
 * repro, `available_count: 0` while `POST /extra_refill` still returns 200)
 * and lens 5965 (`available_count: 5195`, a healthy lens). The rest pin the
 * branches, including the two that must NEVER block a working refill.
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
import { extendLens } from "../../../src/composite/extend-lens.js";

const BASE = "https://api-fr.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "fr");

/** Verbatim from FR staging lens 7137, 2026-08-28. */
const EMPTY_POOL_PREVIEW = {
  available_count: 0,
  capped: false,
  cap: 10000,
  max_requestable_count: 0,
};

/** Verbatim from FR staging lens 5965, 2026-08-28. */
const HEALTHY_POOL_PREVIEW = {
  available_count: 5195,
  capped: false,
  cap: 10000,
  max_requestable_count: 5195,
};

/**
 * The repro filter: whole-country "France" trigram-fell-through to the commune
 * of Francs (id 27925, level 8), ANDed with sectors and a size band.
 */
const FRANCS_FENCE_FILTER = {
  lens_filter: {
    items: [
      {
        criteria: [
          { type: "location_ids", is_excluded: false, locations: ["27925"] },
          {
            type: "sector_ids",
            is_excluded: false,
            sectors: ["3484", "4383", "5287"],
          },
          { type: "size", is_excluded: false, sizes: [{ min: 20, max: 500 }] },
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

const wishlistTotal = (total: number) => ({
  items: [],
  pagination: { page: 0, pages: total > 0 ? 1 : 0, total },
  computing_wishlist: false,
  computing_scores: false,
});

const previewScript = (lensId: number, body: unknown) => ({
  method: "GET" as const,
  path: `/1.6/lenses/${lensId}/extra_refill_preview`,
  status: 200,
  body,
});

beforeEach(() => {
  resetHttpMock();
});

describe("leadbay_extend_lens — extendability pre-flight (product#4000)", () => {
  it("E2E: the staging repro lens is refused, not queued", async () => {
    mockHttp([
      previewScript(7137, EMPTY_POOL_PREVIEW),
      {
        method: "GET",
        path: "/1.6/lenses/7137/filter",
        status: 200,
        body: FRANCS_FENCE_FILTER,
      },
      {
        method: "GET",
        path: /\/lenses\/7137\/leads\/wishlist/,
        status: 200,
        body: wishlistTotal(0),
      },
    ]);

    const out: any = await extendLens.execute(newClient(), { lensId: 7137 });

    expect(out.status).toBe("no_candidates");
    expect(out.available_count).toBe(0);
    // The anti-loop guarantee, in the vocabulary pull_leads already uses.
    expect(out.reason.retryable).toBe(false);
    expect(out.reason.code).toBe("audience_too_narrow");
    // The criterion to relax, named.
    expect(out.reason.narrow_locations).toEqual([
      { id: "27925", name: "Francs", level: 8 },
    ]);
    expect(out.reason.criteria).toEqual({
      location_ids: ["27925"],
      sector_ids: ["3484", "4383", "5287"],
      sizes: [{ min: 20, max: 500 }],
    });
    expect(out.message).toMatch(/Francs/);
    expect(out.message).toMatch(/leadbay_adjust_audience/);
    // The whole point: the futile write never happened.
    expect(
      getHttpRequests().some((r) => r.method === "POST")
    ).toBe(false);
  });

  it("a lens that holds leads but has none left reports no_new_leads", async () => {
    mockHttp([
      previewScript(7137, EMPTY_POOL_PREVIEW),
      {
        method: "GET",
        path: "/1.6/lenses/7137/filter",
        status: 200,
        body: FRANCS_FENCE_FILTER,
      },
      {
        method: "GET",
        path: /\/lenses\/7137\/leads\/wishlist/,
        status: 200,
        body: wishlistTotal(160),
      },
    ]);

    const out: any = await extendLens.execute(newClient(), { lensId: 7137 });

    expect(out.status).toBe("no_candidates");
    expect(out.reason.code).toBe("no_new_leads");
    expect(out.reason.retryable).toBe(false);
    expect(out.message).toMatch(/160/);
    // Working what is already there is the alternative offer here.
    expect(out.message).toMatch(/leadbay_pull_followups/);
  });

  it("an unreadable lead total reports the bare observation, not a theory", async () => {
    mockHttp([
      previewScript(7137, EMPTY_POOL_PREVIEW),
      {
        method: "GET",
        path: "/1.6/lenses/7137/filter",
        status: 500,
        body: { error: "boom" },
      },
      {
        method: "GET",
        path: /\/lenses\/7137\/leads\/wishlist/,
        status: 500,
        body: { error: "boom" },
      },
    ]);

    const out: any = await extendLens.execute(newClient(), { lensId: 7137 });

    expect(out.status).toBe("no_candidates");
    expect(out.reason.code).toBe("no_candidates");
    expect(out.reason.retryable).toBe(false);
    expect(out.reason.criteria).toBeUndefined();
    expect(getHttpRequests().some((r) => r.method === "POST")).toBe(false);
  });

  it("a healthy pool queues the refill and echoes available_count", async () => {
    mockHttp([
      previewScript(5965, HEALTHY_POOL_PREVIEW),
      {
        method: "POST",
        path: "/1.6/lenses/5965/extra_refill",
        status: 200,
        body: { accepted_seeds: [] },
      },
    ]);

    const out: any = await extendLens.execute(newClient(), { lensId: 5965 });

    expect(out.status).toBe("queued");
    expect(out.available_count).toBe(5195);
    // No diagnostic reads on the happy path.
    const paths = getHttpRequests().map((r) => r.path);
    expect(paths.some((p) => p.endsWith("/filter"))).toBe(false);
    expect(paths.some((p) => p.includes("/wishlist"))).toBe(false);
  });

  it("a backend without the preview route still queues the refill", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/lenses/5965/extra_refill_preview",
        status: 404,
        body: { error: "not_found" },
      },
      {
        method: "POST",
        path: "/1.6/lenses/5965/extra_refill",
        status: 200,
        body: { accepted_seeds: ["11111111-1111-1111-1111-111111111111"] },
      },
    ]);

    const out: any = await extendLens.execute(newClient(), {
      lensId: 5965,
      seed_lead_ids: ["11111111-1111-1111-1111-111111111111"],
    });

    expect(out.status).toBe("queued");
    // Unreadable is NOT zero — and must never be reported as a count.
    expect(out.available_count).toBeNull();
    expect(out.accepted_seeds).toEqual([
      "11111111-1111-1111-1111-111111111111",
    ]);
  });

  it("a preview that omits available_count does not block the refill", async () => {
    mockHttp([
      previewScript(5965, { capped: false, cap: 10000 }),
      {
        method: "POST",
        path: "/1.6/lenses/5965/extra_refill",
        status: 200,
        body: { accepted_seeds: [] },
      },
    ]);

    const out: any = await extendLens.execute(newClient(), { lensId: 5965 });

    expect(out.status).toBe("queued");
    expect(out.available_count).toBeNull();
  });

  it("a non-empty pool still surfaces the documented error envelopes", async () => {
    mockHttp([
      previewScript(5965, HEALTHY_POOL_PREVIEW),
      {
        method: "POST",
        path: "/1.6/lenses/5965/extra_refill",
        status: 409,
        body: { error: "refresh_in_progress" },
      },
    ]);

    const out: any = await extendLens.execute(newClient(), { lensId: 5965 });

    expect(out.status).toBe("refresh_in_progress");
  });
});
