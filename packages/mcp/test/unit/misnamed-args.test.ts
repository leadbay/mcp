/**
 * Regression test for leadbay/product#4237.
 *
 * julien@lelab0.com's scheduled run on 2026-09-29 (hosted MCP 0.42.0, FR):
 * 10 × leadbay_research_lead_by_id INVALID_PARAMS (265 bytes, 0 ms),
 * 3 × leadbay_add_note INVALID_PARAMS (70 bytes, 0 ms; no note written that
 * night), 3 × leadbay_set_lead_status BAD_INPUT "lead_ids is empty" (47 bytes).
 * The SDK never enforced `additionalProperties: false`, so a misnamed key was
 * dropped and the tool answered "leadId is required", "Note cannot be empty"
 * or "lead_ids is empty", none of which names the key the agent sent.
 *
 * Now, before execute: a key that differs only by case or underscores is
 * renamed (`lead_id` → `leadId`), a singular id becomes the declared plural
 * array (`lead_id` → `lead_ids: [id]`), and any other undeclared key is
 * rejected with INVALID_PARAMS naming it and the accepted keys.
 *
 * Drives `tools/call` through `buildServer`, the handler both the stdio and
 * hosted transports build.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient, type Tool } from "@leadbay/core";
import { buildServer } from "../../src/server.js";
import { NOOP_TELEMETRY, type TelemetryHandle } from "../../src/telemetry.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-fr.leadbay.app";
const LENS = 48110;
const LEAD = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const LEAD2 = "9b2e1c7a-0d4f-4a8e-b6c1-7f3e2d1a0b9c";
const TRIGGER = "Lab0_Sourcing_Manual_Work_8_40";

function spyTelemetry() {
  return {
    ...NOOP_TELEMETRY,
    captureToolCall: vi.fn(),
    captureCompositeCall: vi.fn(),
    captureException: vi.fn(),
  } as TelemetryHandle & { captureToolCall: ReturnType<typeof vi.fn> };
}

// Records the args execute() receives; one with a closed schema, one open.
const seen: Array<Record<string, unknown>> = [];
const probe = (name: string, closed: boolean): Tool =>
  ({
    name,
    description: name,
    inputSchema: {
      type: "object",
      properties: { lead_ids: { type: "array", items: { type: "string" } }, limit: { type: "number" } },
      ...(closed ? { additionalProperties: false } : {}),
    },
    execute: async (_c: unknown, params: Record<string, unknown>) => {
      seen.push(params);
      return { ok: true };
    },
  }) as unknown as Tool;

async function connect(telemetry: TelemetryHandle = spyTelemetry()) {
  const lbClient = new LeadbayClient(BASE, "u.test-token", "fr");
  const server = buildServer(lbClient, {
    telemetry,
    includeWrite: true,
    extraTools: [probe("leadbay_test_closed", true), probe("leadbay_test_open", false)],
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
  return mcpClient;
}

const textOf = (res: any): string => res.content?.[0]?.text ?? "";

function mockResearch(lead: string) {
  return mockHttp([
    { method: "POST", path: "/1.6/interactions", status: 204 },
    {
      method: "GET",
      path: `/1.6/lenses/${LENS}/leads/${lead}`,
      status: 200,
      body: { id: lead, name: "KYF ELEC", score: 72, location: { city: "Toulon" } },
    },
    { method: "GET", path: `/1.6/leads/${lead}/ai_agent_responses`, status: 200, body: [] },
    { method: "GET", path: new RegExp(`^/1\\.6/leads/${lead}/enrich/contacts`), status: 200, body: [] },
    { method: "GET", path: `/1.6/leads/${lead}/web_fetch`, status: 200, body: {} },
    { method: "GET", path: new RegExp(`^/1\\.6/leads/${lead}/activities`), status: 200, body: { items: [], pagination: {} } },
    { method: "GET", path: new RegExp(`^/1\\.6/leads/${lead}/contacts`), status: 200, body: [] },
  ]);
}

beforeEach(() => {
  resetHttpMock();
  seen.length = 0;
});

describe("misnamed arguments (product#4237)", () => {
  it("research_lead_by_id with `lead_id` researches the lead instead of 'leadId is required'", async () => {
    const { requests } = mockResearch(LEAD);
    const mcp = await connect();
    const res: any = await mcp.callTool({
      name: "leadbay_research_lead_by_id",
      arguments: { _triggered_by: TRIGGER, lead_id: LEAD, lensId: LENS },
    });
    expect(textOf(res)).not.toContain("leadId is required");
    expect(res.isError).toBeFalsy();
    expect(requests.map((r) => r.path)).toContain(`/1.6/lenses/${LENS}/leads/${LEAD}`);
  });

  it("add_note with `lead_id` writes the note on that lead", async () => {
    const { requests } = mockHttp([
      {
        method: "POST",
        path: `/1.6/leads/${LEAD}/notes`,
        status: 200,
        body: { id: "n1", note: "Électricien, 12 salariés", created_at: "2026-09-30T06:07:01Z" },
      },
    ]);
    const mcp = await connect();
    const res: any = await mcp.callTool({
      name: "leadbay_add_note",
      arguments: { lead_id: LEAD, note: "Électricien, 12 salariés" },
    });
    expect(res.isError).toBeFalsy();
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toContain("Électricien, 12 salariés");
  });

  it("add_note with the text under another key names that key and `note`, and writes nothing", async () => {
    const { requests } = mockHttp([]);
    const telemetry = spyTelemetry();
    const mcp = await connect(telemetry);
    const res: any = await mcp.callTool({
      name: "leadbay_add_note",
      arguments: { leadId: LEAD, text: "Électricien, 12 salariés" },
    });
    expect(res.isError).toBe(true);
    const text = textOf(res);
    expect(text).toContain("leadbay_add_note has no argument `text` (did you mean `note`?)");
    expect(text).toContain("Accepted arguments: `leadId`, `note`");
    expect(text).toContain("Nothing was written");
    expect(text).not.toContain("Note cannot be empty");
    expect(requests).toHaveLength(0);
    // Key names, never values, on the failed call's event.
    expect(telemetry.captureToolCall.mock.calls[0][0]).toMatchObject({
      tool: "leadbay_add_note",
      ok: false,
      error_code: "INVALID_PARAMS",
      arg_keys: ["leadId", "text"],
    });
    expect(JSON.stringify(telemetry.captureToolCall.mock.calls[0][0])).not.toContain("Électricien");
  });

  it("set_lead_status accepts one `lead_id`, one `leadId`, or `leadIds`", async () => {
    for (const args of [{ lead_id: LEAD }, { leadId: LEAD }, { leadIds: [LEAD, LEAD2] }]) {
      resetHttpMock();
      const ids = "leadIds" in args ? [LEAD, LEAD2] : [LEAD];
      const { requests } = mockHttp(
        ids.map((id) => ({ method: "POST", path: `/1.6/leads/${id}/set_status`, status: 200, body: {} }))
      );
      const mcp = await connect();
      const res: any = await mcp.callTool({
        name: "leadbay_set_lead_status",
        arguments: { ...args, status: "WANTED" },
      });
      expect(textOf(res)).not.toContain("lead_ids is empty");
      expect(JSON.parse(textOf(res))).toMatchObject({ applied: true, count: ids.length, failed: [] });
      expect(requests.map((r) => r.path)).toEqual(ids.map((id) => `/1.6/leads/${id}/set_status`));
    }
  });

  it("a JSON-stringified array under `lead_id` is not wrapped into one bogus id", async () => {
    const { requests } = mockHttp([]);
    const mcp = await connect();
    const res: any = await mcp.callTool({
      name: "leadbay_set_lead_status",
      arguments: { lead_id: JSON.stringify([LEAD]), status: "WANTED" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("lead_ids must be a JSON array (got string)");
    expect(requests).toHaveLength(0);
  });

  it("the same key sent twice under two spellings is rejected, not silently merged", async () => {
    mockHttp([]);
    const mcp = await connect();
    const res: any = await mcp.callTool({
      name: "leadbay_add_note",
      arguments: { leadId: LEAD, lead_id: LEAD2, note: "x" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("has no argument `lead_id` (did you mean `leadId`?)");
  });

  it("a closed schema rejects an unknown key; an open schema still passes it through", async () => {
    const mcp = await connect();
    const closed: any = await mcp.callTool({
      name: "leadbay_test_closed",
      arguments: { lead_ids: [LEAD], colour: "red" },
    });
    expect(closed.isError).toBe(true);
    expect(textOf(closed)).toContain("has no argument `colour`");
    expect(seen).toHaveLength(0);

    const open: any = await mcp.callTool({
      name: "leadbay_test_open",
      arguments: { lead_ids: [LEAD], colour: "red" },
    });
    expect(open.isError).toBeFalsy();
    expect(seen).toEqual([{ lead_ids: [LEAD], colour: "red" }]);
  });
});
