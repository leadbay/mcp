/**
 * Remote (hosted HTTP) per-user telemetry opt-out enforcement (product#3879).
 *
 * The hosted server is multi-tenant: telemetryHandleForRequest() reads the
 * request user's telemetry_enabled from /users/me and returns NOOP_TELEMETRY
 * when the user opted out, so a disabled user's tool calls emit NOTHING —
 * per-request, without affecting other tenants. This is the web-safe
 * enforcement point (a local file would be wrong for shared/web users).
 *
 * posthog-node is mocked at the module boundary; NODE_ENV=development so the
 * process-level handle initTelemetry builds is the real (mocked) path — proving
 * the difference between an opted-in and an opted-out request is real capture vs
 * none, not just "NOOP everywhere because telemetry is off".
 */

import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

const posthogState = vi.hoisted(() => ({
  captures: [] as Array<{ distinctId: string; event: string }>,
}));

vi.mock("posthog-node", () => {
  class PostHog {
    constructor(_key: string, _options: any) {}
    capture(payload: any) {
      posthogState.captures.push(payload);
    }
    identify(_payload: any) {}
    async shutdown(_timeoutMs?: number) {}
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

const savedNodeEnv = process.env.NODE_ENV;
(process.env as any).NODE_ENV = "development";
delete process.env.LEADBAY_TELEMETRY_ENABLED;

const { telemetryHandleForRequest, bindTelemetryIdentity } = await import("../src/http-server.js");
const { NOOP_TELEMETRY } = await import("../src/telemetry.js");
const { LeadbayClient } = await import("@leadbay/core");

afterAll(() => {
  (process.env as any).NODE_ENV = savedNodeEnv;
});

beforeEach(() => {
  resetHttpMock();
  posthogState.captures.length = 0;
});

const meWith = (telemetry_enabled: boolean | undefined) => ({
  id: "u1",
  email: "alice@leadbay.test",
  name: "Alice",
  organization: { id: "org-a", name: "Acme" },
  ...(telemetry_enabled === undefined ? {} : { telemetry_enabled }),
});

describe("hosted HTTP per-user telemetry opt-out (product#3879)", () => {
  it("telemetry_enabled=true → the request handle captures the event", async () => {
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: meWith(true) }]);
    const client = new LeadbayClient("https://api-us.leadbay.app", "u.tok", "us");
    const handle = await telemetryHandleForRequest(client);
    handle.captureToolCall({ tool: "leadbay_pull_leads", ok: true, duration_ms: 5, format: "json", bytes: 10 });
    expect(posthogState.captures).toHaveLength(1);
    expect(posthogState.captures[0].distinctId).toBe("alice@leadbay.test");
  });

  it("telemetry_enabled=false → the request handle is NOOP, event suppressed", async () => {
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: meWith(false) }]);
    const client = new LeadbayClient("https://api-us.leadbay.app", "u.tok", "us");
    const handle = await telemetryHandleForRequest(client);
    handle.captureToolCall({ tool: "leadbay_pull_leads", ok: true, duration_ms: 5, format: "json", bytes: 10 });
    // The load-bearing guarantee: a disabled user's tool call emits NOTHING.
    expect(posthogState.captures).toHaveLength(0);
  });

  it("telemetry_enabled absent (older backend) → treated as enabled, event captured", async () => {
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: meWith(undefined) }]);
    const client = new LeadbayClient("https://api-us.leadbay.app", "u.tok", "us");
    const handle = await telemetryHandleForRequest(client);
    handle.captureToolCall({ tool: "leadbay_pull_leads", ok: true, duration_ms: 5, format: "json", bytes: 10 });
    expect(posthogState.captures).toHaveLength(1);
  });

  it("multi-tenant: user A (disabled) suppressed while user B (enabled) still captures", async () => {
    // Two sequential requests, two different clients/users. A opted out, B did not.
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: {
      id: "ua", email: "a@leadbay.test", organization: { id: "org-a", name: "A" }, telemetry_enabled: false,
    } }]);
    const handleA = await telemetryHandleForRequest(new LeadbayClient("https://api-us.leadbay.app", "u.tokA", "us"));
    handleA.captureToolCall({ tool: "leadbay_pull_leads", ok: true, duration_ms: 5, format: "json", bytes: 10 });

    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: {
      id: "ub", email: "b@leadbay.test", organization: { id: "org-b", name: "B" }, telemetry_enabled: true,
    } }]);
    const handleB = await telemetryHandleForRequest(new LeadbayClient("https://api-us.leadbay.app", "u.tokB", "us"));
    handleB.captureToolCall({ tool: "leadbay_pull_leads", ok: true, duration_ms: 5, format: "json", bytes: 10 });

    const ids = posthogState.captures.map((c) => c.distinctId);
    expect(ids).toEqual(["b@leadbay.test"]); // A suppressed, B captured
  });

  it("live suppression predicate: a mid-session opt-out flips the SAME bound handle (SSE)", () => {
    // The SSE session builds its handle ONCE but passes a live `() => suppressed`
    // predicate; POST /messages flips `suppressed` after a mid-session disable.
    // Proves the same handle stops emitting without rebuild (product#3879 P1).
    const identity = { distinctId: "alice@leadbay.test", region: "us" };
    let suppressed = false;
    const handle = bindTelemetryIdentity(telemetry_base(), identity, () => suppressed);

    handle.captureToolCall({ tool: "leadbay_pull_leads", ok: true, duration_ms: 5, format: "json", bytes: 10 });
    expect(posthogState.captures).toHaveLength(1); // enabled → captured

    suppressed = true; // user disabled mid-session; POST /messages refreshed the flag
    handle.captureToolCall({ tool: "leadbay_pull_leads", ok: true, duration_ms: 5, format: "json", bytes: 10 });
    expect(posthogState.captures).toHaveLength(1); // still 1 — the flip took effect on the same handle
  });

  it("captureException is suppressed too when opted out (no Sentry leak for opted-out SSE users)", () => {
    // server.ts fires captureException on tool errors → Sentry. A suppressed
    // session must drop it, matching the streamable NOOP path (Codex P1).
    const identity = { distinctId: "alice@leadbay.test", region: "us" };
    let suppressed = false;
    let exceptionCalls = 0;
    const base: TelemetryHandle = {
      ...NOOP_TELEMETRY,
      captureException: () => { exceptionCalls++; },
    };
    const handle = bindTelemetryIdentity(base, identity, () => suppressed);

    handle.captureException(new Error("boom"), { tool: "leadbay_pull_leads" });
    expect(exceptionCalls).toBe(1); // enabled → forwarded to Sentry

    suppressed = true;
    handle.captureException(new Error("boom2"), { tool: "leadbay_pull_leads" });
    expect(exceptionCalls).toBe(1); // opted out → suppressed, not sent
  });
});

// The process-level real handle (mocked PostHog) that bindTelemetryIdentity wraps.
// Built via telemetryHandleForRequest on an enabled user so we reuse the same
// initialized handle the SSE path binds. Simpler: resolve one enabled handle's base
// by binding NOOP is wrong (we need the real one) — so we grab it through a known
// enabled resolve.
function telemetry_base() {
  // The module-scoped shared handle is what bindTelemetryIdentity wraps in prod.
  // We can't import it directly, but NOOP_TELEMETRY has the same surface and,
  // crucially, the predicate gate lives in the WRAPPER (bindTelemetryIdentity),
  // not the base — so a real base isn't needed to prove the gate. Use a spy base
  // that records captures the same way the posthog mock does.
  return {
    ...NOOP_TELEMETRY,
    captureToolCall: (p: any, id: any) =>
      posthogState.captures.push({ distinctId: id?.distinctId ?? "?", event: "mcp tool called" }),
  };
}
