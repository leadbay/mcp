import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { resetHttpMock, httpsMockFactory } from "../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { app } from "../../src/http-server.js";

const US_AS = "https://api-us.leadbay.app";

beforeEach(() => resetHttpMock());

/**
 * New /us/* connector routes. The bare shared URL (/mcp) now defaults to FR (the
 * majority region); US accounts use the explicit /us/mcp. This is NEW coverage
 * for the US-explicit path, kept in its own file per the repo's "new tests in
 * new files" convention. The default-FR expectation updates live in the existing
 * oauth-resource-metadata.test.ts (those pinned behaviour changed, not new cases).
 */
describe("/us/* explicit-region routes", () => {
  it("PRM /us/mcp → us authorization server", async () => {
    const res = await app.fetch(
      new Request("https://mcp.test/.well-known/oauth-protected-resource/us/mcp")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resource).toBe("https://mcp.test/us/mcp");
    expect(body.authorization_servers).toEqual([US_AS]);
  });

  it("PRM /us/sse → us authorization server", async () => {
    const res = await app.fetch(
      new Request("https://mcp.test/.well-known/oauth-protected-resource/us/sse")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resource).toBe("https://mcp.test/us/sse");
    expect(body.authorization_servers).toEqual([US_AS]);
  });

  it("POST /us/mcp with no token → 401 pointing at /us/mcp metadata", async () => {
    const res = await app.fetch(
      new Request("https://mcp.test/us/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      })
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate") ?? "").toContain(
      'resource_metadata="https://mcp.test/.well-known/oauth-protected-resource/us/mcp"'
    );
  });
});
