/**
 * Unit tests for OAuth helpers in src/oauth.ts.
 *
 * Strategy:
 *   - PKCE/state-formatting tests touch crypto directly (no I/O).
 *   - Loopback listener tests bind a real port on 127.0.0.1 and hit it with
 *     plain fetch — that's the fastest way to verify the state-validation
 *     and error-redirect branches end-to-end.
 *   - Discovery / register / token tests mock node:https via the existing
 *     harness so we exercise httpsCall() without touching the network.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import {
  generatePkce,
  fetchDiscoveryDoc,
  registerClient,
  startLoopbackListener,
  exchangeCodeForToken,
  oauthLogin,
  inferRegionViaStargate,
} from "../src/oauth.js";

beforeEach(() => {
  resetHttpMock();
});

describe("generatePkce", () => {
  it("produces a verifier and an S256 challenge that matches sha256(verifier)", () => {
    const { verifier, challenge, method } = generatePkce();
    expect(method).toBe("S256");
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    const expectedChallenge = createHash("sha256")
      .update(verifier, "ascii")
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(challenge).toBe(expectedChallenge);
  });

  it("returns a fresh pair on each call", () => {
    const a = generatePkce();
    const b = generatePkce();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(b.challenge);
  });
});

describe("fetchDiscoveryDoc", () => {
  it("parses a well-formed discovery doc", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/.well-known/oauth-authorization-server",
        status: 200,
        body: {
          issuer: "https://api-fr-staging.leadbay.app",
          authorization_endpoint: "https://staging.leadbay.app/oauth/authorize",
          token_endpoint: "https://api-fr-staging.leadbay.app/1.6/oauth/token",
          registration_endpoint: "https://api-fr-staging.leadbay.app/1.6/oauth/register",
          code_challenge_methods_supported: ["S256", "plain"],
        },
      },
    ]);
    const doc = await fetchDiscoveryDoc("https://staging.api.leadbay.app");
    expect(doc.issuer).toBe("https://api-fr-staging.leadbay.app");
    expect(doc.authorization_endpoint).toBe("https://staging.leadbay.app/oauth/authorize");
  });

  it("rejects a 404 with a clear message about deployment", async () => {
    mockHttp([
      { method: "GET", path: "/.well-known/oauth-authorization-server", status: 404, body: "" },
    ]);
    await expect(fetchDiscoveryDoc("https://api-fr.leadbay.app")).rejects.toThrow(
      /OAuth discovery failed.*404/
    );
  });

  it("rejects a doc missing required fields", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/.well-known/oauth-authorization-server",
        status: 200,
        body: { issuer: "x", authorization_endpoint: "y" /* missing token + registration */ },
      },
    ]);
    await expect(fetchDiscoveryDoc("https://x.example")).rejects.toThrow(
      /missing required field/
    );
  });

  it("rejects a server that doesn't support S256", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/.well-known/oauth-authorization-server",
        status: 200,
        body: {
          issuer: "x",
          authorization_endpoint: "y",
          token_endpoint: "z",
          registration_endpoint: "w",
          code_challenge_methods_supported: ["plain"],
        },
      },
    ]);
    await expect(fetchDiscoveryDoc("https://x.example")).rejects.toThrow(/S256/);
  });
});

describe("registerClient", () => {
  it("posts the DCR payload with token_endpoint_auth_method=none and parses the client_id", async () => {
    const captured = mockHttp([
      {
        method: "POST",
        path: "/1.6/oauth/register",
        status: 201,
        body: {
          client_id: "42",
          client_name: "Leadbay MCP @ test-host",
          redirect_uris: ["http://127.0.0.1:54321/callback"],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code"],
          response_types: ["code"],
        },
      },
    ]);
    const result = await registerClient(
      "https://api-fr-staging.leadbay.app/1.6/oauth/register",
      { clientName: "Leadbay MCP @ test-host", redirectUri: "http://127.0.0.1:54321/callback" }
    );
    expect(result.client_id).toBe("42");
    const req = captured.requests.find((r) => r.path === "/1.6/oauth/register");
    expect(req).toBeDefined();
    const parsed = JSON.parse(req!.body!);
    expect(parsed.token_endpoint_auth_method).toBe("none");
    expect(parsed.redirect_uris).toEqual(["http://127.0.0.1:54321/callback"]);
    expect(parsed.client_name).toBe("Leadbay MCP @ test-host");
  });

  it("surfaces 429 rate limit with a usable error message", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/oauth/register", status: 429, body: "" },
    ]);
    await expect(
      registerClient("https://x.example/1.6/oauth/register", {
        clientName: "x",
        redirectUri: "http://127.0.0.1:1/callback",
      })
    ).rejects.toThrow(/rate-limited/);
  });
});

