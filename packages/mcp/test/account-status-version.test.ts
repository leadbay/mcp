/**
 * leadbay_account_status carries the server version as `mcp_version`.
 *
 * Asking Claude "what version of Leadbay are you running" had no answer: hosts
 * keep `serverInfo` out of the model's context, and the only other place the
 * version appeared was `update_available.current_version`, which exists only
 * while an update is pending and never on the hosted server (no update store).
 *
 * New file (never modify existing test files — repo invariant).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";
import { vi } from "vitest";

vi.mock("node:https", () => httpsMockFactory());

import type { Tool } from "@leadbay/core";
import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";
const VERSION = "9.9.9";

const pingTool: Tool = {
  name: "leadbay_ping_test",
  description: "test-only ping",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: {
    type: "object",
    properties: { pong: { type: "boolean" } },
    required: ["pong"],
  },
  annotations: { readOnlyHint: true },
  execute: async () => ({ pong: true }),
};

// The hosted shape: http-server.ts builds the server with a version and no
// updateStateStore.
async function connectHostedShape() {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(lbClient, {
    includeWrite: true,
    version: VERSION,
    extraTools: [pingTool],
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return { mcpClient };
}

function mockAccount() {
  mockHttp([
    {
      method: "GET",
      path: "/1.6/users/me",
      status: 200,
      body: {
        email: "test@example.com",
        name: "Test User",
        admin: true,
        manager: false,
        language: "en",
        organization: {
          id: "org-1",
          name: "Test Co",
          ai_agent_enabled: true,
          computing_intelligence: false,
        },
      },
    },
    {
      method: "GET",
      path: "/1.6/organizations/org-1/quota_status",
      status: 200,
      body: { plan: "PRO", windows: [] },
    },
  ]);
}

beforeEach(() => resetHttpMock());

describe("leadbay_account_status — mcp_version", () => {
  it("returns the server version with no update store (hosted)", async () => {
    mockAccount();
    const { mcpClient } = await connectHostedShape();

    const result = await mcpClient.callTool({
      name: "leadbay_account_status",
      arguments: { _triggered_by: "what version of Leadbay am I running" },
    });

    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as any).mcp_version).toBe(VERSION);
  });

  it("does not add the field to other tools", async () => {
    const { mcpClient } = await connectHostedShape();

    const result = await mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });

    expect((result.structuredContent as any).pong).toBe(true);
    expect((result.structuredContent as any).mcp_version).toBeUndefined();
  });
});
