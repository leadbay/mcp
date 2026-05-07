/**
 * Prompts test — verifies the prompts/* capability + 5 canned slash
 * commands.
 */

import { describe, it, expect, vi } from "vitest";
import { httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

async function connect() {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(lbClient);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return { mcpClient };
}

describe("prompts/* capability (P2 prompts)", () => {
  it("prompts/list returns all 5 canned prompts", async () => {
    const { mcpClient } = await connect();
    const listed = await mcpClient.listPrompts();
    const names = listed.prompts.map((p) => p.name);
    expect(names).toEqual([
      "leadbay_daily_check_in",
      "leadbay_research_a_domain",
      "leadbay_refine_audience",
      "leadbay_log_outreach",
      "leadbay_qualify_top_n",
    ]);
    // Each prompt has a description.
    for (const p of listed.prompts) {
      expect(p.description).toBeTypeOf("string");
      expect(p.description!.length).toBeGreaterThan(20);
    }
  });

  it("prompts/get(daily_check_in) returns a non-empty user message", async () => {
    const { mcpClient } = await connect();
    const result = await mcpClient.getPrompt({ name: "leadbay_daily_check_in" });
    expect(result.messages.length).toBeGreaterThanOrEqual(1);
    expect(result.messages[0].role).toBe("user");
    const content = result.messages[0].content as any;
    expect(content.type).toBe("text");
    expect(content.text).toContain("leadbay_account_status");
    expect(content.text).toContain("leadbay_pull_leads");
  });

  it("prompts/get(research_a_domain) interpolates the domain argument", async () => {
    const { mcpClient } = await connect();
    const result = await mcpClient.getPrompt({
      name: "leadbay_research_a_domain",
      arguments: { domain: "acme.com" },
    });
    const text = (result.messages[0].content as any).text;
    expect(text).toContain("acme.com");
    expect(text).toContain("leadbay_import_and_qualify");
  });

  it("prompts/get with missing required argument errors", async () => {
    const { mcpClient } = await connect();
    let threw = false;
    try {
      await mcpClient.getPrompt({
        name: "leadbay_research_a_domain",
        arguments: {},
      });
    } catch (err: any) {
      threw = true;
      expect(String(err)).toContain("domain");
    }
    expect(threw).toBe(true);
  });

  it("prompts/get(unknown) errors", async () => {
    const { mcpClient } = await connect();
    let threw = false;
    try {
      await mcpClient.getPrompt({ name: "leadbay_no_such_prompt" });
    } catch (err: any) {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
