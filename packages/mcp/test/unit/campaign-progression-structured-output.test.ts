/**
 * leadbay_campaign_progression — the envelope validates on the client (mcp#276).
 *
 * The SDK client validates `structuredContent` against the tool's outputSchema
 * with Ajv, but only after `listTools()` has cached the validator; the
 * conformance suite never lists tools, so its check is key-level. This file
 * lists tools first, so the SDK's own validator runs, and then calls the tool
 * with a well-formed campaign, with page information that is text and null
 * where numbers belong plus a lead without an id, and with a page number the
 * host sent as text. Each call must come back without an error and with the
 * coverage the composite promises.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";
const TOOL = "leadbay_campaign_progression";
const PATH = (id: string, page: number, count = 50) =>
  `/1.6/campaigns/${id}/leads?count=${count}&page=${page}`;

async function connectAndListTools() {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(lbClient, { includeWrite: true, includeAdvanced: false });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
  // This is what arms the SDK's Ajv validation of structuredContent. Every
  // composite call must also carry `_triggered_by`, which the server strips
  // before the tool runs.
  const { tools } = await mcpClient.listTools();
  expect(tools.find((t) => t.name === TOOL)?.outputSchema).toBeDefined();
  return mcpClient;
}

function row(id: string | undefined) {
  return {
    lead: id === undefined ? { name: "No id" } : { id, name: `Lead ${id}` },
    progress: { total_contacts: 1, in_progress: 1, declined: 0, headline: "CONTACTED" },
    affiliation: { own_campaigns: [], other_users_campaign_count: 0 },
  };
}

beforeEach(() => resetHttpMock());

describe("campaign_progression — structuredContent passes the SDK's output-schema validation", () => {
  it("a well-formed two-page campaign", async () => {
    mockHttp([
      { method: "GET", path: PATH("camp-1", 0), status: 200, body: { items: [row("a")], pagination: { page: 0, pages: 2, total: 2 } } },
      { method: "GET", path: PATH("camp-1", 1), status: 200, body: { items: [row("b")], pagination: { page: 1, pages: 2, total: 2 } } },
    ]);
    const mcpClient = await connectAndListTools();
    const result: any = await mcpClient.callTool({ name: TOOL, arguments: { campaign_id: "camp-1", _triggered_by: "test" } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.summary).toEqual({ page_size: 1, contacted: 2, in_progress: 2, declined: 0 });
    expect(result.structuredContent.summary_coverage).toEqual({ leads: 2, total_leads: 2, complete: true });
  });

  it("page information that is text and null, and a lead without an id", async () => {
    mockHttp([
      {
        method: "GET",
        path: PATH("camp-2", 0),
        status: 200,
        body: { items: [row(undefined)], pagination: { page: "0", pages: null, total: "three" } },
      },
    ]);
    const mcpClient = await connectAndListTools();
    const result: any = await mcpClient.callTool({ name: TOOL, arguments: { campaign_id: "camp-2", _triggered_by: "test" } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.pagination).toEqual({ page: null, pages: null, total: null });
    expect(result.structuredContent.summary_coverage).toEqual({ leads: 1, total_leads: null, complete: false });
  });

  it("a page number the host sent as text", async () => {
    mockHttp([
      { method: "GET", path: PATH("camp-3", 1), status: 200, body: { items: [row("b")], pagination: { page: 1, pages: 2, total: 2 } } },
      { method: "GET", path: PATH("camp-3", 0), status: 200, body: { items: [row("a")], pagination: { page: 0, pages: 2, total: 2 } } },
    ]);
    const mcpClient = await connectAndListTools();
    const result: any = await mcpClient.callTool({ name: TOOL, arguments: { campaign_id: "camp-3", page: "1", _triggered_by: "test" } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.pagination).toEqual({ page: 1, pages: 2, total: 2 });
    expect(result.structuredContent.summary_coverage).toEqual({ leads: 2, total_leads: 2, complete: true });
  });
});
