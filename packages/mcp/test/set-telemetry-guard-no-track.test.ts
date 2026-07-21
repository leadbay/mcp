/**
 * Codex P2 (product#3879): a leadbay_set_telemetry call rejected by the
 * `_triggered_by` mandate must NOT emit telemetry about the failed attempt.
 *
 * leadbay_set_telemetry is the privacy control. If a user asks to DISABLE
 * telemetry and the model sends the first attempt without `_triggered_by`, the
 * pre-dispatch guard rejects it with LAST_PROMPT_REQUIRED before execute() ever
 * stamps/posts the preference. Emitting the usual captureToolCall +
 * captureCompositeCall pair there would track exactly the user who is trying to
 * opt out. So for THIS one tool the guard rejects silently (no analytics);
 * every other composite still fires the pair so the mandate-violation rate
 * stays visible.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { NOOP_TELEMETRY, type TelemetryHandle } from "../src/telemetry.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

function spyTelemetry(): TelemetryHandle & {
  captureToolCall: ReturnType<typeof vi.fn>;
  captureCompositeCall: ReturnType<typeof vi.fn>;
  captureException: ReturnType<typeof vi.fn>;
} {
  return {
    ...NOOP_TELEMETRY,
    captureToolCall: vi.fn(),
    captureCompositeCall: vi.fn(),
    captureException: vi.fn(),
  } as any;
}

async function connect(telemetry: TelemetryHandle, bootstrapStatus?: () => { done: boolean; signInUrl?: string; failureMessage?: string; openFailed?: boolean }) {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  // set_telemetry is exposed even without write (privacy exception), so the
  // default server surfaces it.
  const server = buildServer(lbClient, { telemetry, bootstrapStatus });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
  return { mcpClient };
}

beforeEach(() => resetHttpMock());

describe("leadbay_set_telemetry — missing _triggered_by rejects WITHOUT tracking (Codex P2)", () => {
  it("guard rejects the opt-out attempt and emits NO analytics pair", async () => {
    mockHttp([]); // guard short-circuits before any HTTP
    const telemetry = spyTelemetry();
    const { mcpClient } = await connect(telemetry);

    const res: any = await mcpClient.callTool({
      name: "leadbay_set_telemetry",
      arguments: { action: "disable" }, // no _triggered_by
    });

    // Still surfaced to the agent so it re-calls with the field.
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("_triggered_by");

    // The load-bearing guarantee: the failed opt-out attempt is NOT tracked.
    expect(telemetry.captureToolCall).not.toHaveBeenCalled();
    expect(telemetry.captureCompositeCall).not.toHaveBeenCalled();
    expect(telemetry.captureException).not.toHaveBeenCalled();
  });

  it("a DIFFERENT composite still fires the mandate-miss analytics pair (visibility preserved)", async () => {
    mockHttp([]);
    const telemetry = spyTelemetry();
    const { mcpClient } = await connect(telemetry);

    const res: any = await mcpClient.callTool({
      name: "leadbay_account_status",
      arguments: {}, // no _triggered_by
    });

    expect(res.isError).toBe(true);
    // Non-privacy composite: the miss is still visible in analytics.
    expect(telemetry.captureToolCall).toHaveBeenCalledTimes(1);
    expect(telemetry.captureCompositeCall).toHaveBeenCalledTimes(1);
    expect(telemetry.captureException).not.toHaveBeenCalled();
  });

  it("BAD_ACTION opt-out attempt (malformed action, _triggered_by present) is NOT tracked (Codex P2)", async () => {
    // A near-miss like action:"off" dispatches (triggered_by present) but
    // execute() returns BAD_ACTION before posting/stamping — a malformed opt-out
    // whose triggered_by holds the user's opt-out prompt. The post-execute
    // error-envelope path must skip analytics + Sentry for this privacy control.
    mockHttp([]); // BAD_ACTION returns before any HTTP
    const telemetry = spyTelemetry();
    const { mcpClient } = await connect(telemetry);

    const res: any = await mcpClient.callTool({
      name: "leadbay_set_telemetry",
      arguments: { action: "off", _triggered_by: "turn off telemetry please" },
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Unknown action "off"'); // BAD_ACTION envelope
    expect(telemetry.captureToolCall).not.toHaveBeenCalled();
    expect(telemetry.captureCompositeCall).not.toHaveBeenCalled();
    expect(telemetry.captureException).not.toHaveBeenCalled();
  });

  it("a THROWN disable failure skips the analytics pair but KEEPS captureException (Codex P2)", async () => {
    // disable reads /me (enabled) then POSTs /users/telemetry, which 500s → the
    // tool throws into the shared catch. The PostHog pair carries the opt-out
    // prompt and must be skipped; the Sentry exception is kept so a broken
    // opt-out endpoint stays visible.
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: { id: "u", email: "e@t.test", organization: { id: "o", name: "O" }, telemetry_enabled: true } },
      { method: "POST", path: "/1.6/users/telemetry", status: 500, body: { error: true, code: "SERVER_ERROR", message: "down" } },
    ]);
    const telemetry = spyTelemetry();
    const { mcpClient } = await connect(telemetry);

    const res: any = await mcpClient.callTool({
      name: "leadbay_set_telemetry",
      arguments: { action: "disable", _triggered_by: "disable my telemetry" },
    });

    expect(res.isError).toBe(true);
    // Analytics pair (carries the opt-out prompt) suppressed…
    expect(telemetry.captureToolCall).not.toHaveBeenCalled();
    expect(telemetry.captureCompositeCall).not.toHaveBeenCalled();
    // …but a broken opt-out endpoint is still surfaced to Sentry.
    expect(telemetry.captureException).toHaveBeenCalledTimes(1);
  });

  it("OAuth-bootstrap gate (fresh local/DXT install) does NOT track an opt-out attempt (Codex P2)", async () => {
    // bootstrapStatus not done → the gate returns AUTH_PENDING before the tool
    // can post/stamp. For a user asking to turn telemetry OFF on a fresh install,
    // that pre-run capture would record the opt-out prompt — skip it.
    mockHttp([]);
    const telemetry = spyTelemetry();
    const { mcpClient } = await connect(telemetry, () => ({ done: false }));

    const res: any = await mcpClient.callTool({
      name: "leadbay_set_telemetry",
      arguments: { action: "disable", _triggered_by: "turn off telemetry" },
    });

    expect(res.isError).toBe(true); // AUTH_PENDING surfaced to the agent
    expect(telemetry.captureToolCall).not.toHaveBeenCalled();
    expect(telemetry.captureCompositeCall).not.toHaveBeenCalled();
    expect(telemetry.captureException).not.toHaveBeenCalled();
  });
});
