/**
 * Unit tests for LeadbayClient — the error-mapping table is the primary value.
 * Uses mockHttp() from harness.ts (predicate match, opinionated errors on
 * unmatched requests).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
} from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../src/client.js";

const BASE = "https://api-us.leadbay.app";

beforeEach(() => {
  resetHttpMock();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LeadbayClient.request — HTTP status → error code mapping", () => {
  const cases: Array<[number, string, object | string | undefined, string, string?]> = [
    [401, "AUTH_EXPIRED", { message: "expired" }, "regenerate"],
    [402, "QUOTA_EXCEEDED", { message: "no credits" }, "credits"],
    [403, "BILLING_SUSPENDED", { message: "account suspended" }, "billing"],
    [403, "BILLING_SUSPENDED", { error: "billing_locked" }, "billing"],
    [403, "FORBIDDEN", { message: "forbidden" }, "permissions"],
    [404, "NOT_FOUND", { message: "nope" }, "ID is correct"],
    [429, "RATE_LIMITED", {}, "Wait"],
    [500, "API_ERROR", { message: "boom" }, "Try again"],
    [500, "API_ERROR", "not-json-body", "Try again", "API error (500)"],
    [418, "API_ERROR", {}, "Try again"],
  ];

  it.each(cases)(
    "HTTP %i → error code %s",
    async (status, expectedCode, body) => {
      mockHttp([{ method: "GET", path: "/1.5/lenses", status, body }]);
      const client = new LeadbayClient(BASE, "u.test-token");
      await expect(client.request("GET", "/lenses")).rejects.toMatchObject({
        error: true,
        code: expectedCode,
      });
    }
  );

  it("quota_exceeded body with non-402 status still maps to QUOTA_EXCEEDED", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/x", status: 400, body: { error: "quota_exceeded" } },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    await expect(client.request("GET", "/x")).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
    });
  });

  it("status 204 → returns null (no JSON parse attempted)", async () => {
    mockHttp([{ method: "POST", path: "/1.5/leads/x/web_fetch", status: 204 }]);
    const client = new LeadbayClient(BASE, "u.test-token");
    await expect(client.request("POST", "/leads/x/web_fetch")).resolves.toBeNull();
  });

  it("2xx body is parsed as JSON", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: { id: "user-1", email: "a@b.com" },
      },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    await expect(client.request("GET", "/users/me")).resolves.toEqual({
      id: "user-1",
      email: "a@b.com",
    });
  });

  it("throws NOT_AUTHENTICATED without a token — no network request", async () => {
    mockHttp([]);
    const client = new LeadbayClient(BASE);
    await expect(client.request("GET", "/lenses")).rejects.toMatchObject({
      code: "NOT_AUTHENTICATED",
    });
  });

  it("requestVoid also enforces auth and 401 handling", async () => {
    const client = new LeadbayClient(BASE);
    await expect(client.requestVoid("POST", "/x")).rejects.toMatchObject({
      code: "NOT_AUTHENTICATED",
    });

    mockHttp([{ method: "POST", path: "/1.5/x", status: 401, body: {} }]);
    const client2 = new LeadbayClient(BASE, "u.test-token");
    await expect(client2.requestVoid("POST", "/x")).rejects.toMatchObject({
      code: "AUTH_EXPIRED",
    });
  });

  it("Content-Type is set only when a body is provided", async () => {
    const { requests } = mockHttp([
      { method: "GET", path: "/1.5/a", status: 200, body: {} },
      { method: "POST", path: "/1.5/b", status: 200, body: {} },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    await client.request("GET", "/a");
    await client.request("POST", "/b", { x: 1 });
    expect(requests[0].headers["Content-Type"]).toBeUndefined();
    expect(requests[1].headers["Content-Type"]).toBe("application/json");
  });
});

describe("LeadbayClient.resolveDefaultLens", () => {
  it("picks is_last_active first", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/lenses",
        status: 200,
        body: [
          { id: 1, name: "A", is_last_active: false, is_default: true },
          { id: 2, name: "B", is_last_active: true, is_default: false },
          { id: 3, name: "C", is_last_active: false, is_default: false },
        ],
      },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    await expect(client.resolveDefaultLens()).resolves.toBe(2);
  });

  it("falls back to is_default when nothing is last_active", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/lenses",
        status: 200,
        body: [
          { id: 1, name: "A", is_last_active: false, is_default: false },
          { id: 2, name: "B", is_last_active: false, is_default: true },
        ],
      },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    await expect(client.resolveDefaultLens()).resolves.toBe(2);
  });

  it("falls back to first lens when no flags set", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/lenses",
        status: 200,
        body: [
          { id: 7, name: "A", is_last_active: false, is_default: false },
          { id: 8, name: "B", is_last_active: false, is_default: false },
        ],
      },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    await expect(client.resolveDefaultLens()).resolves.toBe(7);
  });

  it("empty lens list throws NO_LENS", async () => {
    mockHttp([{ method: "GET", path: "/1.5/lenses", status: 200, body: [] }]);
    const client = new LeadbayClient(BASE, "u.test-token");
    await expect(client.resolveDefaultLens()).rejects.toMatchObject({
      code: "NO_LENS",
    });
  });

  it("caches within 5-minute TTL — second call makes no new HTTP request", async () => {
    const { requests } = mockHttp([
      {
        method: "GET",
        path: "/1.5/lenses",
        status: 200,
        body: [{ id: 42, name: "X", is_last_active: true, is_default: false }],
      },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    await client.resolveDefaultLens();
    await client.resolveDefaultLens();
    expect(requests.length).toBe(1);
  });

  it("re-fetches after 5-minute TTL expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-20T00:00:00Z"));
    const { requests } = mockHttp([
      {
        method: "GET",
        path: "/1.5/lenses",
        status: 200,
        body: [{ id: 1, name: "X", is_last_active: true, is_default: false }],
      },
      {
        method: "GET",
        path: "/1.5/lenses",
        status: 200,
        body: [{ id: 2, name: "Y", is_last_active: true, is_default: false }],
      },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    await expect(client.resolveDefaultLens()).resolves.toBe(1);
    vi.setSystemTime(new Date("2026-04-20T00:06:00Z"));
    await expect(client.resolveDefaultLens()).resolves.toBe(2);
    expect(requests.length).toBe(2);
  });
});

describe("LeadbayClient.resolveOrgId", () => {
  it("caches permanently — second call makes no new HTTP request", async () => {
    const { requests } = mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: { id: "u", email: "a@b.com", organization: { id: "org-1" } },
      },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    await expect(client.resolveOrgId()).resolves.toBe("org-1");
    await expect(client.resolveOrgId()).resolves.toBe("org-1");
    expect(requests.length).toBe(1);
  });
});

describe("LeadbayClient.resolveTasteProfile — partial-result resilience", () => {
  const meBody = {
    id: "u",
    email: "a@b.com",
    organization: { id: "org-1" },
  };

  it("returns full result when all three sub-requests succeed", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: meBody },
      {
        method: "GET",
        path: "/1.5/organizations/org-1/ideal_buyer_profile",
        status: 200,
        body: { summary: "ideal" },
      },
      {
        method: "GET",
        path: "/1.5/organizations/org-1/purchase_intent_tags",
        status: 200,
        body: [{ tag: "buy-now" }],
      },
      {
        method: "GET",
        path: "/1.5/organizations/org-1/ai_agent_questions",
        status: 200,
        body: [{ question: "q1" }],
      },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    const tp = await client.resolveTasteProfile();
    expect(tp.idealBuyerProfile).toEqual({ summary: "ideal" });
    expect(tp.purchaseIntentTags).toHaveLength(1);
    expect(tp.qualificationQuestions).toHaveLength(1);
  });

  it("returns partial result when IBP rejects", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: meBody },
      {
        method: "GET",
        path: "/1.5/organizations/org-1/ideal_buyer_profile",
        status: 404,
        body: {},
      },
      {
        method: "GET",
        path: "/1.5/organizations/org-1/purchase_intent_tags",
        status: 200,
        body: [{ tag: "a" }],
      },
      {
        method: "GET",
        path: "/1.5/organizations/org-1/ai_agent_questions",
        status: 200,
        body: [],
      },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    const tp = await client.resolveTasteProfile();
    expect(tp.idealBuyerProfile).toBeNull();
    expect(tp.purchaseIntentTags).toHaveLength(1);
    expect(tp.qualificationQuestions).toHaveLength(0);
  });
});

describe("LeadbayClient — auth state", () => {
  it("isAuthenticated reflects token state", () => {
    const c = new LeadbayClient(BASE);
    expect(c.isAuthenticated).toBe(false);
    c.setToken("u.new");
    expect(c.isAuthenticated).toBe(true);
  });
});

describe("createClient factory", () => {
  it("resolves US region to the us baseUrl", async () => {
    // No network here — just verify construction
    const { createClient, REGIONS } = await import("../../src/client.js");
    const c = createClient({ token: "tok", region: "us" });
    expect(c.baseUrl).toBe(REGIONS.us);
  });

  it("resolves FR region to the fr baseUrl", async () => {
    const { createClient, REGIONS } = await import("../../src/client.js");
    const c = createClient({ token: "tok", region: "fr" });
    expect(c.baseUrl).toBe(REGIONS.fr);
  });

  it("throws on unknown region (no baseUrl)", async () => {
    const { createClient } = await import("../../src/client.js");
    expect(() => createClient({ region: "xx" as any })).toThrow(/unknown region/);
  });

  it("custom baseUrl overrides region", async () => {
    const { createClient } = await import("../../src/client.js");
    const c = createClient({ baseUrl: "https://staging.example.com", region: "us" });
    expect(c.baseUrl).toBe("https://staging.example.com");
  });
});
