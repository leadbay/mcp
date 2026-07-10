/**
 * RC1 regression net (leadbay/product#3876).
 *
 * The hosted HTTP MCP server (mcp.leadbay.app — ChatGPT / Claude custom
 * connectors, /mcp, /fr/mcp) previously built its per-request server via
 * buildServerFromClient() WITHOUT a telemetry handle, so buildServer defaulted
 * to NOOP_TELEMETRY and every tool call over HTTP produced ZERO PostHog events.
 * A user who installed via mcp.leadbay.app/fr/mcp and made calls logged nothing.
 *
 * The fix wires a process-level telemetry handle plus a per-request identity:
 * resolveIdentity() reads the request's own /users/me, and bindTelemetryIdentity()
 * injects that identity into the shared handle so the (unchanged) server.ts
 * capture sites attribute each event correctly — without latching one user's
 * identity onto the whole multi-tenant process.
 *
 * These tests exercise those two seams directly, plus prove the injected
 * identity actually reaches the capture sites by driving a real tool call
 * through buildServer with a bound handle (InMemoryTransport — the same pattern
 * as tool-call-http-status.test.ts). The full Hono→StreamableHTTP transport
 * needs real Node req/res objects that app.fetch(new Request()) can't provide,
 * so we test the wiring at the seam the fix actually added, not the SDK plumbing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import type { Tool } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { NOOP_TELEMETRY, type TelemetryHandle } from "../src/telemetry.js";
import type { ToolCallProps } from "../src/telemetry-events.js";
import { resolveIdentity, bindTelemetryIdentity } from "../src/http-server.js";
import { resolveClientFromToken } from "../src/auth-http.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

beforeEach(() => resetHttpMock());

// A trivial read tool so the CallTool handler runs its success path and fires
// captureToolCall. Not in COMPOSITE_FILE_TOOL_NAMES, so _triggered_by is
// optional and no composite event fires — we only assert the tool-call event.
const echoTool: Tool = {
  name: "leadbay_test_echo",
  description: "Test tool: returns a fixed object.",
  annotations: { readOnlyHint: true },
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  execute: async () => ({ ok: true }),
};

// Records every captured tool-call event AND the raw posthog-shaped payload the
// handle would emit, by spying at the TelemetryHandle boundary. captureToolCall
// receives (props, identity) — we snapshot both so we can assert the injected
// identity rode through.
function captureSpy() {
  const events: Array<{ props: ToolCallProps; identity: unknown }> = [];
  const telemetry: TelemetryHandle = {
    ...NOOP_TELEMETRY,
    captureToolCall: (props, identity) => events.push({ props, identity }),
  };
  return { telemetry, events };
}

async function connect(telemetry: TelemetryHandle) {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(lbClient, { extraTools: [echoTool], telemetry });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return mcpClient;
}

describe("hosted HTTP MCP — telemetry wiring (product#3876)", () => {
  it("a bound handle injects the request's identity into the tool-call event", async () => {
    mockHttp([]);
    const { telemetry, events } = captureSpy();
    const bound = bindTelemetryIdentity(telemetry, {
      distinctId: "alice@leadbay.test",
      groups: { organization: "org-a" },
      region: "us",
    });
    const mcpClient = await connect(bound);

    await mcpClient.callTool({ name: "leadbay_test_echo", arguments: {} });

    expect(events).toHaveLength(1);
    expect(events[0].props.tool).toBe("leadbay_test_echo");
    expect(events[0].props.ok).toBe(true);
    // The load-bearing assertion: the per-request identity reached the capture
    // site (which the unfixed HTTP path never provided — it used NOOP).
    expect(events[0].identity).toEqual({
      distinctId: "alice@leadbay.test",
      groups: { organization: "org-a" },
      region: "us",
    });
  });

  it("two bound handles attribute to two DIFFERENT distinctIds (no identity latch)", async () => {
    mockHttp([]);
    const { telemetry, events } = captureSpy();

    const alice = bindTelemetryIdentity(telemetry, { distinctId: "alice@leadbay.test", region: "us" });
    const bob = bindTelemetryIdentity(telemetry, { distinctId: "bob@leadbay.test", region: "fr" });

    const clientA = await connect(alice);
    await clientA.callTool({ name: "leadbay_test_echo", arguments: {} });
    const clientB = await connect(bob);
    await clientB.callTool({ name: "leadbay_test_echo", arguments: {} });

    const ids = events.map((e) => (e.identity as any).distinctId);
    expect(ids).toEqual(["alice@leadbay.test", "bob@leadbay.test"]);
  });

  it("the bound handle's shutdown() and identify() are inert (never kill the shared client)", async () => {
    const base: TelemetryHandle = {
      ...NOOP_TELEMETRY,
      shutdown: vi.fn(async () => {}),
      identify: vi.fn(async () => {}),
    };
    const bound = bindTelemetryIdentity(base, { distinctId: "x@y.test" });
    await bound.shutdown();
    await bound.identify({} as any);
    // A closing request / evicted SSE session must not tear down the process
    // handle: the wrapper's overrides must NOT delegate to the base.
    expect(base.shutdown).not.toHaveBeenCalled();
    expect(base.identify).not.toHaveBeenCalled();
  });

  it("the wrapper forwards identity to captureFeedback so hosted feedback attributes to the user", async () => {
    // leadbay_send_feedback on HTTP flows ctx.sendFeedback → captureFeedback.
    // Before the fix the wrapper spread the base handle, so captureFeedback used
    // the module-scoped `me` (never set on HTTP) and Sentry feedback landed
    // anonymous even though resolveIdentity() found the user (Codex P2).
    const identity = { distinctId: "alice@leadbay.test", region: "us", name: "Alice", email: "alice@leadbay.test" };
    let seenIdentity: unknown;
    let seenMessage: unknown;
    const base: TelemetryHandle = {
      ...NOOP_TELEMETRY,
      captureFeedback: async (message, _opts, id) => { seenMessage = message; seenIdentity = id; return true; },
    };
    const bound = bindTelemetryIdentity(base, identity);
    const sent = await bound.captureFeedback("bug: X is broken", { associatedEventId: "evt-1" });
    expect(sent).toBe(true);
    expect(seenMessage).toBe("bug: X is broken");
    expect(seenIdentity).toEqual(identity);
  });

  it("the wrapper injects identity into friction + agent-memory captures too (not just tool calls)", () => {
    // These fire per HTTP request when leadbay_report_friction / the agent-memory
    // tools run. Before the fix they fell through to the base handle with NO
    // identity — and since the HTTP base never identifies, they buffered until
    // shutdown and flushed anonymous. The wrapper must forward identity for them.
    const identity = { distinctId: "alice@leadbay.test", groups: { organization: "org-a" }, region: "us" };
    const seen: Record<string, unknown> = {};
    const base: TelemetryHandle = {
      ...NOOP_TELEMETRY,
      captureFrictionReported: (_p, id) => { seen.friction = id; },
      captureAgentMemoryCaptured: (_p, id) => { seen.memCaptured = id; },
      captureAgentMemoryRecalled: (_p, id) => { seen.memRecalled = id; },
      captureAgentMemoryPruned: (_p, id) => { seen.memPruned = id; },
    };
    const bound = bindTelemetryIdentity(base, identity);
    bound.captureFrictionReported({ category: "x", user_quote: "q" });
    bound.captureAgentMemoryCaptured({});
    bound.captureAgentMemoryRecalled({});
    bound.captureAgentMemoryPruned({ action: "prune" });
    expect(seen.friction).toEqual(identity);
    expect(seen.memCaptured).toEqual(identity);
    expect(seen.memRecalled).toEqual(identity);
    expect(seen.memPruned).toEqual(identity);
  });

  it("resolveIdentity maps /users/me to distinctId + groups + region", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/users/me",
        status: 200,
        body: { id: "u1", email: "alice@leadbay.test", name: "Alice", organization: { id: "org-a", name: "Acme" } },
      },
    ]);
    const client = new LeadbayClient(BASE, "u.tok", "us");
    const identity = await resolveIdentity(client);
    expect(identity).toEqual({
      distinctId: "alice@leadbay.test",
      groups: { organization: "org-a" },
      region: "us",
      // name/email ride along for Sentry feedback attribution on HTTP.
      name: "Alice",
      email: "alice@leadbay.test",
    });
  });

  it("resolveMe caches /users/me so repeat identity resolution adds no fetch (Codex P2 double-fetch)", async () => {
    // Codex P2: the auth probe used a bare request() that did NOT warm the
    // client's /users/me cache, so resolveIdentity() refetched — a second
    // round trip per stateless HTTP request. The fix switches the probe to
    // resolveMe(), which caches (60s TTL). This asserts the cache-reuse
    // mechanism: once resolveMe has run on a client, resolveIdentity() on it
    // adds ZERO /users/me requests. (Only one script is provided, so a second
    // fetch would throw "no script matched" — the strongest possible proof.)
    const me = { id: "u1", email: "alice@leadbay.test", name: "Alice", organization: { id: "org-a", name: "Acme" } };
    const h = mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: me }]);
    const client = new LeadbayClient(BASE, "u.tok", "us");
    await client.resolveMe(); // warms the cache, as the auth probe now does
    const afterProbe = h.requests.filter((r) => r.path === "/1.6/users/me").length;
    const identity = await resolveIdentity(client); // must be a cache hit
    expect(identity.distinctId).toBe("alice@leadbay.test");
    const afterIdentity = h.requests.filter((r) => r.path === "/1.6/users/me").length;
    expect(afterIdentity).toBe(afterProbe); // no additional fetch
  });

  it("resolveIdentity falls back to mcp:unknown when /users/me fails (event still lands)", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 500, body: { error: true, code: "SERVER_ERROR", message: "oops" } },
    ]);
    const client = new LeadbayClient(BASE, "u.tok", "fr");
    const identity = await resolveIdentity(client);
    // distinctId is a stable sentinel (never undefined → the event is still
    // emitted, just unattributed) and the region tag survives.
    expect(identity.distinctId).toBe("mcp:unknown");
    expect(identity.region).toBe("fr");
  });
});
