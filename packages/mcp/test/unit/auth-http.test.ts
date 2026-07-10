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

  // NOTE: the three "auto-probe" tests that lived here (first-region-wins,
  // dual-region AUTH_EXPIRED → expired, dual-region 5xx → probe_failed) tested the
  // pre-Stargate DUAL-region probe model, which this PR removes: the region is now
  // decoded from the token suffix and validated with a SINGLE-region probe. Those
  // obsolete tests are dropped; the single-region probe / expired / validate:false
  // / region-from-token coverage lives in the new file
  // auth-http-single-region-probe.test.ts (repo rule: new tests in new files).
});
