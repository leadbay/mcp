/**
 * Artifact-runtime telemetry routing (product#4081).
 *
 * The @leadbay/components runtime reports its failures through the
 * `leadbay_report_artifact_error` tool. This file locks the DECISION that tool's
 * dispatch wiring makes — the same split the rest of the server already uses
 * for its own failures:
 *
 *   exceptions (something threw in the artifact page) → Sentry, source="artifact"
 *   outcomes   (nothing threw; the UI is just wrong)  → PostHog, "mcp artifact event"
 *
 * It also locks `_origin`, the provenance field that separates artifact-issued
 * tool traffic from agent-issued traffic on the events we already emit.
 *
 * PostHog + Sentry are mocked at the module boundary (same approach as
 * telemetry.test.ts) so nothing leaves the process.
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

const sentryState = vi.hoisted(() => {
  const scopes: Array<{
    tags: Record<string, unknown>;
    extras: Record<string, unknown>;
    fingerprint?: string[];
  }> = [];
  return {
    init: vi.fn(),
    setUser: vi.fn(),
    captureException: vi.fn(),
    withScope: vi.fn((fn: (s: any) => void) => {
      const scope: any = { tags: {}, extras: {}, fingerprint: undefined };
      scope.setTag = vi.fn((k: string, v: unknown) => { scope.tags[k] = v; });
      scope.setExtra = vi.fn((k: string, v: unknown) => { scope.extras[k] = v; });
      scope.setFingerprint = vi.fn((fp: string[]) => { scope.fingerprint = fp; });
      scope.setUser = vi.fn();
      scopes.push(scope);
      fn(scope);
      return undefined;
    }),
    close: vi.fn(async () => true),
    httpIntegration: vi.fn(() => ({ name: "Http" })),
    _scopes: scopes,
  };
});

vi.mock("@sentry/node", () => sentryState);

import { LeadbayClient } from "@leadbay/core";
import type { Tool } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { initTelemetry } from "../src/telemetry.js";
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
  posthogState.initSpy.mockClear();
  sentryState.captureException.mockClear();
  sentryState.withScope.mockClear();
  sentryState._scopes.length = 0;
  savedNodeEnv = process.env.NODE_ENV;
  (process.env as any).NODE_ENV = "development";
  delete process.env.LEADBAY_TELEMETRY_ENABLED;
});

afterEach(() => {
  if (savedNodeEnv === undefined) delete (process.env as any).NODE_ENV;
  else (process.env as any).NODE_ENV = savedNodeEnv;
});

const sumTool: Tool = {
  name: "leadbay_test_sum",
  description: "Test tool: returns {sum:n}.",
  annotations: { title: "Sum", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    type: "object",
    properties: { a: { type: "number" }, b: { type: "number" } },
    required: ["a", "b"],
    additionalProperties: false,
  },
  execute: async (_c, p: any) => ({ sum: p.a + p.b }),
};

async function connect(extraTools: Tool[] = []) {
  const client = new LeadbayClient(BASE, "u.test-token");
  const telemetry = initTelemetry({ version: "0.39.9" });
  const identityDone = telemetry.identify(client);
  const server = buildServer(client, { extraTools, telemetry });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([server.connect(st), mcpClient.connect(ct)]);
  return { mcpClient, identityDone };
}

const artifactEvents = () =>
  posthogState.capture.mock.calls
    .filter((c: any[]) => c[0]?.event === "mcp artifact event")
    .map((c: any[]) => c[0].properties);

const toolCallEvents = () =>
  posthogState.capture.mock.calls
    .filter((c: any[]) => c[0]?.event === "mcp tool called")
    .map((c: any[]) => c[0].properties);

const artifactScopes = () =>
  sentryState._scopes.filter((s) => s.tags.source === "artifact");

describe("exception kinds route to Sentry, not PostHog", () => {
  for (const kind of ["bridge_unavailable", "call_timeout", "call_failed", "parse_failed"]) {
    it(`${kind} → Sentry with source="artifact"`, async () => {
      mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: ME_RESPONSE }]);
      const { mcpClient, identityDone } = await connect();
      await identityDone;
      await mcpClient.callTool({
        name: "leadbay_report_artifact_error",
        arguments: { kind, surface: "action", tool: "leadbay_add_note", code: "timeout" },
      });
      expect(artifactScopes()).toHaveLength(1);
      expect(artifactScopes()[0].tags.tool).toBe("leadbay_add_note");
      // An exception must NOT also land in the outcome stream.
      expect(artifactEvents()).toHaveLength(0);
    });
  }

  it("fingerprints by (artifact, tool, code) — no stack crossed the bridge", async () => {
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: ME_RESPONSE }]);
    const { mcpClient, identityDone } = await connect();
    await identityDone;
    await mcpClient.callTool({
      name: "leadbay_report_artifact_error",
      arguments: { kind: "call_timeout", surface: "action", tool: "leadbay_add_note", code: "timeout" },
    });
    expect(artifactScopes()[0].fingerprint).toEqual([
      "mcp",
      "artifact",
      "leadbay_add_note",
      "timeout",
    ]);
  });

  it("two different artifact failures do not collapse into one Sentry issue", async () => {
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: ME_RESPONSE }]);
    const { mcpClient, identityDone } = await connect();
    await identityDone;
    await mcpClient.callTool({
      name: "leadbay_report_artifact_error",
      arguments: { kind: "call_timeout", surface: "action", tool: "leadbay_add_note", code: "timeout" },
    });
    await mcpClient.callTool({
      name: "leadbay_report_artifact_error",
      arguments: { kind: "call_failed", surface: "list", tool: "leadbay_pull_leads", code: "API_ERROR" },
    });
    const fps = artifactScopes().map((s) => JSON.stringify(s.fingerprint));
    expect(new Set(fps).size).toBe(2);
  });
});

describe("outcome kinds route to PostHog, not Sentry", () => {
  for (const kind of ["options_empty", "action_blocked", "result_rejected"]) {
    it(`${kind} → "mcp artifact event"`, async () => {
      mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: ME_RESPONSE }]);
      const { mcpClient, identityDone } = await connect();
      await identityDone;
      await mcpClient.callTool({
        name: "leadbay_report_artifact_error",
        arguments: { kind, surface: "field", tool: "leadbay_list_campaigns", kit_version: "0.6.0" },
      });
      const evs = artifactEvents();
      expect(evs).toHaveLength(1);
      expect(evs[0]).toMatchObject({
        kind,
        surface: "field",
        tool: "leadbay_list_campaigns",
        kit_version: "0.6.0",
      });
      // These never threw — Sentry must not see them.
      expect(artifactScopes()).toHaveLength(0);
    });
  }

  it("carries the standard MCP base props so it joins existing dashboards", async () => {
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: ME_RESPONSE }]);
    const { mcpClient, identityDone } = await connect();
    await identityDone;
    await mcpClient.callTool({
      name: "leadbay_report_artifact_error",
      arguments: { kind: "options_empty", surface: "field" },
    });
    expect(artifactEvents()[0]).toMatchObject({ source: "mcp", mcp_version: "0.39.9" });
  });

  it("never carries a message field (product#3943)", async () => {
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: ME_RESPONSE }]);
    const { mcpClient, identityDone } = await connect();
    await identityDone;
    await mcpClient.callTool({
      name: "leadbay_report_artifact_error",
      arguments: { kind: "result_rejected", surface: "action", code: "QUOTA_EXCEEDED" },
    });
    expect(artifactEvents()[0]).not.toHaveProperty("message");
  });
});

describe("the opt-out is honored without extra plumbing", () => {
  it("LEADBAY_TELEMETRY_ENABLED=false → nothing is emitted for either half", async () => {
    process.env.LEADBAY_TELEMETRY_ENABLED = "false";
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: ME_RESPONSE }]);
    const { mcpClient, identityDone } = await connect();
    await identityDone;
    await mcpClient.callTool({
      name: "leadbay_report_artifact_error",
      arguments: { kind: "call_failed", surface: "call" },
    });
    await mcpClient.callTool({
      name: "leadbay_report_artifact_error",
      arguments: { kind: "options_empty", surface: "field" },
    });
    expect(posthogState.capture).not.toHaveBeenCalled();
    expect(sentryState.captureException).not.toHaveBeenCalled();
  });
});

describe("_origin provenance separates artifact traffic from agent traffic", () => {
  it("defaults to agent when the field is absent", async () => {
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: ME_RESPONSE }]);
    const { mcpClient, identityDone } = await connect([sumTool]);
    await identityDone;
    await mcpClient.callTool({ name: "leadbay_test_sum", arguments: { a: 1, b: 2 } });
    expect(toolCallEvents()[0].origin).toBe("agent");
  });

  it("records artifact when the runtime stamps it", async () => {
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: ME_RESPONSE }]);
    const { mcpClient, identityDone } = await connect([sumTool]);
    await identityDone;
    await mcpClient.callTool({
      name: "leadbay_test_sum",
      arguments: { a: 1, b: 2, _origin: "artifact" },
    });
    expect(toolCallEvents()[0].origin).toBe("artifact");
  });

  it("an unknown _origin value falls back to agent rather than passing through", async () => {
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: ME_RESPONSE }]);
    const { mcpClient, identityDone } = await connect([sumTool]);
    await identityDone;
    await mcpClient.callTool({
      name: "leadbay_test_sum",
      arguments: { a: 1, b: 2, _origin: "spoofed" },
    });
    expect(toolCallEvents()[0].origin).toBe("agent");
  });

  it("_origin is STRIPPED before execute() — it never becomes tool input", async () => {
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: ME_RESPONSE }]);
    const seen: any[] = [];
    const spy: Tool = {
      ...sumTool,
      name: "leadbay_test_spy",
      execute: async (_c, p: any) => {
        seen.push(p);
        return { sum: p.a + p.b };
      },
    };
    const { mcpClient, identityDone } = await connect([spy]);
    await identityDone;
    await mcpClient.callTool({
      name: "leadbay_test_spy",
      arguments: { a: 1, b: 2, _origin: "artifact", _triggered_by: "add it up" },
    });
    expect(seen[0]).toEqual({ a: 1, b: 2 });
  });

  it("_origin does not clobber _triggered_by — both survive together", async () => {
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: ME_RESPONSE }]);
    const { mcpClient, identityDone } = await connect([sumTool]);
    await identityDone;
    await mcpClient.callTool({
      name: "leadbay_test_sum",
      arguments: { a: 1, b: 2, _origin: "artifact", _triggered_by: "add one and two" },
    });
    const props = toolCallEvents()[0];
    expect(props.origin).toBe("artifact");
    expect(props.triggered_by).toBe("add one and two");
  });

  it("the tool schema advertises _origin so a host can pass it", async () => {
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: ME_RESPONSE }]);
    const { mcpClient, identityDone } = await connect([sumTool]);
    await identityDone;
    const { tools } = await mcpClient.listTools();
    const t = tools.find((x: any) => x.name === "leadbay_test_sum")!;
    const origin = (t.inputSchema as any).properties._origin;
    expect(origin).toBeDefined();
    expect(origin.enum).toEqual(["agent", "artifact"]);
    // Never required — an omitted _origin IS the agent case.
    expect((t.inputSchema as any).required ?? []).not.toContain("_origin");
  });
});
