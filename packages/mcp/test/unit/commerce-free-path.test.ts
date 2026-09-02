/**
 * /chatgpt/mcp — the hosted URL we submit to the OpenAI app directory.
 *
 * Same server, same auth, but nothing on it sells. The gate is a PATH, not a
 * clientInfo sniff, so this file proves the path actually reaches
 * buildServer({ includeCommerce: false }) rather than trusting the flag exists.
 *
 * The catalog assertion runs over a REAL socket through the real Hono app and
 * the real StreamableHTTP transport. `app.fetch(new Request())` cannot drive
 * that transport (it needs Node req/res), and a route that silently fell back
 * to the commerce-enabled server would look identical at the seam — the exact
 * class of hosted-only regression that went unnoticed for two months when
 * per-user stores were dropped from the HTTP entrypoint.
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

beforeEach(() => resetHttpMock());

function initRequest(url: string): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
}

describe("/chatgpt/mcp is a registered, discoverable resource", () => {
  it("POST with no token → 401 challenge (the route exists; it is not a 404)", async () => {
    mockHttp([]);
    const res = await app.fetch(initRequest("https://mcp.test/chatgpt/mcp"));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate") ?? "").toContain(
      'resource_metadata="https://mcp.test/.well-known/oauth-protected-resource/chatgpt/mcp"'
    );
  });

  it("OAuth protected-resource metadata resolves for the path", async () => {
    mockHttp([]);
    const res = await app.fetch(
      new Request("https://mcp.test/.well-known/oauth-protected-resource/chatgpt/mcp")
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { resource: string };
    // Must echo the requested path, not silently collapse to /mcp — otherwise
    // ChatGPT's sign-in fails audience validation.
    expect(body.resource).toBe("https://mcp.test/chatgpt/mcp");
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

async function listToolNames(path: string): Promise<Set<string>> {
  const base = await startServer();
  const transport = new StreamableHTTPClientTransport(new URL(`${base}${path}`), {
    requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: "commerce-path-test", version: "0.0.1" }, {});
  try {
    await client.connect(transport);
    return new Set((await client.listTools()).tools.map((t) => t.name));
  } finally {
    await client.close().catch(() => {});
  }
}

describe("hosted catalog over the wire", () => {
  it("/mcp still serves the commerce tools", async () => {
    mockHttp([ME, ME, ME, ME]);
    const names = await listToolNames("/mcp");
    expect(names).toContain("leadbay_create_topup_link");
    expect(names).toContain("leadbay_open_billing_portal");
    expect(names).toContain("leadbay_account_status");
  });

  it("/chatgpt/mcp serves the same catalog MINUS the commerce tools", async () => {
    mockHttp([ME, ME, ME, ME]);
    const names = await listToolNames("/chatgpt/mcp");
    expect(names).not.toContain("leadbay_create_topup_link");
    expect(names).not.toContain("leadbay_open_billing_portal");
    // Everything else is still there — this is a gate, not a crippled server.
    expect(names).toContain("leadbay_account_status");
    expect(names).toContain("leadbay_pull_leads");
  });
});
