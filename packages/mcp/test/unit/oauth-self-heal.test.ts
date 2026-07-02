/**
 * OAuth self-heal on a rejected cached client_id (product#3838 — "Fix Mac Auth bug").
 *
 * Root cause: `oauthLogin` reused a cached DCR client_id and sent it to the
 * backend /authorize with no recovery. When the backend rejects that cached id
 * (stale / GC'd registration, or a redirect_uri that no longer matches), the
 * user lands on the backend's own "Something went wrong. Please try again."
 * page and the loopback either gets `?error=` or never gets a callback — and
 * the flow never re-registers.
 *
 * Fix pinned here: a cached-client attempt that fails with a callback error OR
 * a (short) first-attempt timeout is retried ONCE with a fresh registration.
 * The 429-avoidance guarantee is preserved — a working cached id never
 * re-registers, and a no-cache first failure is not retried.
 *
 * New file — models the `oauthLogin end-to-end (mocked)` test in
 * ../oauth.test.ts (which is left untouched). The harness matches scripts by
 * (method, path) and consumes each once, so TWO `/register` scripts are needed
 * to allow a re-registration.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import {
  oauthLogin,
  isCachedClientRejection,
  OAuthCallbackError,
  OAuthTimeoutError,
} from "../../src/oauth.js";

beforeEach(() => {
  resetHttpMock();
});

const DISCOVERY = {
  method: "GET" as const,
  path: "/.well-known/oauth-authorization-server",
  status: 200,
  body: {
    issuer: "https://api-us.leadbay.app",
    authorization_endpoint: "https://leadbay.app/oauth/authorize",
    token_endpoint: "https://api-us.leadbay.app/1.6/oauth/token",
    registration_endpoint: "https://api-us.leadbay.app/1.6/oauth/register",
    code_challenge_methods_supported: ["S256"],
  },
};
const registerScript = (clientId: string) => ({
  method: "POST" as const,
  path: "/1.6/oauth/register",
  status: 201,
  body: { client_id: clientId, redirect_uris: [], token_endpoint_auth_method: "none" },
});
const TOKEN = {
  method: "POST" as const,
  path: "/1.6/oauth/token",
  status: 200,
  body: { access_token: "o.healed", token_type: "Bearer" },
};

const registerCount = (reqs: { path: string }[]) =>
  reqs.filter((r) => r.path.endsWith("/oauth/register")).length;

describe("oauthLogin self-heal — cached client_id rejected via ?error=", () => {
  it("re-registers once and succeeds; onCachedClientRejected fires once", async () => {
    const captured = mockHttp([DISCOVERY, registerScript("fresh-9"), TOKEN]);
    const registered: Array<{ id: string; port: number }> = [];
    const rejected: Array<{ port: number }> = [];

    // First open carries the STALE cached id → simulate the backend rejecting
    // it by driving the callback with ?error=. The retry mints a fresh id →
    // POST the code.
    const fakeBrowser = async (authorizeUrl: string) => {
      const u = new URL(authorizeUrl);
      const redirect = u.searchParams.get("redirect_uri")!;
      const state = u.searchParams.get("state")!;
      const clientId = u.searchParams.get("client_id");
      setImmediate(() => {
        if (clientId === "stale-id") {
          void fetch(`${redirect}?error=access_denied&error_description=redirect+not+authorized&state=${state}`);
        } else {
          void fetch(`${redirect}?code=fake-code&state=${state}`);
        }
      });
    };

    const result = await oauthLogin({
      authServerBaseUrl: "https://api-us.leadbay.app",
      clientName: "Leadbay MCP @ test",
      openBrowser: fakeBrowser,
      timeoutMs: 5_000,
      getCachedClientId: () => "stale-id",
      onClientRegistered: (id, port) => registered.push({ id, port }),
      onCachedClientRejected: (port) => rejected.push({ port }),
    });

    expect(result.accessToken).toBe("o.healed");
    expect(registerCount(captured.requests)).toBe(1); // exactly one re-registration
    expect(registered).toHaveLength(1);
    expect(registered[0].id).toBe("fresh-9");
    expect(rejected).toHaveLength(1);
    // The token exchange used the FRESH id, not the stale one.
    const tokenReq = captured.requests.find((r) => r.path.endsWith("/oauth/token"))!;
    expect(tokenReq.body).toContain("client_id=fresh-9");
  });
});

describe("oauthLogin self-heal — cached client_id works", () => {
  it("does NOT re-register (429-avoidance preserved)", async () => {
    // NO /register script at all: if the code tried to register, it would fail
    // with "no script matched" and the test would throw.
    const captured = mockHttp([DISCOVERY, TOKEN]);
    const registered: string[] = [];
    const rejected: number[] = [];

    const fakeBrowser = async (authorizeUrl: string) => {
      const u = new URL(authorizeUrl);
      const redirect = u.searchParams.get("redirect_uri")!;
      const state = u.searchParams.get("state")!;
      setImmediate(() => void fetch(`${redirect}?code=ok&state=${state}`));
    };

    const result = await oauthLogin({
      authServerBaseUrl: "https://api-us.leadbay.app",
      clientName: "Leadbay MCP @ test",
      openBrowser: fakeBrowser,
      timeoutMs: 5_000,
      getCachedClientId: () => "good-id",
      onClientRegistered: (id) => registered.push(id),
      onCachedClientRejected: (port) => rejected.push(port),
    });

    expect(result.accessToken).toBe("o.healed");
    expect(registerCount(captured.requests)).toBe(0);
    expect(registered).toHaveLength(0);
    expect(rejected).toHaveLength(0);
    const tokenReq = captured.requests.find((r) => r.path.endsWith("/oauth/token"))!;
    expect(tokenReq.body).toContain("client_id=good-id");
  });
});

describe("oauthLogin self-heal — cached client_id silent hang (short first timeout)", () => {
  it("times out the short first attempt, re-registers, and succeeds", async () => {
    const captured = mockHttp([DISCOVERY, registerScript("fresh-2"), TOKEN]);
    const rejected: number[] = [];

    // First open (stale id) does NOTHING — simulate the user stranded on the
    // backend error page, no callback ever arrives. The short 30ms first-
    // attempt window fires an OAuthTimeoutError → self-heal → second open POSTs.
    const fakeBrowser = async (authorizeUrl: string) => {
      const u = new URL(authorizeUrl);
      const clientId = u.searchParams.get("client_id");
      if (clientId === "stale-id") return; // no callback
      const redirect = u.searchParams.get("redirect_uri")!;
      const state = u.searchParams.get("state")!;
      setImmediate(() => void fetch(`${redirect}?code=late&state=${state}`));
    };

    const result = await oauthLogin({
      authServerBaseUrl: "https://api-us.leadbay.app",
      clientName: "Leadbay MCP @ test",
      openBrowser: fakeBrowser,
      timeoutMs: 5_000,
      cachedFirstAttemptTimeoutMs: 30,
      getCachedClientId: () => "stale-id",
      onCachedClientRejected: (port) => rejected.push(port),
    });

    expect(result.accessToken).toBe("o.healed");
    expect(registerCount(captured.requests)).toBe(1);
    expect(rejected).toHaveLength(1);
  });
});

describe("oauthLogin self-heal — no cache, first attempt fails", () => {
  it("does NOT retry (single registration, no 429 storm)", async () => {
    // Only ONE /register script — a second registration would fail to match.
    const captured = mockHttp([DISCOVERY, registerScript("only-1")]);
    const rejected: number[] = [];

    const fakeBrowser = async (authorizeUrl: string) => {
      const u = new URL(authorizeUrl);
      const redirect = u.searchParams.get("redirect_uri")!;
      const state = u.searchParams.get("state")!;
      setImmediate(() => void fetch(`${redirect}?error=access_denied&state=${state}`));
    };

    await expect(
      oauthLogin({
        authServerBaseUrl: "https://api-us.leadbay.app",
        clientName: "Leadbay MCP @ test",
        openBrowser: fakeBrowser,
        timeoutMs: 5_000,
        getCachedClientId: () => undefined, // no cache → first attempt registers fresh
        onCachedClientRejected: (port) => rejected.push(port),
      })
    ).rejects.toBeInstanceOf(OAuthCallbackError);

    expect(registerCount(captured.requests)).toBe(1); // no wasteful re-register
    expect(rejected).toHaveLength(0); // self-heal never triggered
  });
});

describe("isCachedClientRejection", () => {
  it("recognizes callback and timeout errors", () => {
    expect(isCachedClientRejection(new OAuthCallbackError("denied"))).toBe(true);
    expect(isCachedClientRejection(new OAuthTimeoutError("timed out"))).toBe(true);
  });

  it("does NOT recognize registration / discovery / generic errors", () => {
    expect(isCachedClientRejection(new Error("registration rate-limited (429)"))).toBe(false);
    expect(isCachedClientRejection(new Error("OAuth discovery failed: 404"))).toBe(false);
    expect(isCachedClientRejection("some string")).toBe(false);
    expect(isCachedClientRejection(undefined)).toBe(false);
  });
});
