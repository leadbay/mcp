import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../src/client.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

// Leadbay OAuth tokens never expire on a timer, so a 401 is treated as a
// transient server-side blip: the client retries ONCE automatically, and only
// if the retry also 401s does it surface an error — and that error blames
// Leadbay's side, never the user's login.
describe("LeadbayClient — 401 auto-retry + non-expiry framing", () => {
  it("a transient 401 is retried once and then succeeds (no error surfaced)", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/lenses", status: 401, body: {} },
      { method: "GET", path: "/1.5/lenses", status: 200, body: { ok: true } },
    ]);
    const result = await newClient().request<{ ok: boolean }>("GET", "/lenses");
    expect(result.ok).toBe(true);
    // Two HTTP calls happened: the original + the single retry.
    expect(getHttpRequests().length).toBe(2);
  });

  it("when the retry also 401s, it surfaces AUTH_EXPIRED (backward-compat code)", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/lenses", status: 401, body: {} },
      { method: "GET", path: "/1.5/lenses", status: 401, body: {} },
    ]);
    await expect(newClient().request("GET", "/lenses")).rejects.toMatchObject({
      error: true,
      code: "AUTH_EXPIRED",
    });
  });

  it("the surfaced 401 message never claims the token expired / is invalid", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/lenses", status: 401, body: {} },
      { method: "GET", path: "/1.5/lenses", status: 401, body: {} },
    ]);
    try {
      await newClient().request("GET", "/lenses");
      expect.fail("should have thrown");
    } catch (err: any) {
      const text = `${err.message} ${err.hint}`.toLowerCase();
      expect(text).not.toContain("token expired");
      expect(text).not.toContain("no longer valid");
      expect(text).not.toContain("regenerate");
      // No re-auth / re-login INSTRUCTIONS anymore (saying "not your login" is fine).
      expect(text).not.toContain("mcp login");
      expect(text).not.toContain("re-authenticate");
    }
  });
});
