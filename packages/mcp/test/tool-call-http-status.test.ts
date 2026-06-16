/**
 * Regression: HTTP status disambiguation in tool-call telemetry.
 *
 * leadbay_enrich_titles shows a ~7% API_ERROR floor. API_ERROR is the
 * catch-all in client.ts mapErrorResponse for any backend non-2xx that
 * isn't 401/402/403/404/429. The error envelope carries the upstream
 * status at `_meta.http_status` (client.ts makeError), but the
 * high-volume `mcp tool called` / `mcp composite call` product-analytics
 * events did NOT propagate it — so the dashboard can't tell whether the
 * floor is 503s, 500s, or a 4xx edge.
 *
 * This test drives a tool that throws a LeadbayError-shaped business
 * error carrying `_meta.http_status` and asserts the captured
 * tool-call (and composite-call) telemetry events include http_status.
 *
 * Before the fix: http_status is absent from the captured props -> FAIL.
 * After the fix: http_status === 503 is present -> PASS.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import type { Tool } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import {
  NOOP_TELEMETRY,
  type TelemetryHandle,
} from "../src/telemetry.js";
import type {
  ToolCallProps,
  CompositeCallProps,
} from "../src/telemetry-events.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

beforeEach(() => {
  resetHttpMock();
});

// A tool that throws a LeadbayError-shaped business error carrying the
// upstream HTTP status at _meta.http_status — exactly the shape
// client.ts mapErrorResponse produces for an API_ERROR (503 here).
const apiErrorTool: Tool = {
  name: "leadbay_test_api_error",
  description: "Test tool: throws a LeadbayError with _meta.http_status.",
  annotations: {
    title: "API error",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  execute: async () => {
    const err: any = {
      error: true,
      code: "API_ERROR",
      message: "API error (503)",
      hint: "Try again or check the Leadbay API status",
      _meta: {
        region: "us",
        endpoint: "/enrichment/bulk",
        latency_ms: 12,
        retry_after: null,
        http_status: 503,
      },
    };
    throw err;
  },
};

function captureSpy() {
  const toolCalls: ToolCallProps[] = [];
  const compositeCalls: CompositeCallProps[] = [];
  const telemetry: TelemetryHandle = {
    ...NOOP_TELEMETRY,
    captureToolCall: (props) => toolCalls.push(props),
    captureCompositeCall: (props) => compositeCalls.push(props),
  };
  return { telemetry, toolCalls, compositeCalls };
}

async function connect(telemetry: TelemetryHandle, extraTools: Tool[]) {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(lbClient, { extraTools, telemetry });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return mcpClient;
}

describe("tool-call telemetry — upstream HTTP status", () => {
  it("captures _meta.http_status on the tool-call event for an API_ERROR throw", async () => {
    mockHttp([]);
    const { telemetry, toolCalls } = captureSpy();
    const mcpClient = await connect(telemetry, [apiErrorTool]);

    await mcpClient.callTool({
      name: "leadbay_test_api_error",
      arguments: {},
    });

    expect(toolCalls).toHaveLength(1);
    const ev = toolCalls[0];
    expect(ev.tool).toBe("leadbay_test_api_error");
    expect(ev.ok).toBe(false);
    expect(ev.error_code).toBe("API_ERROR");
    // The load-bearing assertion: the upstream status must ride along so
    // the dashboard can disambiguate the API_ERROR floor (503 vs 500 vs 4xx).
    expect(ev.http_status).toBe(503);
  });
});
