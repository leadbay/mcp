/**
 * Concurrency test for the MCP server — catches the "semaphore leak across
 * concurrent tool calls" class of bugs flagged in the Eng review.
 *
 * Dispatches 10 concurrent tools/call requests through an InMemoryTransport,
 * asserts:
 *   - all resolve
 *   - the LeadbayClient semaphore returns to 0 (no leaked slots, no stuck queue)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

beforeEach(() => {
  resetHttpMock();
});

describe("MCP server — concurrency", () => {
  it("10 concurrent tools/call resolve and leave the semaphore at zero", async () => {
    // Each find_prospects call makes at minimum: GET /lenses + GET wishlist.
    // pull_leads needs /me + wishlist per call. /me has a 60s cache, BUT
    // concurrent callers can race past the cache check before the first
    // response populates it. Pre-script enough /me responses for the worst
    // case (one per concurrent caller).
    const scripts: any[] = [];
    for (let i = 0; i < 10; i++) {
      scripts.push({
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: {
          id: "u",
          organization: { id: "org-1", name: "X" },
          last_requested_lens: 42,
        },
      });
    }
    for (let i = 0; i < 10; i++) {
      scripts.push({
        method: "GET",
        path: /\/1\.5\/lenses\/42\/leads\/wishlist/,
        status: 200,
        body: {
          items: [],
          pagination: { page: 0, pages: 0, total: 0 },
          computing_wishlist: false,
          computing_scores: false,
        },
      });
    }
    mockHttp(scripts);

    const lbClient = new LeadbayClient(BASE, "u.test-token");
    const server = buildServer(lbClient, { includeAdvanced: true });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
    await Promise.all([
      server.connect(serverTransport),
      mcpClient.connect(clientTransport),
    ]);

    // Dispatch 10 concurrent calls
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        mcpClient.callTool({
          name: "leadbay_pull_leads",
          arguments: { count: 5, _triggered_by: "test trigger" },
        })
      );
    }
    const results = await Promise.all(promises);

    // All resolved (even if client-level the cache means only 1 /lenses went out;
    // the server-level plumbing should still handle 10 concurrent calls).
    expect(results).toHaveLength(10);
    const errors = results.filter((r: any) => r.isError);
    if (errors.length) {
      const firstErrorContent = (errors[0] as any).content?.[0]?.text;
      console.error("CONCURRENCY ERROR:", firstErrorContent);
    }
    for (const r of results) {
      expect(r.isError).toBeFalsy();
    }

    // Semaphore back to zero: no leaked active slots, no queued callers.
    expect(lbClient._semaphoreState).toEqual({ active: 0, queued: 0 });
  });

  it("concurrent requests that trigger queue-wait all resolve cleanly", async () => {
    // MAX_CONCURRENT = 5. Dispatch 15 raw client requests; ensure semaphore drains.
    const scripts = [];
    for (let i = 0; i < 15; i++) {
      scripts.push({
        method: "GET",
        path: `/1.5/ping-${i}`,
        status: 200,
        body: { ok: true, i },
      });
    }
    mockHttp(scripts);

    const client = new LeadbayClient(BASE, "u.test-token");
    const promises = [];
    for (let i = 0; i < 15; i++) {
      promises.push(client.request("GET", `/ping-${i}`));
    }
    const results = await Promise.all(promises);

    expect(results).toHaveLength(15);
    expect(client._semaphoreState).toEqual({ active: 0, queued: 0 });
  });
});
