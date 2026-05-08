/**
 * Observability hook test (iter26).
 *
 * Per-tool-call counter on stderr when LEADBAY_DEBUG=1. Default off; one
 * line per tools/call carrying name + duration + ok flag + bytes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import type { Tool } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

let stderrSpy: any;
let collectedStderr: string[];

function spyStderr() {
  collectedStderr = [];
  stderrSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: any) => {
      collectedStderr.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    });
}

beforeEach(() => {
  resetHttpMock();
});

afterEach(() => {
  if (stderrSpy) stderrSpy.mockRestore();
  delete process.env.LEADBAY_DEBUG;
});

const sumTool: Tool = {
  name: "leadbay_test_sum",
  description: "Test tool: returns {sum:n}.",
  annotations: {
    title: "Sum",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: { a: { type: "number" }, b: { type: "number" } },
    required: ["a", "b"],
    additionalProperties: false,
  },
  execute: async (_c, p: any) => ({ sum: p.a + p.b }),
};

async function connect() {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(lbClient, { extraTools: [sumTool] });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return { mcpClient };
}

describe("observability hook (iter26)", () => {
  it("LEADBAY_DEBUG unset → no debug stderr", async () => {
    spyStderr();
    const { mcpClient } = await connect();
    await mcpClient.callTool({
      name: "leadbay_test_sum",
      arguments: { a: 1, b: 2 },
    });
    const debugLines = collectedStderr.filter((l) => l.includes("[leadbay-mcp debug]"));
    expect(debugLines).toHaveLength(0);
  });

  it("LEADBAY_DEBUG=1 → one debug line per call with tool + dur + ok + bytes", async () => {
    process.env.LEADBAY_DEBUG = "1";
    spyStderr();
    const { mcpClient } = await connect();
    await mcpClient.callTool({
      name: "leadbay_test_sum",
      arguments: { a: 1, b: 2 },
    });
    const debugLines = collectedStderr.filter((l) =>
      l.includes("[leadbay-mcp debug]")
    );
    expect(debugLines).toHaveLength(1);
    const line = debugLines[0];
    expect(line).toMatch(/tool=leadbay_test_sum/);
    expect(line).toMatch(/dur=\d+ms/);
    expect(line).toMatch(/ok=true/);
    expect(line).toMatch(/bytes=\d+/);
  });

  it("LEADBAY_DEBUG=true (string-truthy) also enables", async () => {
    process.env.LEADBAY_DEBUG = "true";
    spyStderr();
    const { mcpClient } = await connect();
    await mcpClient.callTool({
      name: "leadbay_test_sum",
      arguments: { a: 1, b: 2 },
    });
    const debugLines = collectedStderr.filter((l) =>
      l.includes("[leadbay-mcp debug]")
    );
    expect(debugLines).toHaveLength(1);
  });

  it("LEADBAY_DEBUG=0 → no debug stderr", async () => {
    process.env.LEADBAY_DEBUG = "0";
    spyStderr();
    const { mcpClient } = await connect();
    await mcpClient.callTool({
      name: "leadbay_test_sum",
      arguments: { a: 1, b: 2 },
    });
    const debugLines = collectedStderr.filter((l) =>
      l.includes("[leadbay-mcp debug]")
    );
    expect(debugLines).toHaveLength(0);
  });

  it("on tool throw → debug line shows ok=false + code", async () => {
    process.env.LEADBAY_DEBUG = "1";
    const throwTool: Tool = {
      name: "leadbay_test_throw",
      description: "Test tool: throws.",
      annotations: {
        title: "Throws",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => {
        const err: any = new Error("simulated");
        err.code = "TEST_FAILURE";
        throw err;
      },
    };
    spyStderr();
    const lbClient = new LeadbayClient(BASE, "u.test-token");
    const server = buildServer(lbClient, { extraTools: [throwTool] });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
    await Promise.all([
      server.connect(serverTransport),
      mcpClient.connect(clientTransport),
    ]);
    await mcpClient.callTool({
      name: "leadbay_test_throw",
      arguments: {},
    });
    const debugLines = collectedStderr.filter((l) =>
      l.includes("[leadbay-mcp debug]")
    );
    expect(debugLines).toHaveLength(1);
    expect(debugLines[0]).toMatch(/ok=false/);
    expect(debugLines[0]).toMatch(/code=TEST_FAILURE/);
  });
});
