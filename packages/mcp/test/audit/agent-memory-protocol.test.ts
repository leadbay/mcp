import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient, clearAgentMemoryCache } from "@leadbay/core";
import { buildServer } from "../../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";
let root: string;

async function connect() {
  const lbClient = new LeadbayClient(BASE, "u.test-token", "us");
  const server = buildServer(lbClient, { includeWrite: false });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return { server, mcpClient };
}

beforeEach(async () => {
  resetHttpMock();
  clearAgentMemoryCache();
  root = await mkdtemp(join(tmpdir(), "leadbay-memory-mcp-"));
  process.env.LEADBAY_AGENT_MEMORY_ROOT = root;
});

afterEach(async () => {
  delete process.env.LEADBAY_AGENT_MEMORY_ROOT;
  clearAgentMemoryCache();
  await rm(root, { recursive: true, force: true });
});

describe("audit: agent memory protocol", () => {
  it("registers memory tools and advertises the protocol in instructions", async () => {
    const { server, mcpClient } = await connect();
    const names = new Set((await mcpClient.listTools()).tools.map((t) => t.name));
    expect(names).toContain("leadbay_agent_memory_recall");
    expect(names).toContain("leadbay_agent_memory_capture");
    expect(names).toContain("leadbay_agent_memory_review");

    const instructions = (server as any)._instructions as string;
    expect(instructions).toMatch(/Memory protocol/);
    expect(instructions).toMatch(/leadbay_agent_memory_capture/);
  });

  it("attaches _meta.agent_memory to leads-touching tool responses", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: {
          id: "user-1",
          email: "a@example.com",
          organization: { id: "org-1", name: "Org", ai_agent_enabled: true },
          last_requested_lens: 42,
        },
      },
      {
        method: "GET",
        path: "/1.5/organizations/org-1/quota_status",
        status: 200,
        body: { plan: "free", org: { spend: [], resources: [] } },
      },
    ]);
    const { mcpClient } = await connect();
    const result = await mcpClient.callTool({
      name: "leadbay_account_status",
      arguments: {},
    });
    const parsed = JSON.parse((result.content as any[])[0].text);
    expect(parsed._meta.agent_memory).toMatchObject({
      version: 1,
      summary: expect.stringContaining("## Recent memory"),
    });
  });
});
