import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { resolveClientFromToken } from "../../src/auth-http.js";

const BASE_US = "https://api-us.leadbay.app";
const BASE_FR = "https://api-fr.leadbay.app";

beforeEach(() => resetHttpMock());

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

  it("token + explicit region=us → no probe call, ok authState", async () => {
    const { requests } = mockHttp([]);
    const result = await resolveClientFromToken("tok", { region: "us" });
    expect(result.authState).toBe("ok");
    expect(requests).toHaveLength(0); // pinned region skips probe
  });

  it("token + explicit region=fr → no probe call, ok authState", async () => {
    const { requests } = mockHttp([]);
    const result = await resolveClientFromToken("tok", { region: "fr" });
    expect(result.authState).toBe("ok");
    expect(requests).toHaveLength(0); // pinned region skips probe
  });

  it("token + baseUrl → no probe call, ok authState", async () => {
    const { requests } = mockHttp([]);
    const result = await resolveClientFromToken("tok", { baseUrl: BASE_US });
    expect(result.authState).toBe("ok");
    expect(requests).toHaveLength(0);
  });

  it("auto-probe: first region to respond wins", async () => {
    // Respond to /users/me on us; fr gets a 401 (will be ignored since us wins)
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: { id: "u1" } },
      { method: "GET", path: "/1.6/users/me", status: 401, body: { error: true, code: "NOT_AUTHENTICATED", message: "bad" } },
    ]);
    const result = await resolveClientFromToken("tok");
    expect(result.authState).toBe("ok");
  });

  it("auto-probe: both regions return AUTH_EXPIRED → expired broken client", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 401, body: { error: true, code: "AUTH_EXPIRED", message: "token expired" } },
      { method: "GET", path: "/1.6/users/me", status: 401, body: { error: true, code: "AUTH_EXPIRED", message: "token expired" } },
    ]);
    const result = await resolveClientFromToken("tok");
    expect(result.authState).toBe("expired");
    await expect(result.client.request("GET", "/any")).rejects.toMatchObject({
      code: "AUTH_EXPIRED",
    });
  });

  // NOTE: one "auto-probe" test that lived here could not be kept —
  // "both regions network error → probe_failed" asserted the `probe_failed`
  // authState, and this PR removes it: a transient fault now resolves as "ok" so
  // a backend blip can't force a spurious re-auth. Nothing about that assertion
  // survives the contract change. Its replacement, plus the region-from-token /
  // single-probe / validate:false coverage, lives in the new file
  // auth-http-single-region-probe.test.ts (repo rule: new tests in new files).
});
