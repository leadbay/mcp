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

  it("region-suffixed token → ok, routed by the suffix, no probe call", async () => {
    // Stargate-centered flow: region decoded from the `_fr`/`_us` suffix; no
    // dual-region /users/me probe. Any real auth failure surfaces on the tool call.
    const { requests } = mockHttp([]);
    const fr = await resolveClientFromToken("o.sometoken_fr");
    expect(fr.authState).toBe("ok");
    const us = await resolveClientFromToken("o.sometoken_us");
    expect(us.authState).toBe("ok");
    expect(requests).toHaveLength(0);
  });

  it("untagged legacy token → ok (falls back to a region), no probe call", async () => {
    const { requests } = mockHttp([]);
    const result = await resolveClientFromToken("o.legacytoken");
    expect(result.authState).toBe("ok");
    expect(requests).toHaveLength(0);
  });
});
