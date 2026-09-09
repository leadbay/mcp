import { describe, expect, it, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

// TelemetryHandle has many methods; spreading a Proxy yields {} (a Proxy has no
// own keys), so build one that answers every name and lets the caller override
// just the captures it asserts on.
function telemetryStub(overrides: Record<string, any> = {}): any {
  return new Proxy(overrides, {
    get: (target, prop) => {
      if (prop === "then") return undefined;
      if (prop in target) return (target as any)[prop];
      return () => undefined;
    },
  });
}

/**
 * Data-minimisation lock for `_triggered_by` (Anthropic Connectors Directory).
 *
 * The directory review criteria bar collecting "conversation data beyond what
 * the tool needs for its function". `_triggered_by` clears that bar only
 * because it IS the call's own input provenance — the one instruction the call
 * is executing — and not a transcript. The README privacy section now states
 * that as a guarantee: one instruction, capped at 500 chars, surrounding
 * conversation never sent.
 *
 * This audit is what makes the README sentence true rather than a habit.
 * The prose that instructs the agent lives in
 * packages/promptforge/snippets/server-instructions/triggered-by.md and in
 * TRIGGERED_BY_DESCRIPTION_* in src/server.ts; nothing there may invite a
 * summary, prior turns, or an unbounded quote.
 */
describe("audit: _triggered_by carries one instruction, bounded", () => {
  async function connect(telemetry: any) {
    resetHttpMock();
    // The tool's own API call is irrelevant here: the dispatcher emits the
    // composite-call event with `last_prompt` on the success AND the error
    // paths, and the truncation happens before dispatch either way.
    mockHttp([]);
    const lbClient = new LeadbayClient(BASE, "u.test-token", "us");
    const server = buildServer(lbClient, { includeWrite: false, telemetry });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
    await Promise.all([
      server.connect(serverTransport),
      mcpClient.connect(clientTransport),
    ]);
    return mcpClient;
  }

  it("truncates an over-long quote to 500 chars before telemetry sees it", async () => {
    const compositeCalls: any[] = [];
    const toolCalls: any[] = [];
    const mcpClient = await connect(
      telemetryStub({
        captureCompositeCall: (p: any) => compositeCalls.push(p),
        captureToolCall: (p: any) => toolCalls.push(p),
      })
    );

    // An agent pasting the whole conversation instead of the one instruction.
    const TAIL = "SECRET-TAIL-THAT-MUST-NOT-SHIP";
    const OVERLONG = "a".repeat(900) + TAIL;

    await mcpClient.callTool({
      name: "leadbay_account_status",
      arguments: { _triggered_by: OVERLONG },
    });

    expect(compositeCalls.length).toBeGreaterThan(0);
    const emitted: string = compositeCalls[0].last_prompt;
    // 500 kept chars + the single-character ellipsis the truncator appends.
    expect(emitted).toHaveLength(501);
    expect(emitted.endsWith("…")).toBe(true);
    expect(JSON.stringify([compositeCalls, toolCalls])).not.toContain(TAIL);
  });

  it("passes a normal instruction through verbatim and un-truncated", async () => {
    const compositeCalls: any[] = [];
    const mcpClient = await connect(
      telemetryStub({ captureCompositeCall: (p: any) => compositeCalls.push(p) })
    );

    const INSTRUCTION = "give me some leads to prospect today";
    await mcpClient.callTool({
      name: "leadbay_account_status",
      arguments: { _triggered_by: INSTRUCTION },
    });

    expect(compositeCalls[0].last_prompt).toBe(INSTRUCTION);
  });

  it("strips _triggered_by out of the args the tool actually executes on", async () => {
    // Provenance is telemetry metadata, not a tool input. If it reached
    // execute() it would end up in request bodies to the Leadbay API too.
    const mcpClient = await connect(telemetryStub());
    const res: any = await mcpClient.callTool({
      name: "leadbay_account_status",
      arguments: { _triggered_by: "check my quota please" },
    });
    expect(JSON.stringify(res)).not.toContain("_triggered_by");
  });

  it("the agent-facing prose asks for the triggering instruction, not the conversation", async () => {
    const mcpClient = await connect(telemetryStub());
    const { tools } = await mcpClient.listTools();

    const described = tools.filter(
      (t: any) => t.inputSchema?.properties?._triggered_by
    );
    expect(described.length).toBeGreaterThan(0);

    for (const tool of described) {
      const desc: string = (tool as any).inputSchema.properties._triggered_by.description;
      // Positive: it names what the field is.
      expect(desc, tool.name).toMatch(/instruction this call is executing/i);
      expect(desc, tool.name).toMatch(/never a summary of the conversation/i);
      // Negative: nothing may invite more than that one instruction.
      expect(desc, tool.name).not.toMatch(/or short paraphrase/i);
      expect(desc, tool.name).not.toMatch(/last \d+-\d+ sentences/i);
      expect(desc, tool.name).not.toMatch(/conversation history|transcript/i);
    }
  });
});
