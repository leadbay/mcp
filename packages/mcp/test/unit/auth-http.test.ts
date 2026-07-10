import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { resolveClientFromToken, regionFromToken } from "../../src/auth-http.js";

const BASE_US = "https://api-us.leadbay.app";

beforeEach(() => resetHttpMock());

describe("regionFromToken", () => {
  it("decodes the trailing region suffix", () => {
    expect(regionFromToken("o.sometoken_fr")).toBe("fr");
    expect(regionFromToken("o.sometoken_us")).toBe("us");
  });

  it("returns undefined for an untagged or unknown-suffix token", () => {
    expect(regionFromToken("o.sometoken")).toBeUndefined();
    expect(regionFromToken("o.sometoken_xx")).toBeUndefined();
  });
});

describe("resolveClientFromToken", () => {
  it("missing token → AUTH_MISSING broken client", async () => {
    const { requests } = mockHttp([]);
    const result = await resolveClientFromToken(undefined);
    expect(result.authState).toBe("missing");
    await expect(result.client.request("GET", "/any")).rejects.toMatchObject({
      code: "AUTH_MISSING",
    });
    expect(requests).toHaveLength(0);
  });

  it("empty string token → AUTH_MISSING broken client", async () => {
    const { requests } = mockHttp([]);
    const result = await resolveClientFromToken("");
    expect(result.authState).toBe("missing");
    await expect(result.client.request("GET", "/any")).rejects.toMatchObject({
      code: "AUTH_MISSING",
    });
    expect(requests).toHaveLength(0);
  });

  it("explicit region pin → ok, no probe call", async () => {
    const { requests } = mockHttp([]);
    const result = await resolveClientFromToken("tok", { region: "us" });
    expect(result.authState).toBe("ok");
    expect(requests).toHaveLength(0);
  });

  it("explicit baseUrl → ok, no probe call", async () => {
    const { requests } = mockHttp([]);
    const result = await resolveClientFromToken("tok", { baseUrl: BASE_US });
    expect(result.authState).toBe("ok");
    expect(requests).toHaveLength(0);
  });

  it("region-suffixed token → ok via a SINGLE-region validation probe", async () => {
    // Stargate-centered flow: the region is decoded from the `_fr`/`_us` suffix,
    // so validation is ONE /users/me probe against the owning backend (not the old
    // dual-region auto-probe). A 200 → authState "ok".
    const { requests } = mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: { id: "u1" } },
    ]);
    const fr = await resolveClientFromToken("o.sometoken_fr");
    expect(fr.authState).toBe("ok");
    expect(requests).toHaveLength(1); // exactly one probe, not two
  });

  it("rejected token → expired (drives the invalid_token refresh challenge)", async () => {
    // A backend 401 on the validation probe means the token is expired/revoked.
    // resolveClientFromToken must surface authState "expired" so the hosted server
    // emits WWW-Authenticate: error="invalid_token" and the host silently refreshes
    // — instead of the failure only appearing later on a tool call.
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 401, body: {} }]);
    const result = await resolveClientFromToken("o.staletoken_fr");
    expect(result.authState).toBe("expired");
  });

  it("non-auth probe failure → ok (don't force re-auth on a transient fault)", async () => {
    // A 5xx / network fault is not an auth problem; proceeding as "ok" lets the
    // real fault re-surface on the tool call rather than pushing a spurious sign-in.
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 503, body: {} }]);
    const result = await resolveClientFromToken("o.sometoken_us");
    expect(result.authState).toBe("ok");
  });

  it("validate:false skips the probe (explicit opt-out)", async () => {
    const { requests } = mockHttp([]);
    const result = await resolveClientFromToken("o.sometoken_fr", { validate: false });
    expect(result.authState).toBe("ok");
    expect(requests).toHaveLength(0);
  });

  it("untagged legacy token → ok via a probe against the fallback region", async () => {
    const { requests } = mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: { id: "u1" } },
    ]);
    const result = await resolveClientFromToken("o.legacytoken");
    expect(result.authState).toBe("ok");
    expect(requests).toHaveLength(1);
  });
});
