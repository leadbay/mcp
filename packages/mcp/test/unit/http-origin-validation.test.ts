/**
 * Origin-header validation on the hosted MCP HTTP transport (DNS-rebinding
 * defense, MCP HTTP spec). A present, non-allowlisted Origin is rejected with
 * 403 BEFORE token resolution; an absent Origin (native clients / curl) and an
 * allowlisted Origin both pass. Discovery (PRM) and OPTIONS stay world-open.
 *
 * New file — does not touch the existing http-auth-challenge tests.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { app } from "../../src/http-server.js";

beforeEach(() => resetHttpMock());

function mcpPost(headers: Record<string, string> = {}): Request {
  return new Request("https://mcp.test/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
}

describe("hosted MCP Origin validation", () => {
  it("no Origin header (native client / curl) → not rejected as forbidden", async () => {
    mockHttp([]); // no token → falls through to the 401 auth challenge, NOT 403
    const res = await app.fetch(mcpPost());
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(401); // missing token → OAuth challenge
  });

  it("allowlisted Origin (claude.ai) → not rejected as forbidden", async () => {
    mockHttp([]);
    const res = await app.fetch(mcpPost({ origin: "https://claude.ai" }));
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(401);
  });

  it("allowlisted Origin (claude.com) → not rejected as forbidden", async () => {
    mockHttp([]);
    const res = await app.fetch(mcpPost({ origin: "https://claude.com" }));
    expect(res.status).not.toBe(403);
  });

  it("foreign Origin → 403 before any backend probe", async () => {
    mockHttp([]); // a 403 must NOT trigger a backend /users/me probe
    const res = await app.fetch(mcpPost({ origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("foreign Origin on the SSE /messages endpoint → 403", async () => {
    mockHttp([]);
    const res = await app.fetch(
      new Request("https://mcp.test/messages?sessionId=x", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("foreign Origin on GET /sse → 403", async () => {
    mockHttp([]);
    const res = await app.fetch(
      new Request("https://mcp.test/sse", {
        method: "GET",
        headers: { origin: "https://evil.example" },
      })
    );
    expect(res.status).toBe(403);
  });

  it("PRM discovery stays world-open regardless of Origin", async () => {
    mockHttp([]);
    const res = await app.fetch(
      new Request("https://mcp.test/.well-known/oauth-protected-resource/mcp", {
        method: "GET",
        headers: { origin: "https://evil.example" },
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = await res.json();
    expect(body.resource).toContain("/mcp");
  });

  it("OPTIONS preflight stays world-open regardless of Origin", async () => {
    const res = await app.fetch(
      new Request("https://mcp.test/mcp", {
        method: "OPTIONS",
        headers: { origin: "https://evil.example" },
      })
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
