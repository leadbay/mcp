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

describe("hosted MCP OAuth challenge", () => {
  it("POST /mcp with no token → 401 + WWW-Authenticate pointing at /mcp metadata", async () => {
    mockHttp([]); // no token → no backend call
    const res = await app.fetch(initRequest("https://mcp.test/mcp"));
    expect(res.status).toBe(401);
    const wwwAuth = res.headers.get("www-authenticate") ?? "";
    expect(wwwAuth).toContain('Bearer realm="mcp"');
    expect(wwwAuth).toContain(
      'resource_metadata="https://mcp.test/.well-known/oauth-protected-resource/mcp"'
    );
    expect(wwwAuth).not.toContain("error="); // missing creds → no error code (RFC 6750)
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("POST /mcp with a valid region-suffixed token → single-region probe passes, no 401", async () => {
    // Stargate-centered flow: the region is decoded from the token's `_fr` suffix,
    // so validation is ONE /users/me probe against the owning backend. A 200 → the
    // request proceeds (no challenge).
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: { id: "u1" } }]);
    const res = await app.fetch(
      initRequest("https://mcp.test/mcp", { authorization: "Bearer o.sometoken_fr" })
    );
    expect(res.status).not.toBe(401);
    expect(res.headers.get("www-authenticate")).toBeNull();
  });

  it("POST /mcp with an expired/rejected token → 401 + error=invalid_token challenge", async () => {
    // The core P1: a rejected bearer must produce the RFC 6750 invalid_token
    // challenge so the host silently refreshes — not silently pass and fail later.
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 401, body: {} }]);
    const res = await app.fetch(
      initRequest("https://mcp.test/mcp", { authorization: "Bearer o.staletoken_fr" })
    );
    expect(res.status).toBe(401);
    const wwwAuth = res.headers.get("www-authenticate") ?? "";
    expect(wwwAuth).toContain('error="invalid_token"');
    expect(wwwAuth).toContain("resource_metadata=");
  });

  it("POST /fr/mcp (EU compat alias) still serves the connector, not a 404", async () => {
    // The README shipped https://mcp.leadbay.app/fr/mcp as the EU connector URL.
    // It must keep working as an alias for /mcp under the single-Stargate flow.
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: { id: "u1" } }]);
    const res = await app.fetch(
      initRequest("https://mcp.test/fr/mcp", { authorization: "Bearer o.sometoken_fr" })
    );
    expect(res.status).not.toBe(404);
    expect(res.status).not.toBe(401);
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

  it("OPTIONS preflight → 204 with permissive CORS", async () => {
    const res = await app.fetch(new Request("https://mcp.test/mcp", { method: "OPTIONS" }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods") ?? "").toContain("POST");
  });

  it("healthz stays open (no auth)", async () => {
    const res = await app.fetch(new Request("https://mcp.test/healthz"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
