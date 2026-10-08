/**
 * buildServer({ includeApps }) — the MCP Apps views (apps.ts).
 *
 * The half that matters most is the OFF half: the Claude surface must never
 * carry a `_meta.ui` pointer or a `ui://` resource. Claude renders an MCP App
 * as a sandboxed iframe and then stops routing to its own first-party widgets
 * (CLAUDE.md, "Rendering surface"), so a leak here is the regression that got
 * MCP Apps removed in 0.10.0-dev.12.
 *
 * The ON half proves the view the host is pointed at exists and is the very
 * page the kit hands an agent to publish as a Claude artifact — one board,
 * served byte-for-byte.
 *
 * New file — does not modify server.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetHttpMock, httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient, ARTIFACT_TEMPLATES } from "@leadbay/core";
import { buildServer } from "../../src/server.js";
import { MCP_APP_MIME_TYPE } from "../../src/apps.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";
const TRIAGE_URI = "ui://leadbay/triage-board";

beforeEach(() => resetHttpMock());

async function connect(includeApps?: boolean) {
  const client = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(client, {
    includeWrite: true,
    ...(includeApps === undefined ? {} : { includeApps }),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
  return mcpClient;
}

describe("apps off — the Claude surface", () => {
  for (const [label, flag] of [["default", undefined], ["includeApps:false", false]] as const) {
    it(`${label}: no tool carries a _meta.ui pointer`, async () => {
      const mcp = await connect(flag);
      const { tools } = await mcp.listTools();
      expect(tools.length).toBeGreaterThan(0);
      for (const t of tools) expect((t as any)._meta?.ui, t.name).toBeUndefined();
      expect(JSON.stringify(tools)).not.toContain("ui://");
    });

    it(`${label}: no ui:// resource is listed or readable`, async () => {
      const mcp = await connect(flag);
      const { resources } = await mcp.listResources();
      expect(resources.some((r) => r.uri.startsWith("ui://"))).toBe(false);
      await expect(mcp.readResource({ uri: TRIAGE_URI })).rejects.toThrow();
    });
  }
});

describe("apps on — the non-Claude surfaces", () => {
  it("leadbay_pull_leads points the host at the triage board", async () => {
    const mcp = await connect(true);
    const { tools } = await mcp.listTools();
    const pull = tools.find((t) => t.name === "leadbay_pull_leads");
    expect((pull as any)?._meta?.ui?.resourceUri).toBe(TRIAGE_URI);
  });

  it("only tools with a board get a pointer", async () => {
    const mcp = await connect(true);
    const { tools } = await mcp.listTools();
    const pointed = tools.filter((t) => (t as any)._meta?.ui).map((t) => t.name);
    expect(pointed.sort()).toEqual(["leadbay_followups_map", "leadbay_pull_leads"]);
  });

  it("the board is listed as an MCP App resource", async () => {
    const mcp = await connect(true);
    const { resources } = await mcp.listResources();
    const view = resources.find((r) => r.uri === TRIAGE_URI);
    expect(view?.mimeType).toBe(MCP_APP_MIME_TYPE);
    expect(view?.name).toBe(ARTIFACT_TEMPLATES.triage_board.title);
  });

  it("reading it returns the kit's finished page, unchanged", async () => {
    const mcp = await connect(true);
    const res = await mcp.readResource({ uri: TRIAGE_URI });
    expect(res.contents).toHaveLength(1);
    const [c] = res.contents as any[];
    expect(c.uri).toBe(TRIAGE_URI);
    expect(c.mimeType).toBe("text/html;profile=mcp-app");
    expect(c.text).toBe(ARTIFACT_TEMPLATES.triage_board.html);
    // The board makes no network request of its own, so it declares no CSP
    // domains and runs under the spec's restrictive default.
    expect(c._meta?.ui?.csp).toBeUndefined();
  });

  it("the page it serves carries the MCP Apps transport", async () => {
    const mcp = await connect(true);
    const [c] = (await mcp.readResource({ uri: TRIAGE_URI })).contents as any[];
    expect(c.text).toContain("ui/initialize");
    expect(c.text).toContain("tools/call");
  });

  it("the other resources still resolve as before", async () => {
    const off = await connect(false);
    const on = await connect(true);
    const offUris = (await off.listResources()).resources.map((r) => r.uri);
    const onUris = (await on.listResources()).resources.map((r) => r.uri);
    expect(onUris.filter((u) => !u.startsWith("ui://"))).toEqual(offUris);
  });
});
