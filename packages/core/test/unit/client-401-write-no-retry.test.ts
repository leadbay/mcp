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
    mockHttp([{ method: "POST", path: "/1.5/leads/epilogue", status: 401, body: {} }]);
    await expect(
      newClient().requestVoid("POST", "/leads/epilogue", { foo: "bar" })
    ).rejects.toMatchObject({ code: "AUTH_EXPIRED" });
    // Single request — no retry doubled the mutation.
    expect(getHttpRequests().filter((r) => r.method === "POST")).toHaveLength(1);
  });

  it("a DELETE that 401s is NOT retried — exactly one request", async () => {
    mockHttp([{ method: "DELETE", path: "/1.5/lenses/abc", status: 401, body: {} }]);
    await expect(
      newClient().requestVoid("DELETE", "/lenses/abc")
    ).rejects.toMatchObject({ code: "AUTH_EXPIRED" });
    expect(getHttpRequests().filter((r) => r.method === "DELETE")).toHaveLength(1);
  });

  it("a GET that 401s IS retried — two requests (contrast case)", async () => {
    mockHttp([{ method: "GET", path: "/1.5/lenses", status: 401, body: {} }]);
    await expect(newClient().request("GET", "/lenses")).rejects.toMatchObject({
      code: "AUTH_EXPIRED",
    });
    // GET is idempotent, so the single auto-retry fires: original + retry.
    expect(getHttpRequests().filter((r) => r.method === "GET")).toHaveLength(2);
  });
});
