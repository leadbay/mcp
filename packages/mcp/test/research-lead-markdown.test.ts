/**
 * research_lead response_format='markdown' opt-in (iter25).
 *
 * Per-tool opt-in for chat-rendering agents (Cursor, Claude Desktop) which
 * display the response directly to the user. The same structured shape is
 * rendered as compact markdown — same data, fewer tokens for chat hosts.
 *
 * structuredContent is preserved when format=markdown so capable clients
 * still get typed access.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

const HAPPY_PATH_MOCKS = () => {
  mockHttp([
    { method: "POST", path: "/1.5/interactions", status: 200, body: {} },
    {
      method: "GET",
      path: /\/1\.5\/lenses\/42\/leads\/lead-1$/,
      status: 200,
      body: {
        id: "lead-1",
        name: "Acme",
        sector_id: 7,
        score: 80,
        ai_agent_lead_score: 70,
        tags: [],
        size: null,
        location: null,
        website: "acme.com",
        description: null,
        short_description: "Best fit",
        social: {},
        liked: false,
        disliked: false,
        contacts_count: 0,
        org_contacts_count: 0,
        notes_count: 0,
        epilogue_actions_count: 0,
        prospecting_actions_count: 0,
        recommended_contact_title: null,
        recommended_contact: null,
      },
    },
    {
      method: "GET",
      path: "/1.5/leads/lead-1/ai_agent_responses",
      status: 200,
      body: [
        {
          question: "Why this lead?",
          question_created_at: "2026-04-20T00:00:00Z",
          lead_id: "lead-1",
          score: 8,
          response: "good fit — has adopted the platform",
          computed_at: "2026-04-20T00:00:00Z",
        },
      ],
    },
    {
      method: "GET",
      path: /\/1\.5\/leads\/lead-1\/enrich\/contacts/,
      status: 200,
      body: [],
    },
    {
      method: "GET",
      path: "/1.5/leads/lead-1/web_fetch",
      status: 200,
      body: { content: null, status: "complete", in_progress: false },
    },
  ]);
};

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

describe("research_lead response_format='markdown' (iter25)", () => {
  it("default (json) returns JSON.stringify text content", async () => {
    HAPPY_PATH_MOCKS();
    const { mcpClient } = await connect();
    const result = await mcpClient.callTool({
      name: "leadbay_research_lead_by_id",
      arguments: { leadId: "lead-1", lensId: 42, _triggered_by: "test trigger" },
    });
    expect((result as any).isError).not.toBe(true);
    const text = (result as any).content[0].text;
    // JSON parses
    expect(() => JSON.parse(text)).not.toThrow();
    const parsed = JSON.parse(text);
    expect(parsed.firmographics.name).toBe("Acme");
    // structuredContent still emitted (outputSchema declared)
    expect((result as any).structuredContent).toBeDefined();
  });

  it("response_format='markdown' returns rendered markdown text", async () => {
    HAPPY_PATH_MOCKS();
    const { mcpClient } = await connect();
    const result = await mcpClient.callTool({
      name: "leadbay_research_lead_by_id",
      arguments: { leadId: "lead-1", lensId: 42, response_format: "markdown", _triggered_by: "test trigger" },
    });
    expect((result as any).isError).not.toBe(true);
    const text = (result as any).content[0].text;
    // Markdown shape — has headers and bullets, NOT JSON.
    expect(text).toMatch(/^# Acme/m);
    expect(text).toMatch(/Score: 80/);
    expect(text).toMatch(/## Qualification/);
    expect(text).toMatch(/Why this lead/);
    expect(text).toMatch(/good fit/);
    // NOT JSON (no opening brace at line start).
    expect(text.startsWith("{")).toBe(false);
  });

  it("response_format='markdown' still emits structuredContent for capable clients", async () => {
    HAPPY_PATH_MOCKS();
    const { mcpClient } = await connect();
    const result = await mcpClient.callTool({
      name: "leadbay_research_lead_by_id",
      arguments: { leadId: "lead-1", lensId: 42, response_format: "markdown", _triggered_by: "test trigger" },
    });
    expect((result as any).structuredContent).toBeDefined();
    const sc = (result as any).structuredContent as any;
    expect(sc.firmographics.name).toBe("Acme");
    expect(sc.qualification).toHaveLength(1);
  });

  it("response_format='markdown' is shorter than default JSON (Q12 token economy)", async () => {
    HAPPY_PATH_MOCKS();
    const { mcpClient } = await connect();
    const r1 = await mcpClient.callTool({
      name: "leadbay_research_lead_by_id",
      arguments: { leadId: "lead-1", lensId: 42, _triggered_by: "test trigger" },
    });
    HAPPY_PATH_MOCKS();
    const r2 = await mcpClient.callTool({
      name: "leadbay_research_lead_by_id",
      arguments: { leadId: "lead-1", lensId: 42, response_format: "markdown", _triggered_by: "test trigger" },
    });
    const jsonLen = (r1 as any).content[0].text.length;
    const mdLen = (r2 as any).content[0].text.length;
    // Materially shorter (markdown ditches JSON structural overhead).
    expect(mdLen).toBeLessThan(jsonLen);
  });
});
