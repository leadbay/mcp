import { describe, expect, it, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

// Minimal no-op shape so the injected handle satisfies TelemetryHandle without
// pulling the real implementation (which would need PostHog/Sentry mocks).
const NOOP_TELEMETRY_SHAPE: Record<string, any> = new Proxy(
  {},
  {
    get: (_t, prop) => {
      if (prop === "then") return undefined;
      return () => undefined;
    },
  }
);

/**
 * Privacy control for leadbay_report_friction (product#3943, Codex P1).
 *
 * The tool is in COMPOSITE_FILE_TOOL_NAMES, so `_triggered_by` is mandatory on
 * every call — and the dispatcher normally forwards it to PostHog as
 * `triggered_by` (mcp tool called) and `last_prompt` (mcp composite call).
 *
 * That is a SECOND verbatim slice of the user's message, separate from the
 * `message` they explicitly approved. Shipping it would re-introduce exactly the
 * unapproved conversation capture the Anthropic MCP-directory review rejected,
 * and would contradict this tool's own "only approved fields" contract.
 *
 * This audit locks the redaction: the mandate still applies (the call is
 * rejected without `_triggered_by`), but the value never reaches telemetry.
 */
describe("audit: report_friction never leaks _triggered_by to telemetry", () => {
  it("emits no triggered_by / last_prompt for a friction report", async () => {
    resetHttpMock();
    mockHttp([]);

    const toolCalls: any[] = [];
    const compositeCalls: any[] = [];
    const frictionReports: any[] = [];

    const telemetry: any = {
      ...NOOP_TELEMETRY_SHAPE,
      captureToolCall: (p: any) => toolCalls.push(p),
      captureCompositeCall: (p: any) => compositeCalls.push(p),
      captureFrictionReported: (p: any) => frictionReports.push(p),
    };

    const lbClient = new LeadbayClient(BASE, "u.test-token", "us");
    const server = buildServer(lbClient, { includeWrite: false, telemetry });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
    await Promise.all([
      server.connect(serverTransport),
      mcpClient.connect(clientTransport),
    ]);

    const SECRET_PROMPT =
      "our Q3 revenue target is 4.2M and Wisconsin search returns nothing";

    await mcpClient.callTool({
      name: "leadbay_report_friction",
      arguments: {
        _triggered_by: SECRET_PROMPT,
        category: "silent_failure",
        message: "Searching Wisconsin returns nothing.",
      },
    });

    // The friction event itself carries only the approved message.
    expect(frictionReports).toHaveLength(1);
    expect(frictionReports[0].message).toBe("Searching Wisconsin returns nothing.");
    expect(JSON.stringify(frictionReports[0])).not.toContain("4.2M");

    // Neither generic event may carry the unapproved prompt slice.
    const friction = toolCalls.filter((c) => c.tool === "leadbay_report_friction");
    expect(friction.length).toBeGreaterThan(0);
    for (const call of friction) {
      expect(call.triggered_by).toBeUndefined();
    }
    for (const call of compositeCalls.filter(
      (c) => c.tool === "leadbay_report_friction"
    )) {
      expect(call.last_prompt).toBe("");
    }

    // Belt and braces: the secret must not appear anywhere in what we emitted.
    const allEmitted = JSON.stringify({ toolCalls, compositeCalls, frictionReports });
    expect(allEmitted).not.toContain("4.2M");
    expect(allEmitted).not.toContain(SECRET_PROMPT);
  });

  it("still enforces the _triggered_by mandate (redaction is not an exemption)", async () => {
    resetHttpMock();
    mockHttp([]);

    const lbClient = new LeadbayClient(BASE, "u.test-token", "us");
    const server = buildServer(lbClient, { includeWrite: false });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
    await Promise.all([
      server.connect(serverTransport),
      mcpClient.connect(clientTransport),
    ]);

    // No _triggered_by → the composite mandate must still reject the call.
    const res: any = await mcpClient.callTool({
      name: "leadbay_report_friction",
      arguments: {
        category: "silent_failure",
        message: "Searching Wisconsin returns nothing.",
      },
    });

    // The guard renders the human-facing message via formatErrorForLLM rather
    // than the raw code, so assert on the mandate wording (and that the call
    // was rejected) instead of the enum name.
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res)).toMatch(/must carry .?_triggered_by/);
  });
});
