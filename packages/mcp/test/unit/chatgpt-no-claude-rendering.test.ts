/**
 * /chatgpt/mcp is served without the rendering and NEXT STEPS instructions
 * written for Claude.
 *
 * ChatGPT's own tool-call check rated those blocks "danger HIGH" on every
 * Leadbay approval card (2026-10-24): "Tool documentation prescribes
 * classifier handling and output behavior, including mandatory rendering and
 * next-step widget instructions." The `{{claude}}` marker (promptforge
 * src/claude.ts) deletes them from the ChatGPT variant only.
 *
 * The other half: every other surface reads exactly what it read before.
 *
 * New file — does not modify server.test.ts or the apps/commerce tests.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetHttpMock, httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient, NO_COMMERCE_TOOL_DESCRIPTIONS, APPS_TOOL_DESCRIPTIONS } from "@leadbay/core";
import { buildServer } from "../../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";
const CLAUDE_RENDERING = /^#{2,3} (RENDER|NEXT STEPS)/m;
const WIDGET_TABLE = "GATE — PREFER BUILT-IN HOST WIDGETS";

beforeEach(() => resetHttpMock());

async function descriptions(opts: { includeApps?: boolean; includeCommerce?: boolean }) {
  const server = buildServer(new LeadbayClient(BASE, "u.test-token"), { includeWrite: true, ...opts });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([server.connect(st), mcp.connect(ct)]);
  const { tools } = await mcp.listTools();
  return new Map(tools.map((t) => [t.name, t.description ?? ""]));
}

const chatgpt = () => descriptions({ includeApps: true, includeCommerce: false });
const claude = () => descriptions({});

// By code point: the descriptions carry emoji (📝), two UTF-16 units each.
function isSubsequence(short: string, long: string): boolean {
  const want = [...short];
  let i = 0;
  for (const ch of long) if (i < want.length && ch === want[i]) i++;
  return i === want.length;
}

describe("ChatGPT (/chatgpt/mcp)", () => {
  it("no tool carries a RENDER or NEXT STEPS section, nor the widget table", async () => {
    for (const [name, d] of await chatgpt()) {
      expect(d, name).not.toMatch(CLAUDE_RENDERING);
      expect(d, name).not.toContain(WIDGET_TABLE);
    }
  });

  it("no marker leaks into a description", async () => {
    for (const [name, d] of await chatgpt()) expect(d, name).not.toMatch(/\{\{\/?claude\}\}/);
  });

  it("every description is the other surfaces' text with parts deleted, never reworded", async () => {
    const claudeSide = await claude();
    for (const [name, d] of await chatgpt()) {
      // The apps variant when the tool has one (it carries the board sentence),
      // else the commerce-free one, else what Claude reads.
      const source =
        APPS_TOOL_DESCRIPTIONS[name] ?? NO_COMMERCE_TOOL_DESCRIPTIONS[name] ?? claudeSide.get(name);
      if (source === undefined) continue; // a tool Claude does not get
      expect(isSubsequence(d, source), name).toBe(true);
    }
  });

  it("keeps what the tool does and when to use it", async () => {
    const d = (await chatgpt()).get("leadbay_pull_leads")!;
    expect(d).toMatch(/^## WHAT IT DOES/);
    expect(d).toContain("## WHEN TO USE");
    expect(d.length).toBeLessThan((await claude()).get("leadbay_pull_leads")!.length);
  });
});

describe("every other surface keeps the rendering text", () => {
  it("Claude (/mcp) still has RENDER (quick) and NEXT STEPS on pull_leads", async () => {
    const d = (await claude()).get("leadbay_pull_leads")!;
    expect(d).toContain("## RENDER (quick)");
    expect(d).toMatch(/## NEXT STEPS/);
  });

  it("/apps/mcp serves the apps variant with its rendering intact", async () => {
    const d = (await descriptions({ includeApps: true })).get("leadbay_pull_leads")!;
    expect(d).toBe(APPS_TOOL_DESCRIPTIONS["leadbay_pull_leads"]);
    expect(d).toContain("## RENDER (quick)");
  });
});
