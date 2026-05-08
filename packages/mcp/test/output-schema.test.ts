/**
 * outputSchema + structuredContent test — verifies the wire shape for
 * tools that ship typed output (top-5 composites in iter 5).
 *
 * Per MCP 2025-11-25 §Tools, tools may declare `outputSchema` to
 * describe their return shape. When set, the server emits a matching
 * `structuredContent` block alongside the existing `text` content so
 * clients can consume the typed payload directly.
 *
 * Backwards-compat: text content is unchanged; structuredContent is
 * additive.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

async function connect() {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(lbClient, { includeWrite: true });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return { mcpClient };
}

beforeEach(() => {
  resetHttpMock();
});

describe("outputSchema on top 5 composites (P2: structured output)", () => {
  it("each top-5 composite declares outputSchema in tools/list", async () => {
    const { mcpClient } = await connect();
    const listed = await mcpClient.listTools();
    const TOP5 = [
      "leadbay_pull_leads",
      "leadbay_research_lead",
      "leadbay_account_status",
      "leadbay_bulk_qualify_leads",
      "leadbay_report_outreach",
    ];
    for (const name of TOP5) {
      const t = listed.tools.find((tool) => tool.name === name);
      expect(t, `${name} not found`).toBeDefined();
      expect(t!.outputSchema, `${name} missing outputSchema`).toBeDefined();
      expect((t!.outputSchema as any).type).toBe("object");
      expect((t!.outputSchema as any).properties).toBeDefined();
    }
  });

  it("granular tools (advanced surface) omit outputSchema by default (iter-18 added composites only)", async () => {
    // Advanced mode exposes granular reads — pick one that has not yet been
    // promoted to outputSchema coverage. This negative-control assertion
    // catches accidental side-effects when adding outputSchema to a granular
    // (which would land in iter-19+).
    const lbClient = new LeadbayClient(BASE, "u.test-token");
    const server = buildServer(lbClient, { includeWrite: true, includeAdvanced: true });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
    await Promise.all([
      server.connect(serverTransport),
      mcpClient.connect(clientTransport),
    ]);
    const listed = await mcpClient.listTools();
    // discover_leads is granular and not yet promoted to outputSchema (iter-19
    // covers ~32% of granulars; `discover_leads` is not in the iter-19 batch).
    const t = listed.tools.find((tool) => tool.name === "leadbay_discover_leads");
    expect(t).toBeDefined();
    expect(t!.outputSchema).toBeUndefined();
  });

  it("account_status returns structuredContent on a successful call", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
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
            quota_plan: "PRO",
          },
          last_requested_lens: 42,
        },
      },
      {
        method: "GET",
        path: "/1.5/organizations/org-1/quota_status",
        status: 200,
        body: {
          plan: "PRO",
          windows: [],
        },
      },
    ]);
    const { mcpClient } = await connect();
    const result = await mcpClient.callTool({
      name: "leadbay_account_status",
      arguments: {},
    });
    expect((result as any).isError).not.toBe(true);
    expect((result as any).content).toBeDefined();
    expect(Array.isArray((result as any).content)).toBe(true);
    expect((result as any).content[0].type).toBe("text");
    // structuredContent additive — should be present alongside text
    expect((result as any).structuredContent).toBeDefined();
    const structured = (result as any).structuredContent;
    expect(structured.user).toBeDefined();
    expect(structured.user.email).toBe("test@example.com");
    expect(structured.organization).toBeDefined();
    expect(structured.organization.id).toBe("org-1");
  });
});
