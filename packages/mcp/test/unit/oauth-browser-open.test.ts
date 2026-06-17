/**
 * Regression tests for OAuth-on-install browser launch (0.21.2).
 *
 * Root cause being guarded: Claude Desktop spawns the .dxt/.mcpb stdio server
 * with a sanitized environment whose PATH does NOT contain `open` / `xdg-open`
 * / `cmd`. The old `openInBrowser` spawned those bare command names, so the
 * launch failed with ENOENT, no browser opened, and the server dangled on the
 * 5-minute OAuth callback wait. These tests pin:
 *
 *   1. browserOpenCandidates() leads with the OS launcher's ABSOLUTE path on
 *      every platform, so the launch doesn't depend on PATH, and keeps the
 *      bare-command lookup only as a trailing fallback.
 *   2. oauthLogin({ failFastOnOpenError: true }) throws BrowserOpenFailedError
 *      carrying the authorize URL — instead of blocking for the full timeout —
 *      when the browser can't be opened, so the caller can surface a clickable
 *      sign-in link.
 *
 * New file (existing oauth.test.ts is left untouched).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import {
  browserOpenCandidates,
  oauthLogin,
  BrowserOpenFailedError,
} from "../../src/oauth.js";

beforeEach(() => {
  resetHttpMock();
});

describe("browserOpenCandidates — PATH-independent launch", () => {
  const URL_ARG = "https://leadbay.app/oauth/authorize?x=1";
  const realPlatform = process.platform;

  function setPlatform(p: NodeJS.Platform) {
    Object.defineProperty(process, "platform", { value: p, configurable: true });
  }

  it("macOS leads with /usr/bin/open, then bare `open` as fallback", () => {
    setPlatform("darwin");
    try {
      const cands = browserOpenCandidates(URL_ARG);
      expect(cands[0]).toEqual({ cmd: "/usr/bin/open", args: [URL_ARG] });
      expect(cands.map((c) => c.cmd)).toContain("open");
      expect(cands[0].cmd).toMatch(/^\//); // absolute first
    } finally {
      setPlatform(realPlatform);
    }
  });

  it("Windows leads with an absolute cmd.exe under %SystemRoot%", () => {
    setPlatform("win32");
    const savedRoot = process.env.SystemRoot;
    process.env.SystemRoot = "C:\\Windows";
    try {
      const cands = browserOpenCandidates(URL_ARG);
      expect(cands[0].cmd).toBe("C:\\Windows\\System32\\cmd.exe");
      // start + empty-title quoting preserved.
      expect(cands[0].args).toEqual(["/c", "start", '""', URL_ARG]);
      expect(cands.map((c) => c.cmd)).toContain("cmd"); // bare fallback kept
    } finally {
      if (savedRoot === undefined) delete process.env.SystemRoot;
      else process.env.SystemRoot = savedRoot;
      setPlatform(realPlatform);
    }
  });

  it("Linux leads with /usr/bin/xdg-open and keeps bare xdg-open last", () => {
    setPlatform("linux");
    try {
      const cands = browserOpenCandidates(URL_ARG);
      expect(cands[0]).toEqual({ cmd: "/usr/bin/xdg-open", args: [URL_ARG] });
      expect(cands[0].cmd).toMatch(/^\//);
      expect(cands[cands.length - 1].cmd).toBe("xdg-open");
    } finally {
      setPlatform(realPlatform);
    }
  });
});

describe("oauthLogin — failFastOnOpenError", () => {
  const discoveryAndRegister = () =>
    mockHttp([
      {
        method: "GET",
        path: "/.well-known/oauth-authorization-server",
        status: 200,
        body: {
          issuer: "https://api-us.leadbay.app",
          authorization_endpoint: "https://leadbay.app/oauth/authorize",
          token_endpoint: "https://api-us.leadbay.app/1.6/oauth/token",
          registration_endpoint: "https://api-us.leadbay.app/1.6/oauth/register",
          code_challenge_methods_supported: ["S256"],
        },
      },
      {
        method: "POST",
        path: "/1.6/oauth/register",
        status: 201,
        body: { client_id: "99", redirect_uris: [], token_endpoint_auth_method: "none" },
      },
    ]);

  it("throws BrowserOpenFailedError with the authorize URL when open fails", async () => {
    discoveryAndRegister();
    const failingOpen = async () => {
      throw Object.assign(new Error("spawn xdg-open ENOENT"), { code: "ENOENT" });
    };

    let caught: unknown;
    try {
      await oauthLogin({
        authServerBaseUrl: "https://api-us.leadbay.app",
        clientName: "Leadbay MCP @ test",
        openBrowser: failingOpen,
        failFastOnOpenError: true,
        timeoutMs: 60_000, // long — the test asserts we DON'T wait for it
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BrowserOpenFailedError);
    const e = caught as BrowserOpenFailedError;
    expect(e.authorizeUrl).toContain("https://leadbay.app/oauth/authorize");
    expect(e.authorizeUrl).toContain("client_id=99");
    expect(e.authorizeUrl).toContain("code_challenge_method=S256");
  });

  it("without failFastOnOpenError, a failed open does NOT throw eagerly (legacy wait)", async () => {
    discoveryAndRegister();
    const failingOpen = async () => {
      throw new Error("spawn xdg-open ENOENT");
    };

    // No fail-fast: the flow proceeds to waitForCallback, which we time out
    // quickly. The thrown error is the TIMEOUT, not BrowserOpenFailedError —
    // proving the open-failure alone didn't abort the flow.
    let caught: unknown;
    try {
      await oauthLogin({
        authServerBaseUrl: "https://api-us.leadbay.app",
        clientName: "Leadbay MCP @ test",
        openBrowser: failingOpen,
        timeoutMs: 150,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeInstanceOf(BrowserOpenFailedError);
    expect((caught as Error).message).toMatch(/timed out/i);
  });
});
