/**
 * Annotations test — asserts MCP-spec ToolAnnotations land in the
 * tools/list payload for tools that declare them.
 *
 * Per MCP 2025-11-25 §Tools, annotations are HINTS — clients use them
 * to decide UX (auto-approve vs prompt). The Tool type in core carries
 * an optional `annotations` field; toolsListPayload surfaces it on the
 * wire when present.
 *
 * This test pins the canonical annotations for two representative
 * composites — pull_leads (read) and report_outreach (destructive,
 * non-idempotent). Subsequent iterations will add per-tool assertions
 * for the remaining tools as their annotations land.
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

describe("tools/list annotations (MCP spec ToolAnnotations)", () => {
  it("leadbay_pull_leads is annotated readOnly + idempotent + openWorld", async () => {
    const { mcpClient } = await connect();
    const listed = await mcpClient.listTools();
    const t = listed.tools.find((tool) => tool.name === "leadbay_pull_leads");
    expect(t).toBeDefined();
    expect(t!.annotations).toEqual({
      title: "Pull fresh Leadbay leads",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it("leadbay_report_outreach is annotated destructive + non-idempotent + openWorld", async () => {
    const { mcpClient } = await connect();
    const listed = await mcpClient.listTools();
    const t = listed.tools.find((tool) => tool.name === "leadbay_report_outreach");
    expect(t).toBeDefined();
    expect(t!.annotations).toEqual({
      title: "Report outreach to Leadbay",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it("a tool without declared annotations omits the field (backwards-compat)", async () => {
    const { mcpClient } = await connect();
    const listed = await mcpClient.listTools();
    // research_lead is not yet annotated in this iteration — should have
    // no annotations property. (Subsequent iterations annotate it.)
    const t = listed.tools.find((tool) => tool.name === "leadbay_research_lead");
    expect(t).toBeDefined();
    expect(t!.annotations).toBeUndefined();
  });
});
