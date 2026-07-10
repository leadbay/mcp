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

const { telemetryHandleForRequest } = await import("../src/http-server.js");
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
});
