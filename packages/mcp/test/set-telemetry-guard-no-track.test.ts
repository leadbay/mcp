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

async function connect(telemetry: TelemetryHandle) {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  // set_telemetry is exposed even without write (privacy exception), so the
  // default server surfaces it.
  const server = buildServer(lbClient, { telemetry });
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
});
