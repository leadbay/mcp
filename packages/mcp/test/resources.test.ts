/**
 * Resources test — verifies the resources/* capability and 3 URI
 * schemes (lead://, lens://, org://).
 */

import { describe, it, expect, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

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

describe("resources/* capability (P3 resources)", () => {
  it("resources/list returns the org taste-profile singleton", async () => {
    const { mcpClient } = await connect();
    const listed = await mcpClient.listResources();
    expect(listed.resources.length).toBeGreaterThanOrEqual(1);
    const taste = listed.resources.find((r) => r.uri === "org://taste-profile");
    expect(taste).toBeDefined();
    expect(taste!.mimeType).toBe("application/json");
    const memory = listed.resources.find((r) => r.uri === "agent-memory://summary");
    expect(memory).toBeDefined();
    expect(memory!.mimeType).toBe("text/markdown");
  });

  it("resources/templates/list returns lead:// and lens:// templates", async () => {
    const { mcpClient } = await connect();
    const listed = await mcpClient.listResourceTemplates();
    const uris = listed.resourceTemplates.map((t) => t.uriTemplate);
    expect(uris).toContain("lead://{uuid}/profile");
    expect(uris).toContain("lens://{id}/definition");
  });

  it("resources/read fetches lens://{id}/definition", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/lenses/42/filter",
        status: 200,
        body: { lens_filter: { items: [] }, locations: { results: [], parents: [] } },
      },
      {
        method: "GET",
        path: "/1.5/lenses/42/scoring",
        status: 200,
        body: { weights: [] },
      },
    ]);
    const { mcpClient } = await connect();
    const result = await mcpClient.readResource({ uri: "lens://42/definition" });
    expect(result.contents.length).toBe(1);
    expect(result.contents[0].uri).toBe("lens://42/definition");
    expect(result.contents[0].mimeType).toBe("application/json");
    const text = result.contents[0].text as string;
    const parsed = JSON.parse(text);
    expect(parsed.lensId).toBe(42);
    expect(parsed.filter).toBeDefined();
    expect(parsed.scoring).toBeDefined();
  });

  it("resources/read with unknown URI throws", async () => {
    const { mcpClient } = await connect();
    let threw = false;
    try {
      await mcpClient.readResource({ uri: "garbage://nope" });
    } catch (err: any) {
      threw = true;
      expect(String(err)).toContain("Unsupported");
    }
    expect(threw).toBe(true);
  });
});
