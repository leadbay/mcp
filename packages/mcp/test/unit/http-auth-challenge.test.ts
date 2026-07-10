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

  it("POST /mcp with a region-suffixed token resolves without a probe (no 401 at resolution)", async () => {
    // Stargate-centered flow: the region is decoded from the token's `_fr` suffix,
    // so token resolution no longer probes /users/me and does not 401 here. Any
    // real auth failure surfaces on the actual tool call against the backend.
    mockHttp([]); // resolution makes NO backend call now
    const res = await app.fetch(
      initRequest("https://mcp.test/mcp", { authorization: "Bearer o.sometoken_fr" })
    );
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
