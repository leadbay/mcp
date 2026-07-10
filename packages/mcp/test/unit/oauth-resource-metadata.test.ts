import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { resetHttpMock, httpsMockFactory } from "../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { buildWwwAuthenticate } from "../../src/auth-http.js";

beforeEach(() => resetHttpMock());

// NOTE: the per-region PRM tests that lived here (regionAuthServer, us/fr
// authorization_servers, /fr/mcp → fr) tested the pre-Stargate region-per-path
// model, which this PR removes — Stargate is now the single authorization server.
// Those obsolete tests are dropped; the single-Stargate-server coverage lives in
// the new file oauth-single-auth-server.test.ts (repo rule: new tests in new
// files). Only this region-agnostic helper test remains here.
describe("OAuth resource-server helpers", () => {
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
