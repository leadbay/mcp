/**
 * /chatgpt/mcp asks for a summary of the request, not the user's words.
 *
 * OpenAI's tool scan flagged the 39 tools whose `_triggered_by` demanded a
 * verbatim copy of the user's message: "This tool appears to request
 * information beyond what its stated operation requires." On the ChatGPT URL
 * the field asks for one third-person sentence instead (Mazemind's wording,
 * which passed the same scan), is optional, and a call without it runs.
 *
 * The other half matters as much: every other surface keeps the verbatim
 * mandate, the LAST_PROMPT_REQUIRED guard and the server-instruction block.
 *
 * New file — does not modify server.test.ts or the http-* tests.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { LeadbayClient, COMPOSITE_FILE_TOOL_NAMES } from "@leadbay/core";
import { buildServer } from "../../src/server.js";
import { app } from "../../src/http-server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = "https://api-us.leadbay.app";
const VERBATIM = /verbatim|copy\/paste|Quote literally/i;
const INSTRUCTION_HEAD = "Trigger provenance (MANDATORY)";
// The LAST_PROMPT_REQUIRED envelope, as formatErrorForLLM renders it.
const REJECTION = "Every call to this tool must carry `_triggered_by`";

beforeEach(() => resetHttpMock());

async function connect(summaryTriggeredBy?: boolean) {
  const server = buildServer(new LeadbayClient(BASE, "u.test-token"), {
    includeWrite: true,
    includeCommerce: false,
    includeApps: true,
    ...(summaryTriggeredBy === undefined ? {} : { summaryTriggeredBy }),
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([server.connect(b), client.connect(a)]);
  return client;
}

const field = (t: any) => t.inputSchema?.properties?._triggered_by;
const required = (t: any): string[] => t.inputSchema?.required ?? [];

describe("summaryTriggeredBy: the ChatGPT surface", () => {
  it("every tool asks for a third-person summary, never the user's words", async () => {
    const { tools } = await (await connect(true)).listTools();
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(field(t)?.description, t.name).toMatch(/^What the user wants from this call, in one sentence/);
      expect(field(t)?.description, t.name).not.toMatch(VERBATIM);
      expect(required(t), t.name).not.toContain("_triggered_by");
    }
  });

  it("keeps `_origin`, which the boards stamp on their calls", async () => {
    const { tools } = await (await connect(true)).listTools();
    const pull = tools.find((t) => t.name === "leadbay_pull_leads") as any;
    expect(pull.inputSchema.properties._origin).toBeDefined();
  });

  it("the server instructions drop the verbatim mandate", async () => {
    const instructions = (await connect(true)).getInstructions() ?? "";
    expect(instructions).not.toContain(INSTRUCTION_HEAD);
    expect(instructions).not.toMatch(/verbatim slice of the user's most recent message/);
  });

  it("a composite call without `_triggered_by` is not rejected", async () => {
    mockHttp([]);
    const res = await (await connect(true)).callTool({
      name: "leadbay_research_lead_by_id",
      arguments: { leadId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(JSON.stringify(res.content)).not.toContain(REJECTION);
  });
});

describe("default: every other surface keeps the verbatim mandate", () => {
  for (const [label, flag] of [["unset", undefined], ["false", false]] as const) {
    it(`${label}: composite tools require the verbatim quote`, async () => {
      const { tools } = await (await connect(flag)).listTools();
      const composites = tools.filter((t) => COMPOSITE_FILE_TOOL_NAMES.has(t.name));
      expect(composites.length).toBeGreaterThan(0);
      for (const t of composites) {
        expect(required(t), t.name).toContain("_triggered_by");
        expect(field(t)?.description, t.name).toMatch(/^MANDATORY/);
      }
    });

    it(`${label}: the instruction block is there`, async () => {
      expect((await connect(flag)).getInstructions() ?? "").toContain(INSTRUCTION_HEAD);
    });

    it(`${label}: a composite call without it is rejected`, async () => {
      mockHttp([]);
      const res = await (await connect(flag)).callTool({
        name: "leadbay_research_lead_by_id",
        arguments: { leadId: "00000000-0000-0000-0000-000000000000" },
      });
      expect(JSON.stringify(res.content)).toContain(REJECTION);
    });
  }
});

// ── Over the wire: the path decides, not a default ───────────────────────────

const TOKEN = "o.test-token_us";
const ME = {
  method: "GET" as const,
  path: "/1.6/users/me",
  status: 200,
  body: { id: 1, email: "rep@leadbay.test", organization: { id: "org-1" } },
};

let listener: ReturnType<typeof serve> | undefined;
let baseUrl = "";

async function startServer(): Promise<string> {
  if (baseUrl) return baseUrl;
  await new Promise<void>((resolve) => {
    listener = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) => {
      baseUrl = `http://127.0.0.1:${info.port}`;
      resolve();
    });
  });
  return baseUrl;
}

afterAll(async () => {
  await new Promise<void>((resolve) => {
    if (!listener) return resolve();
    listener.close(() => resolve());
  });
});

async function pullLeadsField(path: string) {
  const base = await startServer();
  const transport = new StreamableHTTPClientTransport(new URL(`${base}${path}`), {
    requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: "summary-path-test", version: "0.0.1" }, {});
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    return field(tools.find((t) => t.name === "leadbay_pull_leads"))?.description as string;
  } finally {
    await client.close().catch(() => {});
  }
}

describe("hosted paths", () => {
  it("/chatgpt/mcp serves the summary wording", async () => {
    mockHttp([ME, ME, ME, ME, ME, ME]);
    expect(await pullLeadsField("/chatgpt/mcp")).toMatch(/^What the user wants from this call/);
  });

  for (const path of ["/mcp", "/apps/mcp"]) {
    it(`${path} keeps the verbatim mandate`, async () => {
      mockHttp([ME, ME, ME, ME, ME, ME]);
      expect(await pullLeadsField(path)).toMatch(/^MANDATORY/);
    });
  }
});