describe("exchangeCodeForToken", () => {
  it("posts form-urlencoded with code_verifier and returns access_token", async () => {
    const captured = mockHttp([
      {
        method: "POST",
        path: "/1.6/oauth/token",
        status: 200,
        body: { access_token: "o.abc123", token_type: "Bearer" },
      },
    ]);
    const { accessToken } = await exchangeCodeForToken({
      tokenEndpoint: "https://api-fr-staging.leadbay.app/1.6/oauth/token",
      code: "the-code",
      codeVerifier: "the-verifier",
      clientId: "42",
      redirectUri: "http://127.0.0.1:5555/callback",
    });
    expect(accessToken).toBe("o.abc123");
    const req = captured.requests.find((r) => r.path === "/1.6/oauth/token")!;
    expect(req.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(req.body).toContain("grant_type=authorization_code");
    expect(req.body).toContain("code=the-code");
    expect(req.body).toContain("code_verifier=the-verifier");
    expect(req.body).toContain("client_id=42");
  });

  it("rejects a non-200 response with status detail", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.6/oauth/token",
        status: 400,
        body: { error: "invalid_grant" },
      },
    ]);
    await expect(
      exchangeCodeForToken({
        tokenEndpoint: "https://x.example/1.6/oauth/token",
        code: "x",
        codeVerifier: "x",
        clientId: "1",
        redirectUri: "http://127.0.0.1:1/callback",
      })
    ).rejects.toThrow(/400.*invalid_grant/);
  });
});

describe("startLoopbackListener", () => {
  it("delivers a matching state's code via waitForCallback", async () => {
    const listener = await startLoopbackListener({
      expectedState: "the-state",
      timeoutMs: 5000,
    });
    try {
      const url = `${listener.redirectUri}?code=the-code&state=the-state`;
      // Drive the browser-side hit asynchronously.
      void fetch(url);
      const result = await listener.waitForCallback();
      expect(result.code).toBe("the-code");
      expect(result.state).toBe("the-state");
    } finally {
      listener.close();
    }
  });

  it("rejects on state mismatch (CSRF defense)", async () => {
    const listener = await startLoopbackListener({
      expectedState: "expected",
      timeoutMs: 5000,
    });
    try {
      void fetch(`${listener.redirectUri}?code=x&state=wrong`);
      await expect(listener.waitForCallback()).rejects.toThrow(/state mismatch/);
    } finally {
      listener.close();
    }
  });

  it("rejects when the authorize endpoint returns ?error=access_denied", async () => {
    const listener = await startLoopbackListener({
      expectedState: "s",
      timeoutMs: 5000,
    });
    try {
      void fetch(`${listener.redirectUri}?error=access_denied&state=s`);
      await expect(listener.waitForCallback()).rejects.toThrow(/access_denied/);
    } finally {
      listener.close();
    }
  });

  it("404s non-/callback paths so favicon probes don't fire the resolver", async () => {
    const listener = await startLoopbackListener({
      expectedState: "s",
      timeoutMs: 5000,
    });
    try {
      // Prefetches and favicon probes are pure noise — they must NOT resolve.
      const probe = await fetch(`${listener.redirectUri.replace("/callback", "/favicon.ico")}`);
      expect(probe.status).toBe(404);

      // Real callback still works after the probe.
      void fetch(`${listener.redirectUri}?code=x&state=s`);
      const result = await listener.waitForCallback();
      expect(result.code).toBe("x");
    } finally {
      listener.close();
    }
  });

  it("times out cleanly if the callback never arrives", async () => {
    const listener = await startLoopbackListener({
      expectedState: "s",
      timeoutMs: 50,
    });
    try {
      await expect(listener.waitForCallback()).rejects.toThrow(/timed out/);
    } finally {
      listener.close();
    }
  });
});

