// Stargate-centered auth resolution (new-file coverage; the pre-Stargate
// dual-region auto-probe tests were removed from auth-http.test.ts).
//
// Under the single-Stargate flow the region is decoded from the token's
// `_fr`/`_us` suffix and validated with ONE `/users/me` probe against the owning
// backend. A rejected token → authState "expired" (drives the invalid_token
// refresh challenge); a non-auth fault → "ok" (don't force spurious re-auth).

import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { resolveClientFromToken, regionFromToken } from "../../src/auth-http.js";

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

describe("resolveClientFromToken — single-region validation probe", () => {
  it("region-suffixed token → ok via ONE probe against the owning backend", async () => {
    const { requests } = mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: { id: "u1" } },
    ]);
    const fr = await resolveClientFromToken("o.sometoken_fr");
    expect(fr.authState).toBe("ok");
    expect(requests).toHaveLength(1); // exactly one probe, not the old two
  });

  it("rejected token → expired (drives the invalid_token refresh challenge)", async () => {
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 401, body: {} }]);
    const result = await resolveClientFromToken("o.staletoken_fr");
    expect(result.authState).toBe("expired");
  });

  it("non-auth probe failure (5xx) → ok (don't force re-auth on a transient fault)", async () => {
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
