/**
 * Unit tests for LeadbayClient.
 *
 * The error-mapping table, caching semantics, selection Mutex, and
 * region-propagated error envelopes are the primary value here.
 *
 * 2026-04-20: the mapping table was updated so 429 → QUOTA_EXCEEDED (production
 * emits 429 for quota, not 402). 402 still maps to QUOTA_EXCEEDED for legacy
 * compatibility. This change was flagged by the /autoplan review — both
 * Codex-eng and Codex-DX independently spotted that the old test at line 36
 * asserted 429→RATE_LIMITED and would silently invalidate the plan's mapping
 * change. The new assertion IS the contract.
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
  const cases: Array<[number, string, object | string | undefined, string]> = [
    [401, "AUTH_EXPIRED", { message: "expired" }, "regenerate"],
    // Quota: 429 is canonical (production), 402 kept for legacy.
    [429, "QUOTA_EXCEEDED", {}, "Wait"],
    [402, "QUOTA_EXCEEDED", { message: "no credits" }, "retry"],
    [403, "BILLING_SUSPENDED", { message: "account suspended" }, "billing"],
    [403, "FORBIDDEN", { message: "forbidden" }, "permissions"],
    [404, "NOT_FOUND", { message: "nope" }, "ID is correct"],
    [500, "API_ERROR", { message: "boom" }, "Try again"],
    [500, "API_ERROR", "not-json-body", "Try again"],
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

  it("quota_exceeded body with non-429 status still maps to QUOTA_EXCEEDED", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/x", status: 400, body: { error: "quota_exceeded" } },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    await expect(client.request("GET", "/x")).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
    });
  });

  it("error envelope carries _meta with region + endpoint", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/lenses", status: 404, body: { message: "no" } },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token", "us");
    try {
      await client.request("GET", "/lenses");
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err._meta).toBeDefined();
      expect(err._meta.region).toBe("us");
      expect(err._meta.endpoint).toBe("/lenses");
    }
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
        body: { id: "user-1", email: "a@b.com", organization: { id: "org-1", name: "X" } },
      },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    await expect(client.request("GET", "/users/me")).resolves.toMatchObject({
      id: "user-1",
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
  it("prefers me.last_requested_lens when set", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: {
          id: "u", email: "a@b.com",
          organization: { id: "org-1", name: "X" },
          last_requested_lens: 77,
        },
      },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    await expect(client.resolveDefaultLens()).resolves.toBe(77);
  });

  it("falls back to /lenses scan when me.last_requested_lens is null", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: {
          id: "u", email: "a@b.com",
          organization: { id: "org-1", name: "X" },
          last_requested_lens: null,
        },
      },
      {
        method: "GET",
        path: "/1.5/lenses",
        status: 200,
        body: [
          { id: 1, name: "A", is_last_active: false, is_default: true },
          { id: 2, name: "B", is_last_active: true, is_default: false },
        ],
      },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    await expect(client.resolveDefaultLens()).resolves.toBe(2);
  });

  it("empty lens list throws NO_LENS", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: {
          id: "u", organization: { id: "org-1", name: "X" },
          last_requested_lens: null,
        },
      },
      { method: "GET", path: "/1.5/lenses", status: 200, body: [] },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    await expect(client.resolveDefaultLens()).rejects.toMatchObject({
      code: "NO_LENS",
    });
  });
});

describe("LeadbayClient.resolveMe — 60s TTL + invalidateMe", () => {
  const meBody = {
    id: "u",
    email: "a@b.com",
    organization: { id: "org-1", name: "X" },
    last_requested_lens: 42,
  };

  it("caches within 60s TTL", async () => {
    const { requests } = mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: meBody },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    await client.resolveMe();
    await client.resolveMe();
    expect(requests.length).toBe(1);
  });

  it("invalidateMe() forces next call to re-fetch", async () => {
    const { requests } = mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: meBody },
      { method: "GET", path: "/1.5/users/me", status: 200, body: { ...meBody, last_requested_lens: 99 } },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    const first = await client.resolveMe();
    expect(first.last_requested_lens).toBe(42);
    client.invalidateMe();
    const second = await client.resolveMe();
    expect(second.last_requested_lens).toBe(99);
    expect(requests.length).toBe(2);
  });

  it("re-fetches after 60s TTL expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-20T00:00:00Z"));
    const { requests } = mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: meBody },
      { method: "GET", path: "/1.5/users/me", status: 200, body: meBody },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    await client.resolveMe();
    vi.setSystemTime(new Date("2026-04-20T00:02:00Z")); // 2 min later
    await client.resolveMe();
    expect(requests.length).toBe(2);
  });

  it("resolveOrgId() now flows through resolveMe cache", async () => {
    const { requests } = mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: meBody },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    await expect(client.resolveOrgId()).resolves.toBe("org-1");
    await expect(client.resolveOrgId()).resolves.toBe("org-1");
    expect(requests.length).toBe(1);
  });
});

describe("Granular write tools invalidate /me cache", () => {
  // Regression: setUserPrompt / clearUserPrompt / pickClarification /
  // dismissClarification mutate organization.computing_intelligence on /me.
  // If they don't invalidateMe(), accountStatus / refine-prompt polling
  // will read a stale (computing_intelligence: false) snapshot for up to 60s.
  it("setUserPrompt invalidates /me cache", async () => {
    const { setUserPrompt } = await import("../../src/tools/set-user-prompt.js");
    const { requests } = mockHttp([
      // resolveOrgId pulls /me first
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: {
          id: "u",
          organization: { id: "org-1", name: "X", computing_intelligence: false },
          last_requested_lens: 1,
        },
      },
      // Then the POST /user_prompt
      {
        method: "POST",
        path: "/1.5/organizations/org-1/user_prompt",
        status: 204,
      },
      // Subsequent resolveMe MUST hit the network again — this script catches the regression.
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: {
          id: "u",
          organization: { id: "org-1", name: "X", computing_intelligence: true },
          last_requested_lens: 1,
        },
      },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    await setUserPrompt.execute(client, { prompt: "test" });
    const me = await client.resolveMe();
    expect(me.organization.computing_intelligence).toBe(true);
    // Two /me requests = cache was correctly invalidated.
    const meReqs = requests.filter((r) => r.path === "/1.5/users/me");
    expect(meReqs.length).toBe(2);
  });

  it("clearUserPrompt invalidates /me cache", async () => {
    const { clearUserPrompt } = await import("../../src/tools/clear-user-prompt.js");
    const { requests } = mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: { id: "u", organization: { id: "org-1", name: "X", computing_intelligence: false } },
      },
      { method: "DELETE", path: "/1.5/organizations/org-1/user_prompt", status: 204 },
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: { id: "u", organization: { id: "org-1", name: "X", computing_intelligence: true } },
      },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    await clearUserPrompt.execute(client, {});
    await client.resolveMe();
    expect(requests.filter((r) => r.path === "/1.5/users/me").length).toBe(2);
  });

  it("pickClarification invalidates /me cache", async () => {
    const { pickClarification } = await import("../../src/tools/pick-clarification.js");
    const { requests } = mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: { id: "u", organization: { id: "org-1", name: "X" } },
      },
      { method: "POST", path: "/1.5/organizations/org-1/pick_clarification", status: 204 },
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: { id: "u", organization: { id: "org-1", name: "X" } },
      },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    await pickClarification.execute(client, { option_id: "opt-1" });
    await client.resolveMe();
    expect(requests.filter((r) => r.path === "/1.5/users/me").length).toBe(2);
  });

  it("dismissClarification invalidates /me cache", async () => {
    const { dismissClarification } = await import("../../src/tools/dismiss-clarification.js");
    const { requests } = mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: { id: "u", organization: { id: "org-1", name: "X" } },
      },
      { method: "POST", path: "/1.5/organizations/org-1/dismiss_clarification", status: 204 },
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: { id: "u", organization: { id: "org-1", name: "X" } },
      },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    await dismissClarification.execute(client, {});
    await client.resolveMe();
    expect(requests.filter((r) => r.path === "/1.5/users/me").length).toBe(2);
  });
});

describe("user_prompt POST body shape (contract pin — #3508)", () => {
  // Backend's UserPromptPayload is kotlinx.serialization @SerialName("user_prompt");
  // strict deserialization rejects { prompt: ... }. These tests pin the wire key
  // so the contract bug can't silently reappear.
  it("setUserPrompt sends { user_prompt }, not { prompt }", async () => {
    const { setUserPrompt } = await import("../../src/tools/set-user-prompt.js");
    const { requests } = mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: {
          id: "u",
          organization: { id: "org-1", name: "X", computing_intelligence: false },
        },
      },
      { method: "POST", path: "/1.5/organizations/org-1/user_prompt", status: 204 },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    await setUserPrompt.execute(client, { prompt: "focus on hospitals" });
    const post = requests.find(
      (r) => r.method === "POST" && r.path === "/1.5/organizations/org-1/user_prompt"
    );
    expect(post?.body).toBeDefined();
    const parsed = JSON.parse(post!.body!);
    expect(parsed).toEqual({ user_prompt: "focus on hospitals" });
    expect(parsed).not.toHaveProperty("prompt");
  });

  it("refinePrompt sends { user_prompt }, not { prompt }", async () => {
    const { refinePrompt } = await import("../../src/composite/refine-prompt.js");
    const { requests } = mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: {
          id: "u",
          admin: true,
          organization: { id: "org-1", name: "X", computing_intelligence: false },
        },
      },
      { method: "POST", path: "/1.5/organizations/org-1/user_prompt", status: 204 },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    // clarification_poll_attempts: 0 skips the poll loop entirely.
    await refinePrompt.execute(client, {
      prompt: "focus on hospitals",
      clarification_poll_attempts: 0,
    });
    const post = requests.find(
      (r) => r.method === "POST" && r.path === "/1.5/organizations/org-1/user_prompt"
    );
    expect(post?.body).toBeDefined();
    const parsed = JSON.parse(post!.body!);
    expect(parsed).toEqual({ user_prompt: "focus on hospitals" });
    expect(parsed).not.toHaveProperty("prompt");
  });

  it("refinePrompt dry_run preview uses user_prompt key", async () => {
    const { refinePrompt } = await import("../../src/composite/refine-prompt.js");
    mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: {
          id: "u",
          admin: true,
          organization: { id: "org-1", name: "X" },
        },
      },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token");
    const res: any = await refinePrompt.execute(client, {
      prompt: "p",
      dry_run: true,
    });
    expect(res.would_call.body).toEqual({ user_prompt: "p" });
  });
});

describe("LeadbayClient.acquireSelectionLock — Mutex", () => {
  it("serialises concurrent selection holders", async () => {
    const client = new LeadbayClient(BASE, "u.test-token");
    const order: string[] = [];

    async function holder(id: string, ms: number) {
      await client.acquireSelectionLock();
      order.push(`${id}:acq`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${id}:rel`);
      client.releaseSelectionLock();
    }

    await Promise.all([holder("A", 20), holder("B", 10), holder("C", 5)]);

    // Each holder must release before the next acquires.
    expect(order).toEqual([
      "A:acq", "A:rel",
      "B:acq", "B:rel",
      "C:acq", "C:rel",
    ]);
  });
});

describe("LeadbayClient.setBaseUrl + region getter", () => {
  it("setBaseUrl updates region and invalidates caches", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: { id: "u", organization: { id: "org-us", name: "X" }, last_requested_lens: 10 },
      },
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: { id: "u2", organization: { id: "org-fr", name: "Y" }, last_requested_lens: 20 },
      },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token", "us");
    expect(client.region).toBe("us");
    const first = await client.resolveMe();
    expect(first.organization.id).toBe("org-us");

    client.setBaseUrl("https://api-fr.leadbay.app", "fr");
    expect(client.region).toBe("fr");
    const second = await client.resolveMe();
    expect(second.organization.id).toBe("org-fr");
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
    const { createClient, REGIONS } = await import("../../src/client.js");
    const c = createClient({ token: "tok", region: "us" });
    expect(c.baseUrl).toBe(REGIONS.us);
    expect(c.region).toBe("us");
  });

  it("resolves FR region to the fr baseUrl", async () => {
    const { createClient, REGIONS } = await import("../../src/client.js");
    const c = createClient({ token: "tok", region: "fr" });
    expect(c.baseUrl).toBe(REGIONS.fr);
    expect(c.region).toBe("fr");
  });

  it("throws on unknown region (no baseUrl)", async () => {
    const { createClient } = await import("../../src/client.js");
    expect(() => createClient({ region: "xx" as any })).toThrow(/unknown region/);
  });

  it("custom baseUrl keeps the explicit region tag", async () => {
    // region is a user-facing label (e.g. "which Leadbay account backend?").
    // If they set region:"us" + a custom baseUrl (probably a staging of the
    // US backend), respect the explicit region tag.
    const { createClient } = await import("../../src/client.js");
    const c = createClient({ baseUrl: "https://staging.example.com", region: "us" });
    expect(c.baseUrl).toBe("https://staging.example.com");
    expect(c.region).toBe("us");
  });

  it("custom baseUrl with no region → region=custom (inferred from unknown host)", async () => {
    const { LeadbayClient } = await import("../../src/client.js");
    const c = new LeadbayClient("https://staging.example.com", "tok");
    expect(c.region).toBe("custom");
  });
});
