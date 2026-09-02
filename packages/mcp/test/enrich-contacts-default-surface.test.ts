/**
 * product#4050 — a hosted agent could not enrich one named person.
 *
 * `leadbay_enrich_contacts` (leadId + contactId) is the only tool that
 * enriches a chosen person rather than a job title, but it sat in
 * granularWriteTools behind LEADBAY_MCP_ADVANCED=1, which hosted never sets.
 * It now registers on the default write surface. These tests drive the real
 * MCP `tools/list` / `tools/call` through buildServer — the surface hosted
 * (`http-server.ts`) and stdio (`bin.ts`) both build from — not the arrays.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";
const TOOL = "leadbay_enrich_contacts";

async function connect(opts: { includeAdvanced?: boolean; includeWrite?: boolean }) {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(lbClient, opts);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
  return { mcpClient };
}

const namedTools = (text: string): string[] =>
  Array.from(new Set(text.match(/leadbay_[a-z0-9_]+/g) ?? []));

beforeEach(() => resetHttpMock());

describe("leadbay_enrich_contacts is on the default write surface", () => {
  it("is listed with write on and advanced OFF (the hosted configuration)", async () => {
    const { mcpClient } = await connect({ includeWrite: true, includeAdvanced: false });
    const { tools } = await mcpClient.listTools();
    const t = tools.find((x) => x.name === TOOL);
    expect(t, `${TOOL} missing from the default surface`).toBeDefined();
    expect(t!.annotations?.readOnlyHint).toBe(false);
    expect(t!.annotations?.destructiveHint).toBe(true);
    // Granular-shaped (lives in tools/): no _triggered_by mandate.
    expect((t!.inputSchema as any).required).toEqual(["leadId", "contactId"]);
  });

  it("is hidden on a read-only deployment (LEADBAY_MCP_WRITE=0)", async () => {
    const { mcpClient } = await connect({ includeWrite: false, includeAdvanced: false });
    const { tools } = await mcpClient.listTools();
    expect(tools.map((x) => x.name)).not.toContain(TOOL);
  });

  it("is listed exactly once when advanced is also on", async () => {
    const { mcpClient } = await connect({ includeWrite: true, includeAdvanced: true });
    const { tools } = await mcpClient.listTools();
    expect(tools.filter((x) => x.name === TOOL)).toHaveLength(1);
  });

  it("routing lands in the first 600 chars and every tool it names is on the same surface", async () => {
    const { mcpClient } = await connect({ includeWrite: true, includeAdvanced: false });
    const { tools } = await mcpClient.listTools();
    const registered = new Set(tools.map((x) => x.name));
    const desc = tools.find((x) => x.name === TOOL)!.description ?? "";
    expect(desc.slice(0, 600)).toContain("## WHEN TO USE");
    // The exact case from the issue: a paid candidate id is valid input, and
    // pinning is not how you enrich someone.
    expect(desc).toContain('source:"paid"');
    expect(desc).toContain("leadbay_pin_contact");
    // `leadbay_get_contacts` is advanced-only; the description may name it
    // only as the "where exposed" alternative. Everything else it routes to
    // must be callable from this surface.
    const missing = namedTools(desc).filter((n) => n !== TOOL && n !== "leadbay_get_contacts" && !registered.has(n));
    expect(missing, `description names tools not on the default surface: ${missing.join(", ")}`).toEqual([]);
  });

  it("a call on a paid candidate id succeeds and its hint names a default-surface read", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: { id: "u", email: "rep@acme.com", organization: { id: "org-1", billing: { ai_credits: 3 } } } },
      { method: "POST", path: /\/1\.6\/leads\/L1\/enrich\/contacts\/paid-1\/enrich\?email=true&phone=false/, status: 204 },
    ]);
    const { mcpClient } = await connect({ includeWrite: true, includeAdvanced: false });
    const { tools } = await mcpClient.listTools();
    const registered = new Set(tools.map((x) => x.name));

    const res: any = await mcpClient.callTool({
      name: TOOL,
      arguments: { leadId: "L1", contactId: "paid-1", email: true, phone: false },
    });
    expect(res.isError, JSON.stringify(res.content)).not.toBe(true);
    const body = JSON.parse(res.content[0].text);
    expect(body.triggered).toBe(true);
    expect(body.contact_id).toBe("paid-1");
    expect(body.hint).toContain("leadbay_research_lead_by_id");
    const missing = namedTools(body.hint).filter((n) => n !== "leadbay_get_contacts" && !registered.has(n));
    expect(missing, `hint names tools not on the default surface: ${missing.join(", ")}`).toEqual([]);
  });
});
