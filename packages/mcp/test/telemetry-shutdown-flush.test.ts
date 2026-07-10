/**
 * RC2 + RC3 regression net (leadbay/product#3876).
 *
 * RC2 — telemetry.ts shutdown() previously called posthog.shutdown() but never
 * flushPending(). Events captured before /users/me identity resolved sit in an
 * in-memory pendingEvents buffer and are handed to posthog only by flushPending()
 * (called from identify()). If identity never resolved (broken/expired client,
 * offline, tokenless bootstrap that never completed), shutdown() flushed an EMPTY
 * posthog queue and the buffered events were lost. Fix: shutdown() drains the
 * buffer anonymously (distinctId "mcp:unknown") before posthog.shutdown().
 *
 * RC3 — the PostHog client used a fixed flushAt:20 / flushInterval:10_000. The
 * stdio server (short-lived, single-user) now passes flushAt:1 so a brief session
 * delivers promptly instead of relying solely on shutdown. This asserts the opt
 * reaches the PostHog constructor.
 *
 * Also covers the per-call CaptureIdentity override bypassing the pending buffer.
 *
 * PostHog + Sentry are mocked at the module boundary; NODE_ENV is forced to
 * "development" so initTelemetry builds the real (mocked) path instead of NOOP.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

// Shared invocation log so we can assert ordering (capture BEFORE shutdown).
const calls = vi.hoisted(() => ({
  log: [] as string[],
  captures: [] as Array<{ distinctId: string; event: string; properties: Record<string, unknown> }>,
  initOptions: undefined as any,
}));

vi.mock("posthog-node", () => {
  class PostHog {
    constructor(_key: string, options: any) {
      calls.initOptions = options;
    }
    capture(payload: any) {
      calls.log.push(`capture:${payload.event}`);
      calls.captures.push(payload);
    }
    identify(_payload: any) {}
    async shutdown(_timeoutMs?: number) {
      calls.log.push("shutdown");
    }
  }
  return { PostHog };
});

vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  setUser: vi.fn(),
  captureException: vi.fn(),
  captureFeedback: vi.fn(),
  withScope: vi.fn((fn: (s: any) => void) =>
    fn({ setTag: vi.fn(), setExtra: vi.fn(), setFingerprint: vi.fn(), setUser: vi.fn() })
  ),
  flush: vi.fn(async () => true),
  close: vi.fn(async () => true),
  httpIntegration: vi.fn(() => ({ name: "Http" })),
}));

import { initTelemetry } from "../src/telemetry.js";

let savedNodeEnv: string | undefined;

beforeEach(() => {
  resetHttpMock();
  calls.log.length = 0;
  calls.captures.length = 0;
  calls.initOptions = undefined;
  savedNodeEnv = process.env.NODE_ENV;
  (process.env as any).NODE_ENV = "development";
  delete process.env.LEADBAY_TELEMETRY_ENABLED;
});

afterEach(() => {
  (process.env as any).NODE_ENV = savedNodeEnv;
});

describe("telemetry shutdown flush (RC2)", () => {
  it("flushes buffered events on shutdown when identity never resolved", async () => {
    const t = initTelemetry({ version: "9.9.9-dev" });
    // Capture WITHOUT ever calling identify() — the event goes into pendingEvents.
    t.captureToolCall({ tool: "leadbay_pull_leads", ok: true, duration_ms: 5, format: "json", bytes: 10 });
    // Before shutdown, nothing has reached posthog.capture yet (still buffered).
    expect(calls.log).toEqual([]);

    await t.shutdown();

    // The buffered event must be captured BEFORE posthog.shutdown, attributed to
    // the anonymous sentinel — the exact drop the fix prevents. The sentinel is
    // "mcp:user-unknown" because the fallback sets id:"unknown" (mirroring the
    // identify-failure path), which distinctIdFor() maps to `mcp:user-<id>`.
    expect(calls.log).toEqual(["capture:mcp tool called", "shutdown"]);
    expect(calls.captures).toHaveLength(1);
    expect(calls.captures[0].distinctId).toBe("mcp:user-unknown");
    expect(calls.captures[0].event).toBe("mcp tool called");
  });

  it("still calls posthog.shutdown when there were no pending events", async () => {
    const t = initTelemetry({ version: "9.9.9-dev" });
    await t.shutdown();
    // No captures to flush, but shutdown still runs (existing contract preserved).
    expect(calls.log).toEqual(["shutdown"]);
    expect(calls.captures).toHaveLength(0);
  });
});

describe("telemetry flush config (RC3)", () => {
  it("passes flushAt:1 through to the PostHog constructor", async () => {
    initTelemetry({ version: "9.9.9-dev", flushAt: 1, flushInterval: 5_000 });
    expect(calls.initOptions.flushAt).toBe(1);
    expect(calls.initOptions.flushInterval).toBe(5_000);
  });

  it("defaults to flushAt:20 / flushInterval:10_000 when unset", async () => {
    initTelemetry({ version: "9.9.9-dev" });
    expect(calls.initOptions.flushAt).toBe(20);
    expect(calls.initOptions.flushInterval).toBe(10_000);
  });
});

describe("telemetry per-call identity override", () => {
  it("captures immediately with the override, bypassing the pending buffer (no identify)", async () => {
    const t = initTelemetry({ version: "9.9.9-dev" });
    t.captureToolCall(
      { tool: "leadbay_pull_leads", ok: true, duration_ms: 5, format: "json", bytes: 10 },
      { distinctId: "bob@x.test", groups: { organization: "org-9" }, region: "fr" }
    );
    // Captured NOW — no identify() ever called, buffer bypassed.
    expect(calls.captures).toHaveLength(1);
    const c = calls.captures[0];
    expect(c.distinctId).toBe("bob@x.test");
    expect((c.properties as any).region).toBe("fr");
    expect(c.event).toBe("mcp tool called");
  });

  it("without an identity override and without identify, the event stays buffered (stdio behaviour unchanged)", async () => {
    const t = initTelemetry({ version: "9.9.9-dev" });
    t.captureToolCall({ tool: "leadbay_pull_leads", ok: true, duration_ms: 5, format: "json", bytes: 10 });
    // Buffered — nothing reached posthog.capture until identity resolves or shutdown flushes.
    expect(calls.captures).toHaveLength(0);
  });

  it("a startup event with an explicit identity captures immediately (HTTP boot signal not buffered)", async () => {
    // The HTTP server never calls identify(), so its boot signal must pass an
    // explicit identity or it would sit in pendingEvents until shutdown (or be
    // lost on a crash). With the override, it captures on the spot.
    const t = initTelemetry({ version: "9.9.9-dev" });
    t.captureStartup(
      { auth_state: "ok", region: "unknown" },
      { distinctId: "mcp:http-server", region: "unknown" }
    );
    expect(calls.captures).toHaveLength(1);
    expect(calls.captures[0].distinctId).toBe("mcp:http-server");
    expect(calls.captures[0].event).toBe("mcp startup");
  });
});
