/**
 * Tests for the login tool. Covers the password-unescape regex — an easy-to-miss
 * subtlety, since some LLMs backslash-escape special chars in tool call JSON.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createTestApi,
  executeTool,
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { registerLogin } from "../../../src/tools/login.js";

const BASE = "https://api-us.leadbay.app";

beforeEach(() => {
  resetHttpMock();
});

describe("leadbay_login — password unescape", () => {
  const unescapeCases: Array<[string, string, string]> = [
    ["backslash-escaped special char is stripped", "Pass\\!word", "Pass!word"],
    [
      "double backslash collapses to single (known behavior)",
      "x\\\\y",
      "x\\y",
    ],
    [
      "trailing lone backslash is preserved (regex needs a follow char)",
      "pass\\",
      "pass\\",
    ],
  ];

  it.each(unescapeCases)(
    "%s: %s → %s",
    async (_label, input, expected) => {
      const { requests } = mockHttp([
        {
          method: "POST",
          path: "/1.5/auth/login",
          status: 200,
          body: { token: "u.new-token" },
        },
        // allow the prefetchOrgData fire-and-forget to 404 quietly
        { method: "GET", path: /\/1\.5\/users\/me/, status: 404, body: {} },
      ]);
      const t = createTestApi({});
      const client = new LeadbayClient(BASE);
      registerLogin(t.api as any, client);

      await executeTool(t, "leadbay_login", {
        email: "a@b.com",
        password: input,
      });

      const loginReq = requests.find((r) => r.path === "/1.5/auth/login");
      expect(loginReq).toBeDefined();
      const payload = JSON.parse(loginReq!.body!);
      expect(payload.password).toBe(expected);
    }
  );
});

describe("leadbay_login — status path handling", () => {
  it("200 response sets token on client and returns success", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.5/auth/login",
        status: 200,
        body: { token: "u.abc123" },
      },
      { method: "GET", path: /users\/me/, status: 404, body: {} },
    ]);
    const t = createTestApi({});
    const client = new LeadbayClient(BASE);
    registerLogin(t.api as any, client);

    const result: any = await executeTool(t, "leadbay_login", {
      email: "a@b.com",
      password: "secret",
    });

    expect(result).toEqual({
      success: true,
      message: "Logged in to Leadbay successfully",
    });
    expect(client.isAuthenticated).toBe(true);
  });

  it("401 returns LOGIN_FAILED (does NOT throw)", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.5/auth/login",
        status: 401,
        body: { message: "bad credentials" },
      },
    ]);
    const t = createTestApi({});
    const client = new LeadbayClient(BASE);
    registerLogin(t.api as any, client);

    const result: any = await executeTool(t, "leadbay_login", {
      email: "a@b.com",
      password: "wrong",
    });

    expect(result).toMatchObject({
      error: true,
      code: "LOGIN_FAILED",
      message: "bad credentials",
    });
    expect(client.isAuthenticated).toBe(false);
  });

  it("network error returns NETWORK_ERROR", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.5/auth/login",
        status: 0,
        error: new Error("ECONNREFUSED"),
      },
    ]);
    const t = createTestApi({});
    const client = new LeadbayClient(BASE);
    registerLogin(t.api as any, client);

    const result: any = await executeTool(t, "leadbay_login", {
      email: "a@b.com",
      password: "x",
    });

    expect(result).toMatchObject({
      error: true,
      code: "NETWORK_ERROR",
    });
    expect(result.message).toContain("ECONNREFUSED");
  });

  it("prefetchOrgData rejection is swallowed (fire-and-forget)", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.5/auth/login",
        status: 200,
        body: { token: "u.abc" },
      },
      // both prefetch paths fail — login must still resolve cleanly
      { method: "GET", path: /users\/me/, status: 500, body: {} },
    ]);
    const t = createTestApi({});
    const client = new LeadbayClient(BASE);
    registerLogin(t.api as any, client);

    const result: any = await executeTool(t, "leadbay_login", {
      email: "a@b.com",
      password: "x",
    });

    expect(result.success).toBe(true);
    // And no unhandled rejection bubbles up — waiting a tick confirms
    await new Promise((r) => setImmediate(r));
  });
});
