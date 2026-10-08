/**
 * Which hosted URL serves the MCP Apps views (APP_PATHS in http-server.ts).
 *
 *   /mcp          Claude's connector URL — never
 *   /chatgpt/mcp  ChatGPT — yes, and still commerce-free
 *   /apps/mcp     every other agent — yes, commerce on
 *
 * Over a REAL socket through the real Hono app and StreamableHTTP transport,
 * for the reason commerce-free-path.test.ts gives: a route that silently fell
 * back to the wrong buildServer options would look identical at the seam.
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

const TOKEN = "o.test-token_us";
const ME = {
  method: "GET" as const,
  path: "/1.6/users/me",
  status: 200,
  body: { id: 1, email: "rep@leadbay.test", organization: { id: "org-1" } },
};
const TRIAGE_URI = "ui://leadbay/triage-board";

beforeEach(() => resetHttpMock());

describe("/apps/mcp is a registered, discoverable resource", () => {
  it("POST with no token → 401 challenge naming its own metadata", async () => {
    mockHttp([]);
    const res = await app.fetch(
      new Request("https://mcp.test/apps/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      })
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate") ?? "").toContain(
      'resource_metadata="https://mcp.test/.well-known/oauth-protected-resource/apps/mcp"'
    );
  });

  it("OAuth protected-resource metadata echoes the path", async () => {
    mockHttp([]);
    const res = await app.fetch(
      new Request("https://mcp.test/.well-known/oauth-protected-resource/apps/mcp")
    );
    expect(res.status).toBe(200);
    // Collapsing to /mcp would fail the agent's audience check at sign-in.
    expect(((await res.json()) as { resource: string }).resource).toBe("https://mcp.test/apps/mcp");
  });
});

// ── Real socket, real transport ───────────────────────────────────────────────

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

async function catalog(path: string) {
  const base = await startServer();
  const transport = new StreamableHTTPClientTransport(new URL(`${base}${path}`), {
    requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: "apps-path-test", version: "0.0.1" }, {});
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const { resources } = await client.listResources();
    return {
      names: new Set(tools.map((t) => t.name)),
      pullLeadsUi: (tools.find((t) => t.name === "leadbay_pull_leads") as any)?._meta?.ui,
      anyUi: tools.some((t) => (t as any)._meta?.ui),
      views: resources.filter((r) => r.uri.startsWith("ui://")).map((r) => r.uri),
    };
  } finally {
    await client.close().catch(() => {});
  }
}

describe("hosted catalog over the wire", () => {
  it("/mcp (Claude) carries no app pointer and no ui:// resource", async () => {
    mockHttp([ME, ME, ME, ME, ME, ME]);
    const c = await catalog("/mcp");
    expect(c.anyUi).toBe(false);
    expect(c.views).toEqual([]);
  });

  it("/chatgpt/mcp points pull_leads at the board and stays commerce-free", async () => {
    mockHttp([ME, ME, ME, ME, ME, ME]);
    const c = await catalog("/chatgpt/mcp");
    expect(c.pullLeadsUi?.resourceUri).toBe(TRIAGE_URI);
    expect(c.views).toContain(TRIAGE_URI);
    expect(c.names).not.toContain("leadbay_create_topup_link");
  });

  it("/apps/mcp points pull_leads at the board and keeps commerce", async () => {
    mockHttp([ME, ME, ME, ME, ME, ME]);
    const c = await catalog("/apps/mcp");
    expect(c.pullLeadsUi?.resourceUri).toBe(TRIAGE_URI);
    expect(c.views).toContain(TRIAGE_URI);
    expect(c.names).toContain("leadbay_create_topup_link");
  });
});
