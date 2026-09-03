import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../src/client.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

// The hint the agent reads must match what actually happened. It used to assert
// "request() already retried this call once" unconditionally — false on every
// write, which is the path leadbay_create_topup_link takes (product#3998).
//
// The retry is GET-only AND opt-outable (retryOn401:false, used by the startup
// auth probe), so "not retried" has two causes. The hint states only the fact,
// never the reason, so it stays true on both — see client-401-write-no-retry
// for the retry BEHAVIOUR these messages describe.
describe("LeadbayClient — the 401 hint never claims a retry that didn't happen", () => {
  it("a POST 401 hint says the call was not auto-retried", async () => {
    mockHttp([{ method: "POST", path: "/1.6/stripe/topup_checkout", status: 401, body: {} }]);
    await expect(
      newClient().request("POST", "/stripe/topup_checkout", {})
    ).rejects.toMatchObject({
      code: "AUTH_EXPIRED",
      hint: expect.stringContaining("wasn't auto-retried"),
    });
  });

  it("a POST 401 hint does not claim a retry happened", async () => {
    mockHttp([{ method: "POST", path: "/1.6/stripe/topup_checkout", status: 401, body: {} }]);
    await expect(
      newClient().request("POST", "/stripe/topup_checkout", {})
    ).rejects.not.toMatchObject({ hint: expect.stringContaining("auto-retried once") });
  });

  it("a GET 401 hint does say the call was already auto-retried", async () => {
    mockHttp([{ method: "GET", path: "/1.6/lenses", status: 401, body: {} }]);
    await expect(newClient().request("GET", "/lenses")).rejects.toMatchObject({
      code: "AUTH_EXPIRED",
      hint: expect.stringContaining("auto-retried once"),
    });
  });

  // A GET with the retry opted out is NOT a write, so the first-attempt text
  // must not blame the method — that would be the same false provenance in the
  // other direction.
  it("a GET with retryOn401:false reports a first attempt without calling it a write", async () => {
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 401, body: {} }]);
    let hint = "";
    try {
      await newClient().request("GET", "/users/me", undefined, { retryOn401: false });
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.code).toBe("AUTH_EXPIRED");
      hint = err.hint;
    }
    expect(hint).toContain("first attempt");
    expect(hint.toLowerCase()).not.toContain("write");
    // Opting out means exactly one request went out.
    expect(getHttpRequests().filter((r) => r.method === "GET")).toHaveLength(1);
  });
});
