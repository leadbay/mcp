/**
 * Unit tests for the #3833 fix: pull_leads must NOT report a freshly-created
 * lens as "empty" while its wishlist is still computing.
 *
 * Two layers:
 *  1. buildPullLeadsNextSteps — an EMPTY page + a computing flag now returns a
 *     single "Re-pull in ~30s" option (kind:"repull_computing") instead of null,
 *     so the model renders a wait-and-retry widget rather than "no leads." An
 *     empty page with NOTHING computing still returns null (genuinely empty).
 *  2. pullLeads.execute — a wishlist response of {items:[], computing_wishlist:true}
 *     surfaces the nudge in next_steps and echoes the computing flag.
 *
 * NEW FILE — does not touch pull-leads-next-steps.test.ts (which locks the
 * flags-omitted → null invariant, still true here via the default-false params).
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
import {
  pullLeads,
  buildPullLeadsNextSteps,
} from "../../../src/composite/pull-leads.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

describe("buildPullLeadsNextSteps — empty-but-computing (#3833)", () => {
  it("empty + computing_wishlist:true → re-pull option first, valid 2–4 widget count", () => {
    const ns = buildPullLeadsNextSteps({
      leadCount: 0,
      hasMore: false,
      nextPage: null,
      computingWishlist: true,
      computingScores: false,
    });
    expect(ns).not.toBeNull();
    // Host-widget contract requires 2–4 options; a single option is invalid.
    expect(ns!.options.length).toBeGreaterThanOrEqual(2);
    expect(ns!.options.length).toBeLessThanOrEqual(4);
    expect(ns!.options[0].kind).toBe("repull_computing");
    for (const opt of ns!.options) {
      expect(opt.label.trim().split(/\s+/).length).toBeLessThanOrEqual(5);
    }
    expect(ns!.options[0].description).toMatch(/~30s/);
    expect(ns!.question).toMatch(/warming up/i);
  });

  it("empty + computing_scores:true (wishlist false) → same re-pull-first, valid count", () => {
    const ns = buildPullLeadsNextSteps({
      leadCount: 0,
      hasMore: false,
      nextPage: null,
      computingWishlist: false,
      computingScores: true,
    });
    expect(ns).not.toBeNull();
    expect(ns!.options.length).toBeGreaterThanOrEqual(2);
    expect(ns!.options.length).toBeLessThanOrEqual(4);
    expect(ns!.options[0].kind).toBe("repull_computing");
  });

  it("empty + both flags false → null (genuinely empty, no widget)", () => {
    expect(
      buildPullLeadsNextSteps({
        leadCount: 0,
        hasMore: false,
        nextPage: null,
        computingWishlist: false,
        computingScores: false,
      })
    ).toBeNull();
  });

  it("non-empty + computing:true → normal menu, artifact offer still options[0]", () => {
    const ns = buildPullLeadsNextSteps({
      leadCount: 8,
      hasMore: false,
      nextPage: null,
      computingWishlist: true,
      computingScores: true,
    });
    expect(ns).not.toBeNull();
    expect(ns!.options[0].kind).toBe("build_artifact");
    expect(ns!.options.some((o) => o.kind === "repull_computing")).toBe(false);
  });
});

describe("pullLeads.execute — empty wishlist while computing (#3833)", () => {
  it("empty page + computing_wishlist:true → next_steps carries the re-pull nudge, flag echoed", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/lenses/777/leads/wishlist?count=20&page=0&contacts=true",
        status: 200,
        body: {
          items: [],
          pagination: { page: 0, pages: 0, total: 0 },
          computing_wishlist: true,
          computing_scores: true,
        },
      },
    ]);

    const result: any = await pullLeads.execute(newClient(), { lensId: 777 });

    expect(result.leads).toHaveLength(0);
    expect(result.computing_wishlist).toBe(true);
    expect(result.next_steps).not.toBeNull();
    // Valid host-widget option count (2–4), re-pull nudge first.
    expect(result.next_steps.options.length).toBeGreaterThanOrEqual(2);
    expect(result.next_steps.options.length).toBeLessThanOrEqual(4);
    expect(result.next_steps.options[0].kind).toBe("repull_computing");
    // No per-lead fan-out on an empty batch.
    expect(
      getHttpRequests().some((r) => r.path.includes("/ai_agent_responses"))
    ).toBe(false);
  });

  it("empty page + nothing computing → next_steps null (genuinely empty lens)", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/lenses/778/leads/wishlist?count=20&page=0&contacts=true",
        status: 200,
        body: {
          items: [],
          pagination: { page: 0, pages: 0, total: 0 },
          computing_wishlist: false,
          computing_scores: false,
        },
      },
    ]);

    const result: any = await pullLeads.execute(newClient(), { lensId: 778 });

    expect(result.leads).toHaveLength(0);
    expect(result.computing_wishlist).toBe(false);
    expect(result.next_steps).toBeNull();
  });
});
