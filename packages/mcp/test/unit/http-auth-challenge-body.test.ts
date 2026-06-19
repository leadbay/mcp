// Regression guard for product#3761 ("401 Hallucination on startup").
//
// The hosted MCP returns 401 + WWW-Authenticate as the OAuth challenge that
// triggers the host's sign-in / silent token refresh. That handshake is
// correct — but the challenge body must NOT carry human-readable "sign in with
// Leadbay again" prose: Claude's host surfaces a 401 body to the LLM, which
// then parrots a spurious re-auth instruction to the user even though the
// retry succeeds. The OAuth contract lives entirely in the status + header, so
// the body stays empty. This file locks that the challenge body is empty and
// carries no quotable prose, while the header signal is preserved.

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

// Anything an LLM could read as a user-directed re-auth instruction.
const QUOTABLE_PROSE = /sign in|re-?authenticate|reconnect|leadbay|access token|unauthorized|invalid_token/i;

describe("hosted MCP OAuth challenge — empty body (product#3761)", () => {
  it("missing token → 401, header preserved, body empty + no quotable prose", async () => {
    mockHttp([]); // no token → no backend probe
    const res = await app.fetch(initRequest("https://mcp.test/mcp"));

    expect(res.status).toBe(401);
    // Header signal still present (this is the OAuth contract — must NOT regress).
    const wwwAuth = res.headers.get("www-authenticate") ?? "";
    expect(wwwAuth).toContain('Bearer realm="mcp"');
    expect(wwwAuth).toContain("resource_metadata=");

    const body = await res.text();
    expect(body).toBe("");
    expect(body).not.toMatch(QUOTABLE_PROSE);
  });

  it("expired token → 401, invalid_token in header, body empty + no quotable prose", async () => {
    // Auto-probe hits both regions; both 401 AUTH_EXPIRED → expired.
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 401, body: { error: true, code: "AUTH_EXPIRED", message: "token expired" } },
      { method: "GET", path: "/1.5/users/me", status: 401, body: { error: true, code: "AUTH_EXPIRED", message: "token expired" } },
    ]);
    const res = await app.fetch(initRequest("https://mcp.test/mcp", { authorization: "Bearer stale" }));

    expect(res.status).toBe(401);
    // The machine-actionable error signal lives in the header, not the body.
    expect(res.headers.get("www-authenticate") ?? "").toContain('error="invalid_token"');

    const body = await res.text();
    expect(body).toBe("");
    expect(body).not.toMatch(QUOTABLE_PROSE);
  });
});
