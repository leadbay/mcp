/**
 * The welcome board: where it opens, and how the agent is told to open it.
 *
 *   - On the MCP Apps surfaces, `leadbay_welcome` points at the welcome board
 *     and the view is the kit's `onboarding` page, byte for byte.
 *   - On Claude it carries no pointer (the agent publishes the same page as
 *     an artifact instead), like every other board.
 *   - The server instructions route a new user to it, and keep "walk me
 *     through" on the guided tour.
 *
 * New file — does not modify mcp-apps-gate.test.ts or first-run-routing.test.ts.
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
const WELCOME_URI = "ui://leadbay/welcome";

beforeEach(() => resetHttpMock());

async function connect(includeApps: boolean) {
  const client = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(client, { includeWrite: true, includeApps });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
  return mcpClient;
}

describe("the welcome board on the MCP Apps surfaces", () => {
  it("leadbay_welcome points at the welcome board", async () => {
    const mcp = await connect(true);
    const { tools } = await mcp.listTools();
    const tool = tools.find((t) => t.name === "leadbay_welcome");
    expect(tool, "leadbay_welcome is registered").toBeDefined();
    expect((tool as any)._meta?.ui?.resourceUri).toBe(WELCOME_URI);
  });

  it("serves the kit's onboarding page as it is, loading nothing from outside", async () => {
    const mcp = await connect(true);
    const { contents } = await mcp.readResource({ uri: WELCOME_URI });
    expect(contents[0].mimeType).toBe(MCP_APP_MIME_TYPE);
    expect((contents[0] as any).text).toBe(ARTIFACT_TEMPLATES.onboarding.html);
    expect((contents[0] as any)._meta?.ui?.csp).toBeUndefined();
  });

  it("its description tells the agent the board is the answer", async () => {
    const mcp = await connect(true);
    const { tools } = await mcp.listTools();
    const d = tools.find((t) => t.name === "leadbay_welcome")!.description ?? "";
    expect(d).toMatch(/the board IS the rendering/);
  });
});

describe("the welcome board on Claude", () => {
  it("carries no pointer and no board prose — the agent publishes the template instead", async () => {
    const mcp = await connect(false);
    const { tools } = await mcp.listTools();
    const tool = tools.find((t) => t.name === "leadbay_welcome")!;
    expect((tool as any)._meta?.ui).toBeUndefined();
    expect(tool.description).not.toMatch(/the board IS the rendering/);
    expect(tool.description).toContain('template: "onboarding"');
  });

  it("the kit serves the board to publish, reading the account through leadbay_welcome", async () => {
    const t = ARTIFACT_TEMPLATES.onboarding;
    expect(t.title).toBe("Welcome to Leadbay");
    expect(t.tools).toContain("leadbay_welcome");
  });
});

describe("the instructions route a new user to the board", () => {
  async function instructions(): Promise<string> {
    const mcp = await connect(false);
    return mcp.getInstructions() ?? "";
  }

  it("names the welcome phrasings and the first_run signal", async () => {
    const ins = await instructions();
    const welcome = ins.slice(ins.indexOf("WELCOME:"), ins.indexOf("TOUR:"));
    expect(welcome).toContain("leadbay_welcome");
    expect(welcome).toContain("what can Leadbay do");
    expect(welcome).toContain("first_run: true");
  });

  it("keeps 'walk me through' on the tour, which it now counts right", async () => {
    const ins = await instructions();
    const tour = ins.slice(ins.indexOf("TOUR:"));
    expect(tour).toContain("walk me through Leadbay");
    expect(tour).toContain("four-gate walkthrough");
    expect(ins).not.toContain("five-gate");
  });
});
