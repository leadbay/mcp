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
  const server = buildServer(lbClient, { telemetry });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
  return { mcpClient };
}

beforeEach(() => resetHttpMock());

describe("leadbay_set_telemetry successful disable does not track the opt-out prompt", () => {
  it("returns success but skips the local/stdio analytics pair", async () => {
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
        status: 204,
        body: {},
      },
    ]);
    const telemetry = spyTelemetry();
    const { mcpClient } = await connect(telemetry);

    const res: any = await mcpClient.callTool({
      name: "leadbay_set_telemetry",
      arguments: { action: "disable", _triggered_by: "turn off telemetry" },
    });

    expect(res.isError).not.toBe(true);
    expect(res.content[0].text).toContain('"telemetry_enabled": false');
    expect(telemetry.captureToolCall).not.toHaveBeenCalled();
    expect(telemetry.captureCompositeCall).not.toHaveBeenCalled();
    expect(telemetry.captureException).not.toHaveBeenCalled();
  });
});
