/**
 * Verifies the server wires leadbay_send_feedback's ToolContext.sendFeedback to
 * telemetry.captureFeedback. The core unit tests inject a fake ctx; this proves
 * the SERVER actually connects the seam (and passes message + associatedEventId
 * through), exercised over the real JSON-RPC handshake.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { NOOP_TELEMETRY } from "../src/telemetry.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

beforeEach(() => resetHttpMock());

async function connectWithTelemetry(telemetry: any) {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(lbClient, { includeWrite: true, telemetry });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([server.connect(st), mcpClient.connect(ct)]);
  return { mcpClient };
}

describe("leadbay_send_feedback — server wires sendFeedback to telemetry.captureFeedback", () => {
  it("forwards the message (and associatedEventId) to telemetry.captureFeedback and reports sent:true", async () => {
    mockHttp([]);
    const calls: Array<{ message: string; opts?: any }> = [];
    const telemetry = {
      ...NOOP_TELEMETRY,
      captureFeedback: (message: string, opts?: any) => {
        calls.push({ message, opts });
        return true;
      },
    };
    const { mcpClient } = await connectWithTelemetry(telemetry);
    const result: any = await mcpClient.callTool({
      name: "leadbay_send_feedback",
      arguments: {
        _triggered_by: "send feedback: scores feel off",
        message: "the lead scores feel off this week",
        associated_error_id: "evt_abc",
      },
    });

    // The server reached the telemetry handle exactly once with our payload.
    expect(calls).toHaveLength(1);
    expect(calls[0].message).toBe("the lead scores feel off this week");
    expect(calls[0].opts).toEqual({ associatedEventId: "evt_abc" });
    // And the tool reported success back over the wire.
    expect(result.isError ?? false).toBe(false);
    expect(result.structuredContent?.sent).toBe(true);
  });

  it("when telemetry returns false (Sentry not ready), the tool reports sent:false — no false success", async () => {
    mockHttp([]);
    const telemetry = { ...NOOP_TELEMETRY, captureFeedback: () => false };
    const { mcpClient } = await connectWithTelemetry(telemetry);
    const result: any = await mcpClient.callTool({
      name: "leadbay_send_feedback",
      arguments: { _triggered_by: "send feedback", message: "hello" },
    });
    expect(result.structuredContent?.sent).toBe(false);
  });
});
