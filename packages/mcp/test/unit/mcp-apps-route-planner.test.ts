/**
 * The route planner as the second MCP Apps view, for leadbay_followups_map.
 *
 * Same contract as the triage board (mcp-apps-gate.test.ts): never on the
 * Claude surface, served byte-for-byte from the kit on the apps surfaces —
 * plus the one thing the triage board did not need: the planner loads Leaflet
 * from cdnjs, so its resource must declare that origin, and only that one.
 *
 * New file — does not modify server.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetHttpMock, httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient, ARTIFACT_TEMPLATES } from "@leadbay/core";
import { buildServer } from "../../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";
const PLANNER_URI = "ui://leadbay/route-planner";
const BOARD_SENTENCE = "If the host shows the Leadbay route planner for this call";

beforeEach(() => resetHttpMock());

async function connect(opts: { includeApps?: boolean; includeCommerce?: boolean } = {}) {
  const server = buildServer(new LeadbayClient(BASE, "u.test-token"), { includeWrite: true, ...opts });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([server.connect(st), mcp.connect(ct)]);
  return mcp;
}

const mapTool = async (mcp: Client) =>
  (await mcp.listTools()).tools.find((t) => t.name === "leadbay_followups_map") as any;

describe("Claude surface", () => {
  it("followups_map carries no board pointer and no board sentence", async () => {
    const tool = await mapTool(await connect());
    expect(tool._meta?.ui).toBeUndefined();
    expect(tool.description).not.toContain(BOARD_SENTENCE);
    // Claude still routes to its own map widget.
    expect(tool.description).toContain("places_map_display_v0");
  });

  it("the planner is not listed or readable", async () => {
    const mcp = await connect();
    expect((await mcp.listResources()).resources.map((r) => r.uri)).not.toContain(PLANNER_URI);
    await expect(mcp.readResource({ uri: PLANNER_URI })).rejects.toThrow();
  });
});

describe("apps surfaces", () => {
  for (const [label, opts] of [
    ["/apps/mcp", { includeApps: true }],
    ["/chatgpt/mcp", { includeApps: true, includeCommerce: false }],
  ] as const) {
    it(`${label}: followups_map points at the planner and says the board is the answer`, async () => {
      const tool = await mapTool(await connect(opts));
      expect(tool._meta?.ui?.resourceUri).toBe(PLANNER_URI);
      expect(tool.description).toContain(BOARD_SENTENCE);
      expect(tool.description.length).toBeLessThanOrEqual(17_000);
    });
  }

  it("serves the kit's finished planner, declaring cdnjs and nothing else", async () => {
    const mcp = await connect({ includeApps: true });
    const [c] = (await mcp.readResource({ uri: PLANNER_URI })).contents as any[];
    expect(c.mimeType).toBe("text/html;profile=mcp-app");
    expect(c.text).toBe(ARTIFACT_TEMPLATES.route_planner.html);
    expect(c._meta.ui.csp).toEqual({ resourceDomains: ["https://cdnjs.cloudflare.com"] });
    // The page's only external script is the origin it declares.
    const scripts = [...c.text.matchAll(/<script[^>]+src="(https:\/\/[^/"]+)/g)].map((m: RegExpMatchArray) => m[1]);
    expect(new Set(scripts)).toEqual(new Set(["https://cdnjs.cloudflare.com"]));
  });

  it("the triage board still declares no csp", async () => {
    const mcp = await connect({ includeApps: true });
    const [c] = (await mcp.readResource({ uri: "ui://leadbay/triage-board" })).contents as any[];
    expect(c._meta.ui.csp).toBeUndefined();
  });
});
