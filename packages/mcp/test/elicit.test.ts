/**
 * Elicitation test — verifies ctx.elicit round-trip via the SDK's
 * elicitation/create form-based mode.
 *
 * Per MCP 2025-11-25 §Elicitation, the server can ask the user a
 * one-off clarifying question via the client. This test pins the
 * wiring with a fake tool that calls ctx.elicit; the client-side
 * elicitation handler responds with a fake-accept; the tool sees
 * the response.
 */

import { describe, it, expect, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import type { Tool } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const BASE = "https://api-us.leadbay.app";

describe("elicitation/create round-trip (P2 elicitInput)", () => {
  it("ctx.elicit calls extra.sendRequest; client responds; tool sees result", async () => {
    const tool: Tool = {
      name: "leadbay_test_elicit_tool",
      description: "Test-only tool that asks the user for an answer.",
      annotations: {
        title: "Test elicit tool",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: async (_client, _params, ctx) => {
        if (!ctx?.elicit) {
          return { error: "elicit-not-wired" };
        }
        const answer = await ctx.elicit({
          message: "Pick your favourite color",
          requestedSchema: {
            type: "object",
            properties: {
              color: {
                type: "string",
                enum: ["red", "blue", "green"],
                title: "Color",
              },
            },
            required: ["color"],
          },
        });
        return {
          action: answer.action,
          color: answer.content?.color,
        };
      },
    };

    const lbClient = new LeadbayClient(BASE, "u.test-token");
    const server = buildServer(lbClient, { extraTools: [tool] });
    // Configure the client to accept elicitation requests AND answer them.
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client(
      { name: "test", version: "0.0.1" },
      { capabilities: { elicitation: {} } }
    );
    // Client-side handler answering elicitation requests.
    mcpClient.setRequestHandler(ElicitRequestSchema, async (req) => {
      // Sanity-check the request shape.
      expect(req.params.message).toBe("Pick your favourite color");
      expect((req.params.requestedSchema as any).type).toBe("object");
      return {
        action: "accept",
        content: { color: "blue" },
      };
    });
    await Promise.all([
      server.connect(serverTransport),
      mcpClient.connect(clientTransport),
    ]);

    const result = await mcpClient.callTool({
      name: "leadbay_test_elicit_tool",
      arguments: {},
    });
    expect((result as any).isError).not.toBe(true);
    const text = (result as any).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.action).toBe("accept");
    expect(parsed.color).toBe("blue");
  });

  it("refine_prompt uses ctx.elicit when client supports elicitation (iter14)", async () => {
    // Mock backend: POST user_prompt → GET clarifications (returns one) →
    // POST pick_clarification (the auto-answer triggered by elicit accept).
    mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: {
          email: "admin@example.com",
          admin: true,
          organization: { id: "org-1", name: "Test Co" },
          last_requested_lens: 1,
        },
      },
      {
        method: "POST",
        path: "/1.5/organizations/org-1/user_prompt",
        status: 200,
        body: {},
      },
      {
        method: "GET",
        path: "/1.5/organizations/org-1/clarifications",
        status: 200,
        body: {
          id: "clar-1",
          question: "Did you mean dental hospitals or general hospitals?",
          options: [
            { id: "opt-dental", label: "Dental hospitals" },
            { id: "opt-general", label: "General hospitals" },
          ],
          created_at: new Date().toISOString(),
        },
      },
      {
        method: "POST",
        path: "/1.5/organizations/org-1/pick_clarification",
        status: 200,
        body: {},
      },
    ]);

    const lbClient = new LeadbayClient(BASE, "u.test-token");
    const server = buildServer(lbClient, { includeWrite: true });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client(
      { name: "test", version: "0.0.1" },
      { capabilities: { elicitation: {} } }
    );
    // Client picks the dental option when asked.
    mcpClient.setRequestHandler(ElicitRequestSchema, async (req) => {
      expect(req.params.message).toContain("dental");
      return {
        action: "accept",
        content: { option_id: "opt-dental" },
      };
    });
    await Promise.all([
      server.connect(serverTransport),
      mcpClient.connect(clientTransport),
    ]);

    const result = await mcpClient.callTool({
      name: "leadbay_refine_prompt",
      arguments: {
        prompt: "focus on hospitals",
        clarification_poll_attempts: 1,
        clarification_poll_gap_ms: 5,
        _triggered_by: "test trigger",
      },
    });
    expect((result as any).isError).not.toBe(true);
    const text = (result as any).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.status).toBe("applied");
    expect(parsed.clarified_via_elicit).toBe(true);
  }, 15_000);
});
