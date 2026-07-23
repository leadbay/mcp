import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";
import { NOOP_TELEMETRY, type TelemetryHandle } from "../src/telemetry.js";

const BASE = "https://api-us.leadbay.app";

function spyTelemetry(): TelemetryHandle & {
  captureToolCall: ReturnType<typeof vi.fn>;
  captureCompositeCall: ReturnType<typeof vi.fn>;
  captureException: ReturnType<typeof vi.fn>;
  captureQuotaHit: ReturnType<typeof vi.fn>;
} {
  return {
    ...NOOP_TELEMETRY,
    captureToolCall: vi.fn(),
    captureCompositeCall: vi.fn(),
    captureException: vi.fn(),
    captureQuotaHit: vi.fn(),
  } as any;
}

async function connect(telemetry: TelemetryHandle) {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(lbClient, { telemetry });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
  return { mcpClient };
}

beforeEach(() => resetHttpMock());

describe("leadbay_set_telemetry thrown opt-out failures sanitize Sentry context", () => {
  it("keeps the exception but strips the opt-out prompt from business-error context", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/users/me",
        status: 200,
        body: {
          id: "u",
          email: "e@t.test",
          organization: { id: "o", name: "O" },
          telemetry_enabled: true,
        },
      },
      {
        method: "POST",
        path: "/1.6/users/telemetry",
        status: 500,
        body: { error: true, code: "SERVER_ERROR", message: "down" },
      },
    ]);
    const telemetry = spyTelemetry();
    const { mcpClient } = await connect(telemetry);

    const res: any = await mcpClient.callTool({
      name: "leadbay_set_telemetry",
      arguments: { action: "disable", _triggered_by: "turn off telemetry now" },
    });

    expect(res.isError).toBe(true);
    expect(telemetry.captureToolCall).not.toHaveBeenCalled();
    expect(telemetry.captureCompositeCall).not.toHaveBeenCalled();
    expect(telemetry.captureException).toHaveBeenCalledTimes(1);
    expect(telemetry.captureException.mock.calls[0][1]).toMatchObject({
      tool: "leadbay_set_telemetry",
      source: "business",
      code: "API_ERROR",
    });
    expect(telemetry.captureException.mock.calls[0][1]).not.toHaveProperty("triggered_by");
  });

  it("does not emit quota telemetry for a throttled opt-out attempt", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/users/me",
        status: 429,
        headers: { "retry-after": "45" },
        body: {
          code: "QUOTA_EXCEEDED",
          message: "rate limited",
        },
      },
    ]);
    const telemetry = spyTelemetry();
    const { mcpClient } = await connect(telemetry);

    const res: any = await mcpClient.callTool({
      name: "leadbay_set_telemetry",
      arguments: { action: "disable", _triggered_by: "please disable usage tracking" },
    });

    expect(res.isError).toBe(true);
    expect(telemetry.captureQuotaHit).not.toHaveBeenCalled();
    expect(telemetry.captureToolCall).not.toHaveBeenCalled();
    expect(telemetry.captureCompositeCall).not.toHaveBeenCalled();
    expect(telemetry.captureException).toHaveBeenCalledTimes(1);
    expect(telemetry.captureException.mock.calls[0][1]).toMatchObject({
      tool: "leadbay_set_telemetry",
      source: "business",
      code: "QUOTA_EXCEEDED",
    });
    expect(telemetry.captureException.mock.calls[0][1]).not.toHaveProperty("triggered_by");
  });
});
