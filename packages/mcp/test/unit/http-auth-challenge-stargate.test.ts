// Hosted-MCP challenge behavior under the Stargate-centered flow (new-file
// coverage; the base per-region cases stay in http-auth-challenge.test.ts).
//
// Two things this PR must guarantee:
//   1. A rejected/expired bearer produces the RFC 6750 invalid_token challenge so
//      the host silently refreshes (the single-region probe surfaces it at /mcp).
//   2. The README's EU connector URL /fr/mcp keeps working as an alias of /mcp.

import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { app } from "../../src/http-server.js";

beforeEach(() => resetHttpMock());

function initRequest(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
}

describe("hosted MCP challenge — Stargate flow", () => {
  it("POST /mcp with a valid region-suffixed token → auth passes, handler proceeds (no challenge)", async () => {
    // NOTE: app.fetch has no Node adapter env (c.env.incoming), so the MCP transport
    // can't finish and Hono returns 500 AFTER auth — a bare `not.toBe(401)` would
    // pass even on an auth failure. So we assert auth actually SUCCEEDED: the
    // validation probe was consumed against the token's region and it returned 200,
    // and NO OAuth challenge (401 / www-authenticate) was emitted. That the request
    // then dies in the transport (no Node env) is out of scope for the auth path.
    const { requests } = mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: { id: "u1" } }]);
    const res = await app.fetch(
      initRequest("https://mcp.test/mcp", { authorization: "Bearer o.sometoken_fr" })
    );
    expect(requests).toHaveLength(1); // the validation probe ran…
    expect(requests[0].url).toContain("api-fr"); // …against the FR backend (the _fr suffix)
    expect(res.status).not.toBe(401); // not an auth challenge
    expect(res.headers.get("www-authenticate")).toBeNull();
  });

  it("POST /mcp with an expired/rejected token → 401 + error=invalid_token challenge", async () => {
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 401, body: {} }]);
    const res = await app.fetch(
      initRequest("https://mcp.test/mcp", { authorization: "Bearer o.staletoken_fr" })
    );
    expect(res.status).toBe(401);
    const wwwAuth = res.headers.get("www-authenticate") ?? "";
    expect(wwwAuth).toContain('error="invalid_token"');
    expect(wwwAuth).toContain("resource_metadata=");
  });

  it("POST /fr/mcp (EU compat alias) is routed (not 404) and passes auth for a valid token", async () => {
    // The alias must resolve to the connector handler (not 404) AND clear auth. Same
    // no-Node-env caveat as above → assert the probe ran + no challenge, not a 200.
    const { requests } = mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: { id: "u1" } }]);
    const res = await app.fetch(
      initRequest("https://mcp.test/fr/mcp", { authorization: "Bearer o.sometoken_fr" })
    );
    expect(res.status).not.toBe(404); // the alias route exists
    expect(requests).toHaveLength(1); // reached auth resolution + probed
    expect(res.status).not.toBe(401);
    expect(res.headers.get("www-authenticate")).toBeNull();
  });

  it("POST /fr/mcp with an untagged legacy FR token → probes FR first, passes (no 401)", async () => {
    // The /fr/mcp alias hints preferRegion=fr, so a legacy EU token with no suffix
    // is validated against FR first and resolves without a wasted US round-trip —
    // and is NOT falsely forced through re-auth (Codex P1).
    const { requests } = mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: { id: "u1" } }]);
    const res = await app.fetch(
      initRequest("https://mcp.test/fr/mcp", { authorization: "Bearer o.legacyfrtoken" })
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("api-fr"); // FR probed first via the alias hint
    expect(res.status).not.toBe(401);
    expect(res.headers.get("www-authenticate")).toBeNull();
  });

  it("POST /fr/mcp with no token → 401 challenge pointing at /fr/mcp metadata", async () => {
    mockHttp([]);
    const res = await app.fetch(initRequest("https://mcp.test/fr/mcp"));
    expect(res.status).toBe(401);
    const wwwAuth = res.headers.get("www-authenticate") ?? "";
    expect(wwwAuth).toContain('Bearer realm="mcp"');
    expect(wwwAuth).toContain(
      'resource_metadata="https://mcp.test/.well-known/oauth-protected-resource/fr/mcp"'
    );
  });
});
