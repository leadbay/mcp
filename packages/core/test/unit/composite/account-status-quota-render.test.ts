// product#3865 — leadbay_account_status must surface quota the way the web app
// does: a percentage-used + dollar-spend gauge per window (from quota.<group>.
// spend[]), with a per-resource breakdown (quota.<group>.resources[]) as the
// fallback for internal/free orgs whose spend[] is empty. The composite relays
// `quota` VERBATIM (the %/$ math lives in the rendering layer), so these tests
// lock the DATA CONTRACT the render depends on: that spend[], resources[].
// max_units, both scope groups, and topup all survive the passthrough intact.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { accountStatus } from "../../../src/composite/account-status.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");
const ORG = "org-1";

const me = () => ({
  email: "a@b.co", // non-leadbay → NOT unlimited, so quota renders normally
  name: "A",
  admin: true,
  manager: false,
  language: "en",
  organization: { id: ORG, name: "PayingCo", ai_agent_enabled: true, computing_intelligence: false },
  last_requested_lens: null,
});

// Three-window spend[] with dollar-cents current/max — the % gauge source.
const spendThreeWindows = [
  { current_units: 84, max_units: 1200, window_type: "daily", resets_at: "2026-07-08T00:00:00Z" },
  { current_units: 250, max_units: 5000, window_type: "weekly", resets_at: "2026-07-13T00:00:00Z" },
  { current_units: 900, max_units: 20000, window_type: "monthly", resets_at: "2026-08-01T00:00:00Z" },
];

const resourcesWithCaps = [
  { resource_type: "llm_completion", count: 4, max_units: 50, window_type: "monthly", resets_at: "2026-08-01T00:00:00Z" },
  { resource_type: "ai_rescore", count: 81, max_units: null, window_type: "monthly", resets_at: "2026-08-01T00:00:00Z" },
  { resource_type: "web_fetch", count: 33, window_type: "monthly", resets_at: "2026-08-01T00:00:00Z" },
];

beforeEach(() => resetHttpMock());

describe("account_status — quota render data contract (product#3865)", () => {
  it("passes the per-window spend[] gauge through verbatim (% + $ source)", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: me() },
      {
        method: "GET",
        path: `/1.6/organizations/${ORG}/quota_status`,
        status: 200,
        body: { plan: "TIER1", user: { spend: spendThreeWindows, resources: resourcesWithCaps } },
      },
    ]);
    const r: any = await accountStatus.execute(newClient(), {});
    expect(r.quota.user.spend).toHaveLength(3);
    const daily = r.quota.user.spend.find((s: any) => s.window_type === "daily");
    // both fields present so the render can compute % = current/max and $ = /100
    expect(daily.current_units).toBe(84);
    expect(daily.max_units).toBe(1200);
  });

  it("preserves resources[].max_units (null and numeric) — type-fix regression lock", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: me() },
      {
        method: "GET",
        path: `/1.6/organizations/${ORG}/quota_status`,
        status: 200,
        body: { plan: "TIER1", user: { spend: [], resources: resourcesWithCaps } },
      },
    ]);
    const r: any = await accountStatus.execute(newClient(), {});
    const llm = r.quota.user.resources.find((x: any) => x.resource_type === "llm_completion");
    const rescore = r.quota.user.resources.find((x: any) => x.resource_type === "ai_rescore");
    expect(llm.max_units).toBe(50);
    expect(rescore.max_units).toBeNull();
  });

  it("relays topup balance unchanged", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: me() },
      {
        method: "GET",
        path: `/1.6/organizations/${ORG}/quota_status`,
        status: 200,
        body: {
          plan: "TIER1",
          user: { spend: spendThreeWindows, resources: [] },
          topup: { remaining_cents: 500, total_credit_cents: 1000 },
        },
      },
    ]);
    const r: any = await accountStatus.execute(newClient(), {});
    expect(r.quota.topup.remaining_cents).toBe(500);
    expect(r.quota.topup.total_credit_cents).toBe(1000);
  });

  it("empty spend[] + populated resources[] survives — the internal/free fallback path", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: me() },
      {
        method: "GET",
        path: `/1.6/organizations/${ORG}/quota_status`,
        status: 200,
        body: { plan: null, user: { spend: [], resources: resourcesWithCaps } },
      },
    ]);
    const r: any = await accountStatus.execute(newClient(), {});
    expect(r.quota.user.spend).toEqual([]);
    expect(r.quota.user.resources.length).toBeGreaterThan(0);
  });

  it("both org and user groups survive so the render can prefer user", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: me() },
      {
        method: "GET",
        path: `/1.6/organizations/${ORG}/quota_status`,
        status: 200,
        body: {
          plan: "TIER1",
          org: { spend: spendThreeWindows, resources: resourcesWithCaps },
          user: { spend: spendThreeWindows, resources: resourcesWithCaps },
        },
      },
    ]);
    const r: any = await accountStatus.execute(newClient(), {});
    expect(r.quota.org.spend).toHaveLength(3);
    expect(r.quota.user.spend).toHaveLength(3);
  });
});
