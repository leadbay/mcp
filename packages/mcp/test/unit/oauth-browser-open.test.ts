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
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { createServer } from "node:http";
import {
  browserOpenCandidates,
  browserLaunchEnv,
  oauthLogin,
  startLoopbackListener,
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
      // start + empty-title quoting preserved. The URL is double-quoted so cmd
      // doesn't truncate it at `&` (query-param separators) — bare `&` is a cmd
      // command separator. Verbatim spawn (see oauth.ts) keeps the quotes.
      expect(cands[0].args).toEqual(["/c", "start", '""', `"${URL_ARG}"`]);
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

describe("browserLaunchEnv — reconstruct missing display vars (Linux)", () => {
  const realPlatform = process.platform;
  const SAVED = {
    DISPLAY: process.env.DISPLAY,
    WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
  };
  function setPlatform(p: NodeJS.Platform) {
    Object.defineProperty(process, "platform", { value: p, configurable: true });
  }
  afterEach(() => {
    setPlatform(realPlatform);
    for (const [k, v] of Object.entries(SAVED)) {
      if (v === undefined) delete (process.env as any)[k];
      else (process.env as any)[k] = v;
    }
  });

  it("does not touch the env on non-Linux", () => {
    setPlatform("darwin");
    delete process.env.DISPLAY;
    const env = browserLaunchEnv();
    expect(env.DISPLAY).toBeUndefined(); // untouched on mac
  });

  it("leaves an already-set DISPLAY/WAYLAND_DISPLAY unchanged", () => {
    setPlatform("linux");
    process.env.DISPLAY = ":7";
    process.env.WAYLAND_DISPLAY = "wayland-3";
    const env = browserLaunchEnv();
    expect(env.DISPLAY).toBe(":7");
    expect(env.WAYLAND_DISPLAY).toBe("wayland-3");
  });

  it("injects a DISPLAY when it's missing (the Claude Desktop strip case)", () => {
    setPlatform("linux");
    delete process.env.DISPLAY;
    const env = browserLaunchEnv();
    // Always backfills at least the ":0" default so xdg-open can reach a display.
    expect(env.DISPLAY).toMatch(/^:\d+$/);
  });
});

describe("startLoopbackListener — stable-port fallback", () => {
  it("binds the next preferred port when the first is busy", async () => {
    // Occupy a port, then ask the listener to prefer [busy, free].
    const blocker = createServer(() => {});
    const busyPort = await new Promise<number>((resolve) => {
      blocker.listen(0, "127.0.0.1", () => {
        resolve((blocker.address() as any).port);
      });
    });
    // A second free port to be the fallback target.
    const probe = createServer(() => {});
    const freePort = await new Promise<number>((resolve) => {
      probe.listen(0, "127.0.0.1", () => {
        const p = (probe.address() as any).port;
        probe.close(() => resolve(p));
      });
    });

    let listener: Awaited<ReturnType<typeof startLoopbackListener>> | undefined;
    try {
      listener = await startLoopbackListener({
        expectedState: "s",
        timeoutMs: 200,
        preferredPorts: [busyPort, freePort],
      });
      // It skipped the busy one and bound the free one.
      expect(listener.port).toBe(freePort);
      expect(listener.redirectUri).toBe(`http://127.0.0.1:${freePort}/callback`);
    } finally {
      listener?.close();
      blocker.close();
    }
  });

  it("falls back to an ephemeral port when ALL preferred are busy", async () => {
    const blocker = createServer(() => {});
    const busyPort = await new Promise<number>((resolve) => {
      blocker.listen(0, "127.0.0.1", () => resolve((blocker.address() as any).port));
    });
    let listener: Awaited<ReturnType<typeof startLoopbackListener>> | undefined;
    try {
      listener = await startLoopbackListener({
        expectedState: "s",
        timeoutMs: 200,
        preferredPorts: [busyPort], // the only preferred port is taken
      });
      // Still came up — on some non-busy ephemeral port.
      expect(listener.port).toBeGreaterThan(0);
      expect(listener.port).not.toBe(busyPort);
    } finally {
      listener?.close();
      blocker.close();
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

  it("reuses a cached client_id and does NOT POST to the registration endpoint", async () => {
    // Only discovery is declared — NO /register endpoint. The harness throws if
    // the code hits an undeclared endpoint, so a registration attempt fails the
    // test. This proves the cached id skips registration (the 429 root cause).
    const captured = mockHttp([
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
    ]);
    let surfaced: string | undefined;
    let registeredCalled = false;
    let askedPort: number | undefined;
    await oauthLogin({
      authServerBaseUrl: "https://api-us.leadbay.app",
      clientName: "Leadbay MCP @ test",
      openBrowser: async () => {},
      // Cache hit for whatever port the listener bound (port-keyed lookup).
      getCachedClientId: (port) => {
        askedPort = port;
        return "cached-123";
      },
      onClientRegistered: () => {
        registeredCalled = true;
      },
      onAuthorizeUrl: (url) => {
        surfaced = url;
      },
      timeoutMs: 120,
    }).catch(() => {
      /* expected timeout on the callback wait */
    });
    expect(registeredCalled).toBe(false);
    expect(captured.requests.some((r) => r.path.includes("/oauth/register"))).toBe(false);
    // The cache was consulted with the bound loopback port (port-keyed reuse).
    expect(typeof askedPort).toBe("number");
    // The cached id is what ends up in the authorize URL.
    expect(surfaced).toContain("client_id=cached-123");
  });

  it("registers when no cache, and reports the new id via onClientRegistered", async () => {
    discoveryAndRegister();
    let persisted: string | undefined;
    await oauthLogin({
      authServerBaseUrl: "https://api-us.leadbay.app",
      clientName: "Leadbay MCP @ test",
      openBrowser: async () => {},
      getCachedClientId: () => undefined, // no cache → must register
      onClientRegistered: (id) => {
        persisted = id;
      },
      timeoutMs: 120,
    }).catch(() => {
      /* expected timeout on the callback wait */
    });
    expect(persisted).toBe("99"); // the registration response's client_id
  });

  it("registers and authorizes with the SAME concrete loopback port (exact-match)", async () => {
    // Regression: the Leadbay backend pins the EXACT registered redirect_uri
    // (port included) and rejects any mismatch at /authorize ("redirect URL not
    // authorized") — it does NOT do RFC 8252 loopback-port matching. So the port
    // in the registration body MUST equal the port in the authorize URL. We bind
    // a stable port so a cached client_id keeps matching across launches.
    const captured = discoveryAndRegister();
    let authUrl: string | undefined;
    let registeredPort: number | undefined;
    await oauthLogin({
      authServerBaseUrl: "https://api-us.leadbay.app",
      clientName: "Leadbay MCP @ test",
      openBrowser: async () => {},
      getCachedClientId: () => undefined,
      onClientRegistered: (_id, port) => {
        registeredPort = port;
      },
      onAuthorizeUrl: (u) => {
        authUrl = u;
      },
      timeoutMs: 120,
    }).catch(() => {});

    // The registration body carries a CONCRETE 127.0.0.1:<port>/callback.
    const regReq = captured.requests.find((r) => r.path.includes("/oauth/register"));
    expect(regReq).toBeDefined();
    const regPortMatch = regReq!.body.match(/127\.0\.0\.1:(\d+)\\?\/callback/);
    expect(regPortMatch).not.toBeNull();
    const regPort = Number(regPortMatch![1]);

    // The authorize URL carries the SAME port (exact match — the whole point).
    const authPortMatch = authUrl?.match(/127\.0\.0\.1%3A(\d+)%2Fcallback/);
    expect(authPortMatch).not.toBeNull();
    expect(Number(authPortMatch![1])).toBe(regPort);

    // And that's the port reported to the cache, so reuse is keyed correctly.
    expect(registeredPort).toBe(regPort);
  });

  it("fires onAuthorizeUrl with the live URL before blocking on the callback", async () => {
    discoveryAndRegister();
    let surfaced: string | undefined;
    // openBrowser is a no-op (as the non-blocking bootstrap passes — it drives
    // the open itself from onAuthorizeUrl). The callback wait times out fast.
    await oauthLogin({
      authServerBaseUrl: "https://api-us.leadbay.app",
      clientName: "Leadbay MCP @ test",
      openBrowser: async () => {},
      onAuthorizeUrl: (url) => {
        surfaced = url;
      },
      timeoutMs: 150,
    }).catch(() => {
      /* expected timeout — we only care that onAuthorizeUrl fired */
    });
    // The URL was surfaced (the listener is already live when this fires, so
    // it's immediately clickable), with the right client + PKCE params.
    expect(surfaced).toBeDefined();
    expect(surfaced!).toContain("https://leadbay.app/oauth/authorize");
    expect(surfaced!).toContain("client_id=99");
    expect(surfaced!).toMatch(/redirect_uri=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fcallback/);
  });
});
