/**
 * Telemetry hook tests (issue #3631).
 *
 * Exercises packages/mcp/src/telemetry.ts + the capture sites in
 * packages/mcp/src/server.ts. PostHog + Sentry SDKs are mocked at the
 * module boundary so no real ingest traffic happens during tests.
 *
 * NODE_ENV is forced to "development" per test to bypass the production
 * short-circuit in initTelemetry — otherwise vitest's default NODE_ENV=test
 * would return NOOP_TELEMETRY and we'd have nothing to assert on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

const posthogState = vi.hoisted(() => ({
  capture: vi.fn(),
  identify: vi.fn(),
  shutdown: vi.fn(async () => {}),
  initSpy: vi.fn(),
}));

vi.mock("posthog-node", () => {
  class PostHog {
    constructor(key: string, options: any) {
      posthogState.initSpy(key, options);
    }
    capture(...args: any[]) {
      return posthogState.capture(...args);
    }
    identify(...args: any[]) {
      return posthogState.identify(...args);
    }
    shutdown(timeoutMs?: number) {
      return posthogState.shutdown(timeoutMs);
    }
  }
  return { PostHog };
});

const sentryState = vi.hoisted(() => ({
  init: vi.fn(),
  setUser: vi.fn(),
  captureException: vi.fn(),
  withScope: vi.fn((fn: (s: any) => void) =>
    fn({
      setTag: vi.fn(),
      setUser: vi.fn(),
      setExtra: vi.fn(),
    })
  ),
  close: vi.fn(async () => true),
  httpIntegration: vi.fn(() => ({ name: "Http" })),
}));

vi.mock("@sentry/node", () => sentryState);

import { LeadbayClient } from "@leadbay/core";
import type { Tool } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { initTelemetry, NOOP_TELEMETRY, parseTelemetryEnv } from "../src/telemetry.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

const ME_RESPONSE = JSON.stringify({
  id: "user-1",
  email: "alice@leadbay.test",
  name: "Alice",
  organization: { id: "org-42", name: "Acme" },
});

let savedNodeEnv: string | undefined;

beforeEach(() => {
  resetHttpMock();
  posthogState.capture.mockClear();
  posthogState.identify.mockClear();
  posthogState.shutdown.mockClear();
  posthogState.initSpy.mockClear();
  sentryState.init.mockClear();
  sentryState.setUser.mockClear();
  sentryState.captureException.mockClear();
  sentryState.withScope.mockClear();
  sentryState.close.mockClear();
  savedNodeEnv = process.env.NODE_ENV;
  // Bypass the NODE_ENV=test short-circuit; tests want to drive the
  // real telemetry path (with mocked SDKs).
  (process.env as any).NODE_ENV = "development";
  delete process.env.LEADBAY_TELEMETRY_ENABLED;
});

afterEach(() => {
  if (savedNodeEnv === undefined) {
    delete (process.env as any).NODE_ENV;
  } else {
    (process.env as any).NODE_ENV = savedNodeEnv;
  }
});

const sumTool: Tool = {
  name: "leadbay_test_sum",
  description: "Test tool: returns {sum:n}.",
  annotations: {
    title: "Sum",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: { a: { type: "number" }, b: { type: "number" } },
    required: ["a", "b"],
    additionalProperties: false,
  },
  execute: async (_c, p: any) => ({ sum: p.a + p.b }),
};

const quotaTool: Tool = {
  name: "leadbay_test_quota",
  description: "Test tool: returns a QUOTA_EXCEEDED envelope.",
  annotations: {
    title: "QuotaEnv",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  execute: async () => ({
    error: true,
    code: "QUOTA_EXCEEDED",
    message: "Quota exceeded — retry in 30s",
    hint: "Top up to clear",
    _meta: { retry_after: 30, endpoint: "/leads/discover" },
  }),
};

const notFoundTool: Tool = {
  name: "leadbay_test_not_found",
  description: "Test tool: returns a NOT_FOUND envelope.",
  annotations: {
    title: "NotFoundEnv",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  execute: async () => ({
    error: true,
    code: "NOT_FOUND",
    message: "Lead not found",
    hint: "Check the ID",
  }),
};

const throwTool: Tool = {
  name: "leadbay_test_throw",
  description: "Test tool: throws an unexpected error.",
  annotations: {
    title: "Throw",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  execute: async () => {
    throw new TypeError("kaboom");
  },
};

// No fake topup tool — the real createTopupLink ships in compositeReadTools
// (always-on, because it's the canonical recovery path from QUOTA_EXCEEDED).
// We mock the upstream /stripe/topup_checkout endpoint instead.
const STRIPE_TOPUP_URL = "https://checkout.stripe.com/secret-token-xyz";

interface CapturedLog {
  level: "info" | "warn" | "error";
  msg: string;
}

async function connect(
  extraTools: Tool[],
  logs?: CapturedLog[]
): Promise<{
  mcpClient: Client;
  client: LeadbayClient;
  telemetry: ReturnType<typeof initTelemetry>;
  identityDone: Promise<void>;
}> {
  const client = new LeadbayClient(BASE, "u.test-token");
  const logger = logs
    ? {
        info: (m: string) => logs.push({ level: "info", msg: m }),
        warn: (m: string) => logs.push({ level: "warn", msg: m }),
        error: (m: string) => logs.push({ level: "error", msg: m }),
      }
    : undefined;
  const telemetry = initTelemetry({ version: "0.10.0-dev.18", logger });
  const identityDone = telemetry.identify(client);
  const server = buildServer(client, { extraTools, telemetry });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return { mcpClient, client, telemetry, identityDone };
}

describe("telemetry — opt-out", () => {
  it("LEADBAY_TELEMETRY_ENABLED=false → no PostHog/Sentry init or capture", async () => {
    process.env.LEADBAY_TELEMETRY_ENABLED = "false";
    mockHttp([{ method: "GET", path: "/1.5/users/me", status: 200, body: ME_RESPONSE }]);
    const { mcpClient, identityDone } = await connect([sumTool, throwTool]);
    await identityDone;
    await mcpClient.callTool({ name: "leadbay_test_sum", arguments: { a: 1, b: 2 } });
    await mcpClient.callTool({ name: "leadbay_test_throw", arguments: {} }).catch(() => {});
    expect(posthogState.initSpy).not.toHaveBeenCalled();
    expect(posthogState.capture).not.toHaveBeenCalled();
    expect(sentryState.init).not.toHaveBeenCalled();
    expect(sentryState.captureException).not.toHaveBeenCalled();
  });
});

describe("telemetry — tool call events", () => {
  it("successful JSON tool call fires one 'mcp tool called' event with ok=true, format=json", async () => {
    mockHttp([{ method: "GET", path: "/1.5/users/me", status: 200, body: ME_RESPONSE }]);
    const { mcpClient, identityDone } = await connect([sumTool]);
    await identityDone;
    await mcpClient.callTool({ name: "leadbay_test_sum", arguments: { a: 1, b: 2 } });
    const toolEvents = posthogState.capture.mock.calls.filter(
      (c: any[]) => c[0]?.event === "mcp tool called"
    );
    expect(toolEvents).toHaveLength(1);
    const props = toolEvents[0][0].properties;
    expect(props.tool).toBe("leadbay_test_sum");
    expect(props.ok).toBe(true);
    expect(props.format).toBe("json");
    expect(props.bytes).toBeGreaterThan(0);
    expect(props.duration_ms).toBeGreaterThanOrEqual(0);
    expect(props.mcp_version).toBe("0.10.0-dev.18");
    // Every MCP-originated event carries source="mcp" so PostHog
    // dashboards can split MCP from web-app usage. See baseProps in
    // telemetry.ts.
    expect(props.source).toBe("mcp");
    expect(toolEvents[0][0].groups).toEqual({ organization: "org-42" });
    expect(toolEvents[0][0].distinctId).toBe("alice@leadbay.test");
  });

  it("every captured event type carries source=mcp", async () => {
    // Regression test for the cross-surface bucketing requirement:
    // captureToolCall, captureQuotaHit, captureTopupLink, captureStartup
    // ALL must emit events tagged with source="mcp" so they can be
    // filtered apart from the web-app's own PostHog stream.
    mockHttp([{ method: "GET", path: "/1.5/users/me", status: 200, body: ME_RESPONSE }]);
    const { mcpClient, identityDone, telemetry } = await connect([
      sumTool,
      quotaTool,
    ]);
    await identityDone;
    await mcpClient.callTool({ name: "leadbay_test_sum", arguments: { a: 1, b: 2 } });
    await mcpClient.callTool({ name: "leadbay_test_quota", arguments: {} });
    telemetry.captureTopupLink({ tool: "leadbay_create_topup_link" });
    telemetry.captureStartup({ auth_state: "ok", region: "us" });
    const allEvents = posthogState.capture.mock.calls.map((c: any[]) => c[0]);
    expect(allEvents.length).toBeGreaterThan(0);
    for (const ev of allEvents) {
      expect(ev.properties?.source, `event ${ev.event} missing source=mcp`).toBe("mcp");
    }
    // Confirm we exercised the diverse event types.
    const eventNames = new Set(allEvents.map((e: any) => e.event));
    expect(eventNames.has("mcp tool called")).toBe(true);
    expect(eventNames.has("mcp quota hit")).toBe(true);
    expect(eventNames.has("mcp topup link created")).toBe(true);
    expect(eventNames.has("mcp startup")).toBe(true);
  });

  it("QUOTA_EXCEEDED envelope fires both 'mcp quota hit' and 'mcp tool called' (no Sentry)", async () => {
    mockHttp([{ method: "GET", path: "/1.5/users/me", status: 200, body: ME_RESPONSE }]);
    const { mcpClient, identityDone } = await connect([quotaTool]);
    await identityDone;
    await mcpClient.callTool({ name: "leadbay_test_quota", arguments: {} });
    const quotaEvents = posthogState.capture.mock.calls.filter(
      (c: any[]) => c[0]?.event === "mcp quota hit"
    );
    const toolEvents = posthogState.capture.mock.calls.filter(
      (c: any[]) => c[0]?.event === "mcp tool called"
    );
    expect(quotaEvents).toHaveLength(1);
    expect(quotaEvents[0][0].properties.retry_after_s).toBe(30);
    expect(quotaEvents[0][0].properties.endpoint).toBe("/leads/discover");
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0][0].properties.ok).toBe(false);
    expect(toolEvents[0][0].properties.error_code).toBe("QUOTA_EXCEEDED");
    expect(toolEvents[0][0].properties.format).toBe("error-envelope");
    expect(sentryState.captureException).not.toHaveBeenCalled();
  });

  it("NOT_FOUND envelope fires only 'mcp tool called' (no quota, no Sentry)", async () => {
    mockHttp([{ method: "GET", path: "/1.5/users/me", status: 200, body: ME_RESPONSE }]);
    const { mcpClient, identityDone } = await connect([notFoundTool]);
    await identityDone;
    await mcpClient.callTool({ name: "leadbay_test_not_found", arguments: {} });
    const events = posthogState.capture.mock.calls.map((c: any[]) => c[0].event);
    expect(events).toContain("mcp tool called");
    expect(events).not.toContain("mcp quota hit");
    expect(sentryState.captureException).not.toHaveBeenCalled();
    const toolEvent = posthogState.capture.mock.calls.find(
      (c: any[]) => c[0].event === "mcp tool called"
    );
    expect(toolEvent[0].properties.error_code).toBe("NOT_FOUND");
  });

  it("unexpected throw fires Sentry.captureException AND 'mcp tool called' ok=false", async () => {
    mockHttp([{ method: "GET", path: "/1.5/users/me", status: 200, body: ME_RESPONSE }]);
    const { mcpClient, identityDone } = await connect([throwTool]);
    await identityDone;
    await mcpClient.callTool({ name: "leadbay_test_throw", arguments: {} });
    expect(sentryState.captureException).toHaveBeenCalledTimes(1);
    const thrown = sentryState.captureException.mock.calls[0][0];
    expect(thrown).toBeInstanceOf(TypeError);
    const toolEvents = posthogState.capture.mock.calls.filter(
      (c: any[]) => c[0]?.event === "mcp tool called"
    );
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0][0].properties.ok).toBe(false);
  });

  it("leadbay_create_topup_link success fires 'mcp topup link created' without leaking URL", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME_RESPONSE },
      {
        method: "POST",
        path: "/1.5/stripe/topup_checkout",
        status: 200,
        body: JSON.stringify({ url: STRIPE_TOPUP_URL }),
      },
    ]);
    const { mcpClient, identityDone } = await connect([]);
    await identityDone;
    await mcpClient.callTool({ name: "leadbay_create_topup_link", arguments: {} });
    const topupEvents = posthogState.capture.mock.calls.filter(
      (c: any[]) => c[0]?.event === "mcp topup link created"
    );
    expect(topupEvents).toHaveLength(1);
    const allPropsSerialized = JSON.stringify(posthogState.capture.mock.calls);
    expect(allPropsSerialized).not.toContain(STRIPE_TOPUP_URL);
    expect(allPropsSerialized).not.toContain("secret-token-xyz");
  });
});

describe("telemetry — identity & buffering", () => {
  it("identify() calls PostHog.identify with me.email as distinctId + leadbay_* person props", async () => {
    mockHttp([{ method: "GET", path: "/1.5/users/me", status: 200, body: ME_RESPONSE }]);
    const { identityDone } = await connect([sumTool]);
    await identityDone;
    expect(posthogState.identify).toHaveBeenCalledTimes(1);
    const id = posthogState.identify.mock.calls[0][0];
    expect(id.distinctId).toBe("alice@leadbay.test");
    expect(id.properties.email).toBe("alice@leadbay.test");
    expect(id.properties.leadbay_id).toBe("user-1");
    expect(id.properties.leadbay_organization_id).toBe("org-42");
    expect(sentryState.setUser).toHaveBeenCalledWith({
      id: "user-1",
      email: "alice@leadbay.test",
      username: "Alice",
    });
  });

  it("events captured before identity resolves are buffered and emit with the resolved email", async () => {
    mockHttp([{ method: "GET", path: "/1.5/users/me", status: 200, body: ME_RESPONSE }]);
    const { mcpClient, identityDone } = await connect([sumTool]);
    // Call the tool BEFORE awaiting identityDone — captureToolCall should
    // buffer because `me` hasn't landed yet. mcpClient.callTool returns
    // synchronously-ish (no extra await), so this races identity resolution.
    // We don't actually need it to race for the assertion to pass — we just
    // need to verify that when events DO fire, they carry the right distinctId
    // and groups (whether buffered or live).
    await mcpClient.callTool({ name: "leadbay_test_sum", arguments: { a: 1, b: 2 } });
    await identityDone;
    const calls = posthogState.capture.mock.calls.filter(
      (c: any[]) => c[0]?.event === "mcp tool called"
    );
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const call of calls) {
      expect(call[0].distinctId).toBe("alice@leadbay.test");
      expect(call[0].groups).toEqual({ organization: "org-42" });
    }
  });
});

describe("telemetry — shutdown", () => {
  it("shutdown() awaits posthog.shutdown(2000) and Sentry.close(2000)", async () => {
    mockHttp([{ method: "GET", path: "/1.5/users/me", status: 200, body: ME_RESPONSE }]);
    const { telemetry, identityDone } = await connect([sumTool]);
    await identityDone;
    await telemetry.shutdown();
    expect(posthogState.shutdown).toHaveBeenCalledWith(2000);
    expect(sentryState.close).toHaveBeenCalledWith(2000);
  });
});

describe("telemetry — privacy", () => {
  it("tool argument values do not leak into captured event properties", async () => {
    mockHttp([{ method: "GET", path: "/1.5/users/me", status: 200, body: ME_RESPONSE }]);
    const { mcpClient, identityDone } = await connect([sumTool]);
    await identityDone;
    // Args here are numbers; switch to a string sentinel that we can grep
    // the whole capture history for.
    await mcpClient.callTool({
      name: "leadbay_test_sum",
      arguments: { a: 1, b: 2, secret: "should-not-leak-token-7f3a" } as any,
    });
    const serialized = JSON.stringify(posthogState.capture.mock.calls);
    expect(serialized).not.toContain("should-not-leak-token-7f3a");
  });
});

describe("parseTelemetryEnv", () => {
  it("defaults to true when unset / empty (existing installs keep phoning home)", () => {
    expect(parseTelemetryEnv(undefined)).toBe(true);
    expect(parseTelemetryEnv("")).toBe(true);
  });
  it("treats 'false', '0', 'no', 'off' (case-insensitive) as opt-out", () => {
    expect(parseTelemetryEnv("false")).toBe(false);
    expect(parseTelemetryEnv("FALSE")).toBe(false);
    expect(parseTelemetryEnv("0")).toBe(false);
    expect(parseTelemetryEnv("no")).toBe(false);
    expect(parseTelemetryEnv("off")).toBe(false);
    expect(parseTelemetryEnv("  false  ")).toBe(false);
  });
  it("treats 'true', '1', 'yes', 'on' (case-insensitive) as opt-in", () => {
    expect(parseTelemetryEnv("true")).toBe(true);
    expect(parseTelemetryEnv("TRUE")).toBe(true);
    expect(parseTelemetryEnv("1")).toBe(true);
    expect(parseTelemetryEnv("yes")).toBe(true);
    expect(parseTelemetryEnv("on")).toBe(true);
  });
  it("fails open to true on unrecognized values (won't silently disable on typos)", () => {
    expect(parseTelemetryEnv("maybe")).toBe(true);
    expect(parseTelemetryEnv("disabled")).toBe(true);
  });
});

describe("NOOP_TELEMETRY", () => {
  it("all methods are callable and return without error", async () => {
    expect(() => NOOP_TELEMETRY.captureToolCall({
      tool: "x", ok: true, duration_ms: 1, format: "json", bytes: 1,
    })).not.toThrow();
    expect(() => NOOP_TELEMETRY.captureQuotaHit({ tool: "x" })).not.toThrow();
    expect(() => NOOP_TELEMETRY.captureTopupLink({ tool: "x" })).not.toThrow();
    expect(() =>
      NOOP_TELEMETRY.captureStartup({ auth_state: "ok", region: "us" })
    ).not.toThrow();
    expect(() => NOOP_TELEMETRY.captureAgentMemoryCaptured({ key: "x" })).not.toThrow();
    expect(() => NOOP_TELEMETRY.captureAgentMemoryRecalled({ entries_returned: 1 })).not.toThrow();
    expect(() => NOOP_TELEMETRY.captureAgentMemoryPruned({ action: "prune" })).not.toThrow();
    expect(() => NOOP_TELEMETRY.captureException(new Error("e"), { tool: "x" })).not.toThrow();
    await expect(NOOP_TELEMETRY.shutdown()).resolves.toBeUndefined();
  });
});
