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
    mockHttp([]); // no token → no backend probe
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

  it("POST /fr/mcp with no token → 401 pointing at fr metadata", async () => {
    mockHttp([]);
    const res = await app.fetch(initRequest("https://mcp.test/fr/mcp"));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate") ?? "").toContain(
      'resource_metadata="https://mcp.test/.well-known/oauth-protected-resource/fr/mcp"'
    );
  });

  it("POST /mcp with an expired token → 401 invalid_token", async () => {
    // Auto-probe hits both regions; both 401 AUTH_EXPIRED → expired.
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 401, body: { error: true, code: "AUTH_EXPIRED", message: "token expired" } },
      { method: "GET", path: "/1.6/users/me", status: 401, body: { error: true, code: "AUTH_EXPIRED", message: "token expired" } },
    ]);
    const res = await app.fetch(initRequest("https://mcp.test/mcp", { authorization: "Bearer stale" }));
    expect(res.status).toBe(401);
    const wwwAuth = res.headers.get("www-authenticate") ?? "";
    expect(wwwAuth).toContain('error="invalid_token"');
    expect(wwwAuth).toContain("resource_metadata=");
  });

  it("transient probe failure does NOT force re-auth (no 401)", async () => {
    // Both regions return a non-auth error → probe_failed → proceed (not a 401).
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 500, body: { error: true, code: "SERVER_ERROR", message: "oops" } },
      { method: "GET", path: "/1.6/users/me", status: 500, body: { error: true, code: "SERVER_ERROR", message: "oops" } },
    ]);
    const res = await app.fetch(initRequest("https://mcp.test/mcp", { authorization: "Bearer tok" }));
    expect(res.status).not.toBe(401);
    expect(res.headers.get("www-authenticate")).toBeNull();
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