describe("inferRegionViaStargate", () => {
  it("maps US → us", async () => {
    mockHttp([{ method: "GET", path: "/1.0/user_info", status: 200, body: { userCountry: "US" } }]);
    expect(await inferRegionViaStargate({ staging: false })).toBe("us");
  });

  it("maps FR → fr", async () => {
    mockHttp([{ method: "GET", path: "/1.0/user_info", status: 200, body: { userCountry: "FR" } }]);
    expect(await inferRegionViaStargate({ staging: false })).toBe("fr");
  });

  it.each(["GP", "MQ", "GF", "RE", "YT", "PM", "PF", "NC", "WF"])(
    "maps French overseas territory %s → fr",
    async (country) => {
      mockHttp([{ method: "GET", path: "/1.0/user_info", status: 200, body: { userCountry: country } }]);
      expect(await inferRegionViaStargate({ staging: false })).toBe("fr");
    }
  );

  it("rejects unmapped countries with a clear --region hint", async () => {
    mockHttp([{ method: "GET", path: "/1.0/user_info", status: 200, body: { userCountry: "JP" } }]);
    await expect(inferRegionViaStargate({ staging: false })).rejects.toThrow(
      /JP.*--region/
    );
  });

  it("surfaces a non-200 with a usable error", async () => {
    mockHttp([{ method: "GET", path: "/1.0/user_info", status: 503, body: "" }]);
    await expect(inferRegionViaStargate({ staging: false })).rejects.toThrow(/503/);
  });
});

describe("oauthLogin end-to-end (mocked)", () => {
  it("walks discovery → register → browser → callback → token", async () => {
    const captured = mockHttp([
      {
        method: "GET",
        path: "/.well-known/oauth-authorization-server",
        status: 200,
        body: {
          issuer: "https://api-fr-staging.leadbay.app",
          authorization_endpoint: "https://staging.leadbay.app/oauth/authorize",
          token_endpoint: "https://api-fr-staging.leadbay.app/1.6/oauth/token",
          registration_endpoint: "https://api-fr-staging.leadbay.app/1.6/oauth/register",
          code_challenge_methods_supported: ["S256"],
        },
      },
      {
        method: "POST",
        path: "/1.6/oauth/register",
        status: 201,
        body: {
          client_id: "7",
          redirect_uris: [],
          token_endpoint_auth_method: "none",
        },
      },
      {
        method: "POST",
        path: "/1.6/oauth/token",
        status: 200,
        body: { access_token: "o.fullflow", token_type: "Bearer" },
      },
    ]);

    // Stand-in for the browser: as soon as oauthLogin calls openBrowser(), we
    // parse the URL and POST back to the loopback redirect_uri with code+state.
    const fakeBrowser = async (authorizeUrl: string) => {
      const u = new URL(authorizeUrl);
      const redirect = u.searchParams.get("redirect_uri")!;
      const state = u.searchParams.get("state")!;
      // Drive the callback in the next tick so the listener's
      // waitForCallback() promise is the one awaiting it.
      setImmediate(() => {
        void fetch(`${redirect}?code=fake-code&state=${state}`);
      });
    };

    const result = await oauthLogin({
      authServerBaseUrl: "https://staging.api.leadbay.app",
      clientName: "Leadbay MCP @ test",
      openBrowser: fakeBrowser,
      timeoutMs: 10_000,
    });

    expect(result.accessToken).toBe("o.fullflow");

    // PKCE round-trip: the code_verifier sent in token exchange must, when
    // SHA256+base64url'd, equal the code_challenge that the listener accepted
    // (implicitly — we just check the token endpoint received a non-empty
    // verifier paired with the right client_id).
    const tokenReq = captured.requests.find((r) => r.path === "/1.6/oauth/token")!;
    expect(tokenReq.body).toContain("code=fake-code");
    expect(tokenReq.body).toContain("client_id=7");
    expect(tokenReq.body).toMatch(/code_verifier=[A-Za-z0-9_-]+/);
  });
});
