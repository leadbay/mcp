/**
 * The layout travels with the result.
 *
 * Claude Code truncates every MCP tool description at 2,048 characters (its
 * docs, and `j_=2048` in the 2.1.247 binary). Measured on 2026-09-18, that cut
 * removed 75% of our description text, including the rendering block in 17 of
 * the 21 tools that carried one: the agent was told to render a three-column
 * table by a sentence it never read.
 *
 * So promptforge's `{{render}}` marker lifts that block out of the description,
 * and the server puts a one-line recipe plus a pointer on every result of the
 * tool. This file pins that behaviour, including the two ways it must stay
 * quiet: never on an error envelope, and never as an instruction sentence.
 *
 * New file — does not modify server.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient, RENDER_RECIPES, RENDER_BLOCKS } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@leadbay/core";

const BASE = "https://api-us.leadbay.app";

const LENS = 4242;

async function connect(extraTools: Tool[] = []) {
  const client = new LeadbayClient(BASE, "u.test-token", "us");
  const server = buildServer(client, { includeWrite: true, extraTools });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "t", version: "0" }, { capabilities: {} });
  await Promise.all([server.connect(a), mcp.connect(b)]);
  return mcp;
}

/** The reads one `leadbay_pull_leads` call makes, with one lead on the page. */
function pullLeadsScript(items: Array<Record<string, unknown>>) {
  return [
    {
      method: "GET" as const,
      path: new RegExp(`/lenses/${LENS}/leads/wishlist`),
      status: 200,
      body: {
        items,
        pagination: { page: 0, pages: 1, total: items.length },
        computing_wishlist: false,
        computing_scores: false,
      },
      repeat: true,
    },
    { method: "GET" as const, path: /\/lenses/, status: 200, body: [{ id: LENS, name: "Test lens" }], repeat: true },
    { method: "POST" as const, path: /\/interactions/, status: 200, body: {}, repeat: true },
    { method: "GET" as const, path: /.*/, status: 200, body: {}, repeat: true },
  ];
}

beforeEach(() => resetHttpMock());

describe("render recipe on the result", () => {
  it("promptforge emitted a block and a recipe for the migrated tool", () => {
    expect(RENDER_BLOCKS.leadbay_pull_leads).toContain("RENDERING");
    expect(RENDER_RECIPES.leadbay_pull_leads).toBeTruthy();
    expect(RENDER_RECIPES.leadbay_pull_leads.length).toBeLessThan(600);
  });

  it("attaches recipe and guide to a real pull_leads result, as data", async () => {
    mockHttp(pullLeadsScript([{ id: "lead-1", name: "ACME", score: 70 }]));
    const mcp = await connect();
    const res: any = await mcp.callTool({
      name: "leadbay_pull_leads",
      arguments: { lensId: LENS, _triggered_by: "show me today's leads" },
    });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.render).toEqual({
      recipe: RENDER_RECIPES.leadbay_pull_leads,
      guide: "leadbay_pull_leads",
    });
    // Data, not an order: a result that instructs the agent gets reported to
    // the user as injected instructions (measured on #257/#259).
    expect(Object.keys(payload.render).sort()).toEqual(["guide", "recipe"]);
    await mcp.close();
  });

  it("stays off a tool that has no render block", async () => {
    mockHttp([
      { method: "GET", path: /\/sectors/, status: 200, body: [], repeat: true },
      { method: "GET", path: /.*/, status: 200, body: {}, repeat: true },
    ]);
    const mcp = await connect();
    const res: any = await mcp.callTool({ name: "leadbay_list_sectors", arguments: {} });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.render).toBeUndefined();
    await mcp.close();
  });

  it("stays off an error envelope", async () => {
    mockHttp([
      {
        method: "GET",
        path: new RegExp(`/lenses/${LENS}/leads/wishlist`),
        status: 429,
        body: { code: "QUOTA_EXCEEDED" },
        repeat: true,
      },
      { method: "GET", path: /.*/, status: 200, body: {}, repeat: true },
    ]);
    const mcp = await connect();
    const res: any = await mcp.callTool({
      name: "leadbay_pull_leads",
      arguments: { lensId: LENS, _triggered_by: "show me today's leads" },
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).not.toContain("render.guide");
    await mcp.close();
  });
});
