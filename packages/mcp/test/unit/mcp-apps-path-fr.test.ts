/**
 * /apps/mcp serves French accounts — no /fr/apps/mcp needed.
 *
 * The region rides in the token's `_fr` / `_us` suffix, not in the connector
 * path (README, "You don't pick a region"). /fr/mcp only survives as an alias
 * for connectors configured before that change. So a French rep on /apps/mcp
 * must be bound to the FR backend and still get the board.
 *
 * Real socket, real Hono app, real StreamableHTTP transport — the same seam as
 * mcp-apps-path.test.ts.
 *
 * New file — does not modify the existing http-* tests.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { app } from "../../src/http-server.js";

const FR_TOKEN = "o.test-token_fr";
const ME = {
  method: "GET" as const,
  path: "/1.6/users/me",
  status: 200,
  body: { id: 1, email: "rep@leadbay.test", organization: { id: "org-1" } },
};

let listener: ReturnType<typeof serve> | undefined;

beforeEach(() => resetHttpMock());

afterAll(async () => {
  await new Promise<void>((resolve) => (listener ? listener.close(() => resolve()) : resolve()));
});

describe("/apps/mcp with a French account", () => {
  it("binds to the FR backend and offers the board", async () => {
    const { requests } = mockHttp([ME, ME, ME, ME, ME, ME]);
    const base = await new Promise<string>((resolve) => {
      listener = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) =>
        resolve(`http://127.0.0.1:${info.port}`)
      );
    });

    const client = new Client({ name: "apps-fr-test", version: "0.0.1" }, {});
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${base}/apps/mcp`), {
          requestInit: { headers: { authorization: `Bearer ${FR_TOKEN}` } },
        })
      );
      const { tools } = await client.listTools();
      const pull = tools.find((t) => t.name === "leadbay_pull_leads") as any;
      expect(pull?._meta?.ui?.resourceUri).toBe("ui://leadbay/triage-board");
    } finally {
      await client.close().catch(() => {});
    }

    // Every Leadbay call this connection made went to the French backend.
    const leadbayHosts = requests.map((r) => new URL(r.url).hostname).filter((h) => h.includes("leadbay"));
    expect(leadbayHosts.length).toBeGreaterThan(0);
    expect(leadbayHosts.every((h) => h.includes("api-fr"))).toBe(true);
  });
});
