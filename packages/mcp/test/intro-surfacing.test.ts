/**
 * One-time "intro to Arty" surfacing (leadbay/product#3829).
 *
 * On the FIRST tool result of a session for a brand-new user (the per-user
 * backend flag `arty_intro_shown` is false on /me), the server attaches
 * `_meta.intro = ARTY_INTRO` and fires POST /users/arty_intro_shown to flip
 * the flag. It surfaces at most once per session (boolean gate) and — via the
 * backend flag — once ever across surfaces. Absent/true flag → nothing, so the
 * MCP is safe to ship ahead of the backend.
 *
 * Driven against the real JSON-RPC server with mocked HTTP.
 *
 * New file (never modify existing test files — repo invariant).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";
import { vi } from "vitest";

vi.mock("node:https", () => httpsMockFactory());

import type { Tool } from "@leadbay/core";
import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { ARTY_INTRO } from "../src/intro.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

// Trivial JSON-returning tool — "any non-account_status tool" without coupling
// to a real composite's HTTP shape. Not in COMPOSITE_FILE_TOOL_NAMES, so it
// needs no _triggered_by (same reason update-surfacing uses a bare ping).
const pingTool: Tool = {
  name: "leadbay_ping_test",
  description: "test-only ping",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: {
    type: "object",
    properties: { pong: { type: "boolean" } },
    required: ["pong"],
  },
  annotations: { readOnlyHint: true },
  execute: async () => ({ pong: true }),
};

// Returns a Leadbay error envelope — serialized as a bare { content, isError }
// with no _meta. The intro must NOT be consumed by such a result.
const errorTool: Tool = {
  name: "leadbay_error_test",
  description: "test-only error",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true },
  execute: async () => ({
    error: true as const,
    code: "QUOTA_EXCEEDED",
    message: "quota hit",
    hint: "retry later",
  }),
};

function meScript(artyIntroShown: boolean | undefined) {
  const body: Record<string, unknown> = {
    id: "u",
    email: "a@b.co",
    name: "Tester",
    organization: { id: "org-1", name: "Org", ai_agent_enabled: true },
  };
  if (artyIntroShown !== undefined) body.arty_intro_shown = artyIntroShown;
  return { method: "GET", path: "/1.6/users/me", status: 200, body } as const;
}

const introSetterScript = {
  method: "POST",
  path: "/1.6/users/arty_intro_shown",
  status: 204,
} as const;

async function connect(token: string | null) {
  const lbClient = new LeadbayClient(BASE, token as any);
  const server = buildServer(lbClient, {
    includeWrite: true,
    version: "0.0.0-test",
    extraTools: [pingTool, errorTool],
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return { mcpClient };
}

beforeEach(() => resetHttpMock());

describe("intro surfacing — brand-new user (product#3829)", () => {
  it("attaches _meta.intro on the FIRST tool result when arty_intro_shown is false", async () => {
    const { requests } = mockHttp([meScript(false), introSetterScript]);
    const { mcpClient } = await connect("u.test-token");

    const result = await mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });
    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as any;
    expect(structured.pong).toBe(true);
    expect(structured._meta?.intro).toMatchObject({
      name: ARTY_INTRO.name,
      role: ARTY_INTRO.role,
      whatsapp: ARTY_INTRO.whatsapp,
      email: ARTY_INTRO.email,
      calendly: ARTY_INTRO.calendly,
    });

    // The flag was flipped server-side (fire-and-forget); allow the microtask to
    // land, then assert the setter POST fired exactly once.
    await new Promise((r) => setTimeout(r, 20));
    const setterCalls = requests.filter(
      (r) => r.method === "POST" && r.path === "/1.6/users/arty_intro_shown"
    );
    expect(setterCalls).toHaveLength(1);
  });

  it("surfaces at most once under CONCURRENT first tool calls (product#3829 review)", async () => {
    // Two tool calls that complete simultaneously at session start. Only ONE
    // /me script and ONE setter script are provided: the fixed code installs a
    // single shared /me-read promise both callers await, so exactly one /me read
    // happens and exactly one caller attaches. The old code raced — both callers
    // read /me (the second would even miss the single script) and both attached.
    const { requests } = mockHttp([meScript(false), introSetterScript]);
    const { mcpClient } = await connect("u.test-token");

    const [a, b] = await Promise.all([
      mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} }),
      mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} }),
    ]);

    const withIntro = [a, b].filter(
      (r) => (r.structuredContent as any)._meta?.intro !== undefined
    );
    expect(withIntro).toHaveLength(1);
    expect((withIntro[0].structuredContent as any)._meta.intro).toMatchObject({
      name: ARTY_INTRO.name,
      calendly: ARTY_INTRO.calendly,
    });

    // Exactly one /me read (shared promise) and one setter POST — no racing.
    await new Promise((r) => setTimeout(r, 20));
    expect(requests.filter((r) => r.path === "/1.6/users/me")).toHaveLength(1);
    expect(
      requests.filter((r) => r.path === "/1.6/users/arty_intro_shown")
    ).toHaveLength(1);
  });

  it("does NOT re-attach on subsequent calls in the same session", async () => {
    mockHttp([meScript(false), introSetterScript]);
    const { mcpClient } = await connect("u.test-token");

    const first = await mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });
    expect((first.structuredContent as any)._meta?.intro).toBeDefined();

    const second = await mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });
    expect((second.structuredContent as any)._meta?.intro).toBeUndefined();
  });

  it("does NOT attach when arty_intro_shown is true (already introduced)", async () => {
    const { requests } = mockHttp([meScript(true)]);
    const { mcpClient } = await connect("u.test-token");

    const result = await mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });
    expect((result.structuredContent as any)._meta?.intro).toBeUndefined();

    // No setter POST when nothing was surfaced.
    expect(
      requests.some((r) => r.path === "/1.6/users/arty_intro_shown")
    ).toBe(false);
  });

  it("does NOT attach when the field is absent (backend not yet deployed)", async () => {
    mockHttp([meScript(undefined)]);
    const { mcpClient } = await connect("u.test-token");

    const result = await mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });
    expect((result.structuredContent as any)._meta?.intro).toBeUndefined();
  });

  it("does NOT consume the intro when the first tool call errors", async () => {
    mockHttp([meScript(false), introSetterScript]);
    const { mcpClient } = await connect("u.test-token");

    const errored = await mcpClient.callTool({ name: "leadbay_error_test", arguments: {} });
    expect(errored.isError).toBe(true);

    // The next successful tool result must still carry the intro.
    const ok = await mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });
    expect((ok.structuredContent as any)._meta?.intro).toMatchObject({
      name: ARTY_INTRO.name,
      calendly: ARTY_INTRO.calendly,
    });
  });

  it("skips entirely (no /users/me roundtrip) when unauthenticated", async () => {
    const { requests } = mockHttp([]);
    const { mcpClient } = await connect(null);

    const result = await mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });
    expect((result.structuredContent as any).pong).toBe(true);
    expect((result.structuredContent as any)._meta?.intro).toBeUndefined();
    // client.isAuthenticated short-circuits before resolveMe — /me never hit.
    expect(requests.some((r) => r.path === "/1.6/users/me")).toBe(false);
  });

  it("does not surface (and does not burn the gate) when /users/me fails", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 500, body: { code: "SERVER_ERROR" } },
      // Gate not burned → a later call re-reads /me; this time it succeeds and surfaces.
      meScript(false),
      introSetterScript,
    ]);
    const { mcpClient } = await connect("u.test-token");

    const first = await mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });
    expect(first.isError).toBeFalsy();
    expect((first.structuredContent as any)._meta?.intro).toBeUndefined();

    const second = await mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });
    expect((second.structuredContent as any)._meta?.intro).toMatchObject({
      name: ARTY_INTRO.name,
    });
  });
});
