/**
 * Progress notification test — verifies notifications/progress flow
 * from a composite via ToolContext.progress to the connected client.
 *
 * Per MCP 2025-11-25 §Progress, when the client passes a progressToken
 * in the request's _meta, the server may stream notifications/progress
 * keyed on that token while the call runs. This wiring lets long-
 * running composites (bulk_qualify_leads, enrich_titles,
 * import_and_qualify) surface real-time updates instead of looking
 * frozen in the client UI.
 */

import { describe, it, expect, vi } from "vitest";
import { httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import type { Tool } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ProgressNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

const BASE = "https://api-us.leadbay.app";

describe("notifications/progress (P2 progress streaming)", () => {
  it("a composite that calls ctx.progress emits progress events to the client", async () => {
    // Test-only tool that emits 3 progress notifications then resolves.
    const tool: Tool = {
      name: "leadbay_test_progress_tool",
      description: "Test-only tool that emits 3 progress events.",
      annotations: {
        title: "Test progress tool",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: async (_client, _params, ctx) => {
        ctx?.progress?.({ progress: 0, total: 3, message: "Starting" });
        ctx?.progress?.({ progress: 1, total: 3, message: "Step 1 done" });
        ctx?.progress?.({ progress: 2, total: 3, message: "Step 2 done" });
        ctx?.progress?.({ progress: 3, total: 3, message: "All done" });
        return { ok: true, count: 3 };
      },
    };

    const lbClient = new LeadbayClient(BASE, "u.test-token");
    const server = buildServer(lbClient, { extraTools: [tool] });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
    await Promise.all([
      server.connect(serverTransport),
      mcpClient.connect(clientTransport),
    ]);

    // Hook the client-side progress notification handler.
    const received: any[] = [];
    mcpClient.setNotificationHandler(ProgressNotificationSchema, async (notification) => {
      received.push(notification.params);
    });

    // Call the tool with a progressToken in _meta. Per spec, this is what
    // signals to the server that the client wants streamed updates.
    await mcpClient.callTool(
      {
        name: "leadbay_test_progress_tool",
        arguments: {},
        _meta: { progressToken: "test-token-xyz" },
      },
      undefined,
      { resetTimeoutOnProgress: true }
    );

    // Allow any pending notification microtasks to flush.
    await new Promise((r) => setTimeout(r, 50));

    expect(received.length).toBe(4);
    expect(received[0].progressToken).toBe("test-token-xyz");
    expect(received[0].progress).toBe(0);
    expect(received[0].total).toBe(3);
    expect(received[0].message).toBe("Starting");
    expect(received[3].progress).toBe(3);
    expect(received[3].message).toBe("All done");
  });

  it("a composite emits NO progress when the client did not request it", async () => {
    const tool: Tool = {
      name: "leadbay_test_silent_progress_tool",
      description: "Test-only tool. Calls ctx.progress unconditionally.",
      annotations: {
        title: "Test silent tool",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: async (_client, _params, ctx) => {
        ctx?.progress?.({ progress: 1, total: 1, message: "should-not-fire" });
        return { ok: true };
      },
    };

    const lbClient = new LeadbayClient(BASE, "u.test-token");
    const server = buildServer(lbClient, { extraTools: [tool] });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
    await Promise.all([
      server.connect(serverTransport),
      mcpClient.connect(clientTransport),
    ]);

    const received: any[] = [];
    mcpClient.setNotificationHandler(ProgressNotificationSchema, async (notification) => {
      received.push(notification.params);
    });

    // Call WITHOUT a progressToken — server's ctx.progress should be undefined.
    await mcpClient.callTool({
      name: "leadbay_test_silent_progress_tool",
      arguments: {},
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(received.length).toBe(0);
  });
});
