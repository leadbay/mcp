/**
 * verifyTokenRegion — confirm a token's real region by probing /users/me
 * (product#3761).
 *
 * GeoIP (stargate) only GUESSES the region from the user's IP. A wrong guess
 * pins the wrong LEADBAY_REGION and the MCP then 401s every startup against the
 * wrong backend. verifyTokenRegion probes the preferred (GeoIP) region first
 * and falls back to the other region, pinning whichever the token actually
 * authenticates against.
 *
 * The mock harness matches on (method, path) only — both regions share the path
 * /1.5/users/me — so scripts are consumed in probe order: the FIRST matching
 * script answers the preferred-region probe, the SECOND answers the fallback.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { verifyTokenRegion } from "../../src/oauth.js";

const ME = "/1.5/users/me";

beforeEach(() => resetHttpMock());

describe("verifyTokenRegion (product#3761)", () => {
  it("keeps the preferred region when the token authenticates there", async () => {
    // Preferred = us; first probe (us) succeeds → no fallback probe fires.
    mockHttp([{ method: "GET", path: ME, status: 200, body: { id: "u1" } }]);
    expect(await verifyTokenRegion("o.tok", "us")).toBe("us");
  });

  it("corrects to the other region when the preferred one 401s (the bug)", async () => {
    // Preferred = us but the token is an fr token: us probe 401s, fr probe 200s.
    // This is the exact GeoIP-mis-guess case that caused "401 every startup".
    // verifyTokenRegion uses httpsCall directly (no auto-retry), so each region
    // is exactly one probe: us 401s, fr 200s.
    mockHttp([
      { method: "GET", path: ME, status: 401, body: {} }, // us probe (preferred)
      { method: "GET", path: ME, status: 200, body: { id: "u1" } }, // fr probe (fallback)
    ]);
    expect(await verifyTokenRegion("o.tok", "us")).toBe("fr");
  });

  it("returns null when the token authenticates against NEITHER backend", async () => {
    // A genuinely bad/revoked token: both regions 401. Caller decides what to do.
    mockHttp([
      { method: "GET", path: ME, status: 401, body: {} }, // us probe
      { method: "GET", path: ME, status: 401, body: {} }, // fr probe
    ]);
    expect(await verifyTokenRegion("o.bad", "us")).toBeNull();
  });
});
