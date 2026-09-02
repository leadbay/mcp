/**
 * buildServer({ includeCommerce: false }) — the surface served to a host whose
 * directory forbids selling digital goods AND forbids promoting the purchase
 * (the OpenAI app directory).
 *
 * Four things go away together. Dropping the tools alone was not enough: the
 * instructions, the tool descriptions and the QUOTA_EXCEEDED hint all still
 * pushed the user toward a top-up, which is the "promote upgrades" clause.
 *
 *   1. leadbay_create_topup_link / leadbay_open_billing_portal unregistered
 *   2. `{{commerce}}` blocks deleted from tool descriptions
 *   3. the QUOTA_TOPUP instruction paragraph not pushed
 *   4. the client's QUOTA_EXCEEDED hint drops its two selling sentences
 *
 * Every one is a DELETION. Nothing is reworded for ChatGPT, so the Claude
 * surface keeps selling exactly as hard as it does today — which is the other
 * half of what this file asserts, and the half most likely to rot.
 *
 * New file — does not modify server.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";
const COMMERCE_TOOLS = ["leadbay_create_topup_link", "leadbay_open_billing_portal"];

// Phrases whose only job is to move the user toward paying. None may reach a
// commerce-free agent, from any surface.
const SELLING_PHRASES = [
  "Top-ups always beat waiting",
  "top up now (I can generate the link)",
  "Offer the top-up link",
  "Stripe checkout URL",
  "top-up link",
  "wait-or-top-up offer",
  "OFFER it on every quota wall",
];

async function connect(includeCommerce?: boolean) {
  const client = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(client, {
    includeWrite: true,
    includeAdvanced: true,
    ...(includeCommerce === undefined ? {} : { includeCommerce }),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return { server, mcpClient, client };
}

const instructionsOf = (server: unknown) => (server as any)._instructions as string;

// The QUOTA_EXCEEDED envelope the client hands the agent, built the real way
// (through mapErrorResponse with a genuine 429 + Retry-After).
const quotaError = (client: LeadbayClient): any =>
  (client as any).mapErrorResponse(429, "{}", "/x", { "retry-after": "30" });

/**
 * Deletion-only check: `part` must be reachable from `whole` by removing
 * characters and nothing else. Any reworded, softened or newly written
 * character breaks the subsequence, which is exactly what must never happen.
 */
function isDeletionOf(part: string, whole: string): boolean {
  // Index by UTF-16 unit, not by code point: these descriptions carry astral
  // characters (emoji in the follow-up badges), and `for..of` would yield a
  // two-unit code point that can never equal a one-unit `part[i]`.
  let i = 0;
  for (let j = 0; j < whole.length && i < part.length; j++) {
    if (part[i] === whole[j]) i++;
  }
  return i === part.length;
}

beforeEach(() => resetHttpMock());

describe("commerce gate — the Claude surface still sells, unchanged", () => {
  it("exposes both commerce tools by default", async () => {
    mockHttp([]);
    const { mcpClient } = await connect();
    const names = new Set((await mcpClient.listTools()).tools.map((t) => t.name));
    for (const n of COMMERCE_TOOLS) expect(names).toContain(n);
  });

  it("keeps every selling phrase in the instructions and descriptions", async () => {
    mockHttp([]);
    const { server, mcpClient } = await connect();
    const corpus = [
      instructionsOf(server),
      ...(await mcpClient.listTools()).tools.map((t) => t.description ?? ""),
    ].join("\n");
    for (const phrase of SELLING_PHRASES) {
      expect(corpus, `Claude must keep: ${phrase}`).toContain(phrase);
    }
  });

  it("keeps the two selling sentences in the QUOTA_EXCEEDED hint", () => {
    const client = new LeadbayClient(BASE, "u.test-token");
    expect(client.commerce).toBe(true);
    const err: any = quotaError(client);
    expect(err.hint).toContain("OR top up AI credits");
    expect(err.hint).toContain("leadbay_create_topup_link");
    expect(err.hint).toContain("app.leadbay.ai → Billing");
  });

  it("explicit includeCommerce:true is identical to omitting it", async () => {
    mockHttp([]);
    const a = await connect();
    const b = await connect(true);
    const listA = (await a.mcpClient.listTools()).tools.map((t) => `${t.name}\n${t.description}`);
    const listB = (await b.mcpClient.listTools()).tools.map((t) => `${t.name}\n${t.description}`);
    expect(listB).toEqual(listA);
    expect(instructionsOf(b.server)).toBe(instructionsOf(a.server));
  });
});

