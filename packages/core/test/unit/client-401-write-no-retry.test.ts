import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../src/client.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

// The 401 auto-retry is GET-ONLY. A 401 on a write (POST/PUT/DELETE) may arrive
// AFTER the mutation already committed server-side, so re-sending it would
// double-execute the write. Writes must surface the 401 on the FIRST response,
// with no second request.
describe("LeadbayClient — 401 retry is GET-only (writes never re-execute)", () => {
  it("a POST that 401s is NOT retried — exactly one request, error surfaced", async () => {
    mockHttp([{ method: "POST", path: "/1.6/leads/epilogue", status: 401, body: {} }]);
    await expect(
      newClient().requestVoid("POST", "/leads/epilogue", { foo: "bar" })
    ).rejects.toMatchObject({ code: "AUTH_EXPIRED" });
    // Single request — no retry doubled the mutation.
    expect(getHttpRequests().filter((r) => r.method === "POST")).toHaveLength(1);
  });

  it("a DELETE that 401s is NOT retried — exactly one request", async () => {
    mockHttp([{ method: "DELETE", path: "/1.6/lenses/abc", status: 401, body: {} }]);
    await expect(
      newClient().requestVoid("DELETE", "/lenses/abc")
    ).rejects.toMatchObject({ code: "AUTH_EXPIRED" });
    expect(getHttpRequests().filter((r) => r.method === "DELETE")).toHaveLength(1);
  });

  it("a GET that 401s IS retried — two requests (contrast case)", async () => {
    mockHttp([{ method: "GET", path: "/1.6/lenses", status: 401, body: {} }]);
    await expect(newClient().request("GET", "/lenses")).rejects.toMatchObject({
      code: "AUTH_EXPIRED",
    });
    // GET is idempotent, so the single auto-retry fires: original + retry.
    expect(getHttpRequests().filter((r) => r.method === "GET")).toHaveLength(2);
  });
});

// The hint the agent reads must match what actually happened. It used to assert
// "request() already retried this call once" unconditionally — false on every
// write, which is the path leadbay_create_topup_link takes (product#3998).
describe("LeadbayClient — the 401 hint never claims a retry that didn't happen", () => {
  it("a POST 401 hint says writes are not auto-retried", async () => {
    mockHttp([{ method: "POST", path: "/1.6/stripe/topup_checkout", status: 401, body: {} }]);
    await expect(
      newClient().request("POST", "/stripe/topup_checkout", {})
    ).rejects.toMatchObject({
      code: "AUTH_EXPIRED",
      hint: expect.stringContaining("never auto-retried"),
    });
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

  it("a GET with retryOn401:false is not described as retried either", async () => {
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 401, body: {} }]);
    await expect(
      newClient().request("GET", "/users/me", undefined, { retryOn401: false })
    ).rejects.toMatchObject({
      code: "AUTH_EXPIRED",
      hint: expect.stringContaining("first attempt"),
    });
    expect(getHttpRequests().filter((r) => r.method === "GET")).toHaveLength(1);
  });
});
