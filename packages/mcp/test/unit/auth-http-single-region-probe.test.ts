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
  it("region-suffixed token → ok via ONE probe against the OWNING backend", async () => {
    const { requests } = mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: { id: "u1" } },
    ]);
    const fr = await resolveClientFromToken("o.sometoken_fr");
    expect(fr.authState).toBe("ok");
    expect(requests).toHaveLength(1); // exactly one probe, not the old two
    expect(requests[0].url).toContain("api-fr"); // routed by the _fr suffix
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

  it("untagged legacy token → ok via a probe against the fallback region (US first)", async () => {
    const { requests } = mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: { id: "u1" } },
    ]);
    const result = await resolveClientFromToken("o.legacytoken");
    expect(result.authState).toBe("ok");
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("api-us"); // default primary for untagged
  });

  // --- Legacy/untagged tokens must NOT be pinned to one region (Codex P1) ---

  it("untagged FR token → US 401 then FR 200 → ok (falls back, NOT falsely expired)", async () => {
    // The regression: an existing FR bearer with no suffix, probed only against US,
    // would 401 and be reported expired even though it's valid in FR. It must fall
    // back to FR and resolve ok.
    const { requests } = mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 401, body: { error: true, code: "AUTH_EXPIRED", message: "not us" } },
      { method: "GET", path: "/1.6/users/me", status: 200, body: { id: "u1" } },
    ]);
    const result = await resolveClientFromToken("o.legacyfrtoken");
    expect(result.authState).toBe("ok");
    expect(requests).toHaveLength(2); // US rejected → fell back to FR
    expect(requests[0].url).toContain("api-us");
    expect(requests[1].url).toContain("api-fr");
  });

  it("untagged token → expired ONLY when BOTH regions reject it", async () => {
    const { requests } = mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 401, body: { error: true, code: "AUTH_EXPIRED", message: "x" } },
      { method: "GET", path: "/1.6/users/me", status: 401, body: { error: true, code: "AUTH_EXPIRED", message: "x" } },
    ]);
    const result = await resolveClientFromToken("o.trulyexpired");
    expect(result.authState).toBe("expired");
    expect(requests).toHaveLength(2); // probed both before declaring expired
  });

  it("untagged token → US 503 (transient) then FR 200 → ok, does NOT bind to failing US", async () => {
    // Codex P2: a non-auth fault on the first candidate must NOT short-circuit to
    // "ok" bound to that failing region. It must keep probing — a healthy FR token
    // resolves against FR even though US had a transient 503.
    const { requests } = mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 503, body: {} },
      { method: "GET", path: "/1.6/users/me", status: 200, body: { id: "u1" } },
    ]);
    const result = await resolveClientFromToken("o.legacyfrtoken");
    expect(result.authState).toBe("ok");
    expect(requests).toHaveLength(2); // US 503 → still tried FR
    expect(requests[0].url).toContain("api-us");
    expect(requests[1].url).toContain("api-fr");
  });

  it("untagged token → US 401 then FR 503 → ok BOUND TO FR (the transient region, not the rejecting one)", async () => {
    // One region auth-rejects, the other has a transient fault → we can't be sure
    // the token is invalid, so DON'T force re-auth. Crucially (Codex P2) the client
    // must bind to FR — the region with the TRANSIENT fault where the token is
    // plausibly valid — NOT to US, which already auth-rejected it (the next tool
    // call to US would fail auth needlessly).
    const { requests } = mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 401, body: { error: true, code: "AUTH_EXPIRED", message: "x" } },
      { method: "GET", path: "/1.6/users/me", status: 503, body: {} },
    ]);
    const result = await resolveClientFromToken("o.ambiguous");
    expect(result.authState).toBe("ok");
    expect(requests).toHaveLength(2); // probed both (US, then FR)
    expect(result.client.region).toBe("fr"); // bound to the transient region, NOT the rejecting US
  });

  it("untagged token → FR 401 then US 503 → ok BOUND TO US (mirror: bind to the transient region)", async () => {
    // Symmetric to the above with regions swapped, so the fix isn't accidentally
    // just always-FR: FR auth-rejects, US is transient → bind to US.
    const { requests } = mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 401, body: { error: true, code: "AUTH_EXPIRED", message: "x" } },
      { method: "GET", path: "/1.6/users/me", status: 503, body: {} },
    ]);
    // preferRegion fr → probes FR first (401), then US (503) → binds US.
    const result = await resolveClientFromToken("o.ambiguous2", { preferRegion: "fr" });
    expect(result.authState).toBe("ok");
    expect(requests).toHaveLength(2);
    expect(requests[0].url).toContain("api-fr"); // FR probed first
    expect(result.client.region).toBe("us"); // bound to the transient US, not the rejecting FR
  });

  it("untagged token → BOTH regions 5xx → ok (transient, not expired)", async () => {
    const { requests } = mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 503, body: {} },
      { method: "GET", path: "/1.6/users/me", status: 500, body: {} },
    ]);
    const result = await resolveClientFromToken("o.legacytoken");
    expect(result.authState).toBe("ok"); // never expired on non-auth faults
    expect(requests).toHaveLength(2);
  });

  it("preferRegion fr → untagged token probes FR FIRST (for the /fr/mcp alias)", async () => {
    const { requests } = mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: { id: "u1" } },
    ]);
    const result = await resolveClientFromToken("o.legacyfrtoken", { preferRegion: "fr" });
    expect(result.authState).toBe("ok");
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("api-fr"); // FR probed first, resolved immediately
  });

  it("suffix wins over preferRegion (a _us token still probes US even on /fr)", async () => {
    const { requests } = mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: { id: "u1" } },
    ]);
    const result = await resolveClientFromToken("o.sometoken_us", { preferRegion: "fr" });
    expect(result.authState).toBe("ok");
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("api-us");
  });
});
