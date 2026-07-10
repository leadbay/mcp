import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { resetHttpMock, httpsMockFactory } from "../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import {
  protectedResourceMetadata,
  buildWwwAuthenticate,
  STARGATE_AUTH_SERVER,
} from "../../src/auth-http.js";
import { app } from "../../src/http-server.js";

beforeEach(() => resetHttpMock());

describe("OAuth resource-server helpers", () => {
  it("protectedResourceMetadata advertises the single Stargate authorization server", () => {
    const doc = protectedResourceMetadata({ resourceUrl: "https://mcp.test/mcp" });
    expect(doc.resource).toBe("https://mcp.test/mcp");
    expect(doc.authorization_servers).toEqual([STARGATE_AUTH_SERVER]);
    expect(doc.bearer_methods_supported).toEqual(["header"]);
  });

  it("buildWwwAuthenticate omits error for missing, sets invalid_token for expired", () => {
    const missing = buildWwwAuthenticate({
      resourceMetadataUrl: "https://mcp.test/.well-known/oauth-protected-resource/mcp",
      authState: "missing",
    });
    expect(missing).toContain('Bearer realm="mcp"');
    expect(missing).toContain(
      'resource_metadata="https://mcp.test/.well-known/oauth-protected-resource/mcp"'
    );
    expect(missing).not.toContain("error=");

    const expired = buildWwwAuthenticate({
      resourceMetadataUrl: "https://mcp.test/.well-known/oauth-protected-resource/mcp",
      authState: "expired",
    });
    expect(expired).toContain('error="invalid_token"');
    expect(expired).toContain("resource_metadata=");
  });
});

describe("protected resource metadata routes", () => {
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