describe("commerce gate — includeCommerce:false", () => {
  it("registers neither commerce tool, and drops nothing else", async () => {
    mockHttp([]);
    const withNames = new Set(
      (await (await connect(true)).mcpClient.listTools()).tools.map((t) => t.name)
    );
    const withoutNames = new Set(
      (await (await connect(false)).mcpClient.listTools()).tools.map((t) => t.name)
    );
    expect([...withNames].filter((n) => !withoutNames.has(n)).sort()).toEqual(
      [...COMMERCE_TOOLS].sort()
    );
    expect([...withoutNames].filter((n) => !withNames.has(n))).toEqual([]);
  });

  it("no selling phrase survives anywhere the agent reads", async () => {
    mockHttp([]);
    const { server, mcpClient } = await connect(false);
    const corpus = [
      instructionsOf(server),
      ...(await mcpClient.listTools()).tools.map((t) => `${t.name}\n${t.description ?? ""}`),
    ].join("\n");
    for (const phrase of SELLING_PHRASES) {
      expect(corpus, `must not reach ChatGPT: ${phrase}`).not.toContain(phrase);
    }
    for (const n of COMMERCE_TOOLS) expect(corpus).not.toContain(n);
  });

  it("the QUOTA_EXCEEDED hint drops its selling sentences but keeps the rest", async () => {
    mockHttp([]);
    const { client } = await connect(false);
    expect(client.commerce).toBe(false);
    const err: any = quotaError(client);
    expect(err.hint).not.toContain("top up AI credits");
    expect(err.hint).not.toContain("leadbay_create_topup_link");
    expect(err.hint).not.toContain("Billing");
    // Still tells the agent what to do.
    expect(err.hint).toContain("Wait 30s before retrying");   // retry-after preserved
    expect(err.hint).toContain("which resource window");
    expect(err.hint).toContain("RETRY the original operation");
  });

  it("deletes rather than rewords — every description is a pure deletion of Claude's", async () => {
    mockHttp([]);
    const withDescs = new Map(
      (await (await connect(true)).mcpClient.listTools()).tools.map((t) => [t.name, t.description ?? ""])
    );
    let gated = 0;
    for (const t of (await (await connect(false)).mcpClient.listTools()).tools) {
      const full = withDescs.get(t.name)!;
      const gatedDesc = t.description ?? "";
      expect(
        isDeletionOf(gatedDesc, full),
        `${t.name}: the commerce-free description is not a pure deletion of the Claude one`
      ).toBe(true);
      if (gatedDesc !== full) gated++;
    }
    // Guard the guard: if the marker stopped matching anything, the check above
    // would pass trivially on N identical strings.
    expect(gated, "expected some descriptions to actually lose a commerce block").toBeGreaterThan(0);
  });

  it("the instructions are a pure deletion of Claude's too", async () => {
    mockHttp([]);
    const full = instructionsOf((await connect(true)).server);
    const gated = instructionsOf((await connect(false)).server);
    expect(gated).not.toBe(full);
    expect(isDeletionOf(gated, full)).toBe(true);
  });

  it("keeps the guidance that is about NOT gate-keeping a user who paid elsewhere", async () => {
    mockHttp([]);
    const { server, mcpClient } = await connect(false);
    const desc =
      (await mcpClient.listTools()).tools.find((t) => t.name === "leadbay_account_status")
        ?.description ?? "";
    expect(desc).toContain("A stale quota snapshot is never a reason to gate-keep");
    // And the neutral half of the quota instruction still ships.
    expect(instructionsOf(server)).toContain("Show the refreshed quota AFTER a paid action");
  });

  it("calling a dropped tool errors — it is genuinely gone, not just hidden", async () => {
    mockHttp([]);
    const { mcpClient } = await connect(false);
    const res: any = await mcpClient.callTool({
      name: "leadbay_create_topup_link",
      arguments: {},
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Unknown Leadbay tool");
    expect(res.content[0].text).not.toContain("leadbay_open_billing_portal");
  });
});
