/**
 * Tests for the login tool (protocol-agnostic Tool shape).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  createLogger,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { login } from "../../../src/tools/login.js";

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
        { method: "GET", path: /\/1\.5\/users\/me/, status: 404, body: {} },
      ]);
      const client = new LeadbayClient(BASE);
      const { logger } = createLogger();

      await login.execute(
        client,
        { email: "a@b.com", password: input },
        { logger }
      );

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
    const client = new LeadbayClient(BASE);
    const { logger } = createLogger();

    const result: any = await login.execute(
      client,
      { email: "a@b.com", password: "secret" },
      { logger }
    );

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
    const client = new LeadbayClient(BASE);
    const { logger } = createLogger();

    const result: any = await login.execute(
      client,
      { email: "a@b.com", password: "wrong" },
      { logger }
    );

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
    const client = new LeadbayClient(BASE);
    const { logger } = createLogger();

    const result: any = await login.execute(
      client,
      { email: "a@b.com", password: "x" },
      { logger }
    );

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
      { method: "GET", path: /users\/me/, status: 500, body: {} },
    ]);
    const client = new LeadbayClient(BASE);
    const { logger } = createLogger();

    const result: any = await login.execute(
      client,
      { email: "a@b.com", password: "x" },
      { logger }
    );

    expect(result.success).toBe(true);
    await new Promise((r) => setImmediate(r));
  });

  it("logger.info and logger.error are invoked with descriptive messages", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.5/auth/login",
        status: 401,
        body: { message: "bad" },
      },
    ]);
    const client = new LeadbayClient(BASE);
    const { logger, logs } = createLogger();

    await login.execute(
      client,
      { email: "a@b.com", password: "wrong" },
      { logger }
    );

    expect(logs.some((l) => l.level === "info" && /login: email=/.test(l.msg))).toBe(true);
    expect(logs.some((l) => l.level === "error")).toBe(true);
  });
});
