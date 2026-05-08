/**
 * resources/subscribe + resources/unsubscribe + completion/complete (iter28).
 *
 * Verifies the new capability surface advertised on resources/* and the
 * completion provider that auto-completes URI template arguments.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CompleteResultSchema,
  EmptyResultSchema,
} from "@modelcontextprotocol/sdk/types.js";

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

beforeEach(() => {
  resetHttpMock();
});

describe("resources/subscribe + completion (iter28)", () => {
  it("server advertises resources.subscribe + listChanged + completions capabilities", async () => {
    const { mcpClient } = await connect();
    const caps = mcpClient.getServerCapabilities();
    expect(caps).toBeDefined();
    expect((caps as any).resources?.subscribe).toBe(true);
    expect((caps as any).resources?.listChanged).toBe(true);
    expect((caps as any).completions).toBeDefined();
  });

  it("resources/subscribe accepts a URI and returns success", async () => {
    const { mcpClient } = await connect();
    const result = await mcpClient.request(
      {
        method: "resources/subscribe",
        params: { uri: "org://taste-profile" },
      },
      // empty result schema accepted via any
      EmptyResultSchema
    );
    expect(result).toBeDefined();
  });

  it("resources/unsubscribe accepts a URI and returns success", async () => {
    const { mcpClient } = await connect();
    await mcpClient.request(
      { method: "resources/subscribe", params: { uri: "org://taste-profile" } },
      EmptyResultSchema
    );
    const result = await mcpClient.request(
      {
        method: "resources/unsubscribe",
        params: { uri: "org://taste-profile" },
      },
      EmptyResultSchema
    );
    expect(result).toBeDefined();
  });

  it("completion/complete returns matching lead UUIDs for lead:// template", async () => {
    mockHttp([
      // resolveDefaultLens → /me
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: {
          id: "u",
          organization: { id: "org-1", name: "X" },
          last_requested_lens: 42,
        },
      },
      {
        method: "GET",
        path: /\/1\.5\/lenses\/42\/leads\/wishlist/,
        status: 200,
        body: {
          items: [
            { id: "abc12345-0000-4000-8000-000000000001", name: "Acme" },
            { id: "abc99999-0000-4000-8000-000000000002", name: "Widget" },
            { id: "xyz12345-0000-4000-8000-000000000003", name: "Initech" },
          ],
        },
      },
    ]);
    const { mcpClient } = await connect();
    const result: any = await mcpClient.request(
      {
        method: "completion/complete",
        params: {
          ref: { type: "ref/resource", uri: "lead://{uuid}/profile" },
          argument: { name: "uuid", value: "abc" },
        },
      },
      CompleteResultSchema
    );
    expect(result.completion).toBeDefined();
    expect(result.completion.values.length).toBe(2);
    expect(result.completion.values).toContain("abc12345-0000-4000-8000-000000000001");
    expect(result.completion.values).toContain("abc99999-0000-4000-8000-000000000002");
  });

  it("completion/complete returns empty for unsupported ref type", async () => {
    const { mcpClient } = await connect();
    const result: any = await mcpClient.request(
      {
        method: "completion/complete",
        params: {
          ref: { type: "ref/prompt", name: "daily-check-in" },
          argument: { name: "anything", value: "x" },
        },
      },
      CompleteResultSchema
    );
    expect(result.completion.values).toEqual([]);
  });
});
