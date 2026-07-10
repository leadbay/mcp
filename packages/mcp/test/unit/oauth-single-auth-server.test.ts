// Single-Stargate authorization server in Protected Resource Metadata (new-file
// coverage; the pre-Stargate per-region PRM tests were removed from
// oauth-resource-metadata.test.ts).
//
// Stargate is the single, region-agnostic OAuth authority, so every PRM path
// advertises ONE authorization server (STARGATE_AUTH_SERVER) regardless of the
// connector path. The region rides in the token suffix, not the URL.

import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { resetHttpMock, httpsMockFactory } from "../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { protectedResourceMetadata, STARGATE_AUTH_SERVER } from "../../src/auth-http.js";
import { app } from "../../src/http-server.js";

beforeEach(() => resetHttpMock());

describe("protectedResourceMetadata — single Stargate auth server", () => {
  it("advertises the single Stargate authorization server", () => {
    const doc = protectedResourceMetadata({ resourceUrl: "https://mcp.test/mcp" });
    expect(doc.resource).toBe("https://mcp.test/mcp");
    expect(doc.authorization_servers).toEqual([STARGATE_AUTH_SERVER]);
    expect(doc.bearer_methods_supported).toEqual(["header"]);
  });
});

describe("protected resource metadata routes — single Stargate auth server", () => {
  it("bare /.well-known/oauth-protected-resource → Stargate auth server, resource /mcp", async () => {
    const res = await app.fetch(
      new Request("https://mcp.test/.well-known/oauth-protected-resource")
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = await res.json();
    expect(body.resource).toBe("https://mcp.test/mcp");
    expect(body.authorization_servers).toEqual([STARGATE_AUTH_SERVER]);
  });

  it("path-suffix /mcp → Stargate auth server", async () => {
    const res = await app.fetch(
      new Request("https://mcp.test/.well-known/oauth-protected-resource/mcp")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resource).toBe("https://mcp.test/mcp");
    expect(body.authorization_servers).toEqual([STARGATE_AUTH_SERVER]);
  });

  it("path-suffix /fr/mcp (EU compat alias) → same single Stargate auth server", async () => {
    const res = await app.fetch(
      new Request("https://mcp.test/.well-known/oauth-protected-resource/fr/mcp")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resource).toBe("https://mcp.test/fr/mcp");
    expect(body.authorization_servers).toEqual([STARGATE_AUTH_SERVER]);
  });

  it("unknown suffix falls back to the primary /mcp resource", async () => {
    const res = await app.fetch(
      new Request("https://mcp.test/.well-known/oauth-protected-resource/bogus")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resource).toBe("https://mcp.test/mcp");
    expect(body.authorization_servers).toEqual([STARGATE_AUTH_SERVER]);
  });
});
