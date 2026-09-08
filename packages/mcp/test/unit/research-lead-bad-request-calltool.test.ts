/**
 * product#4085 — the incident call, end to end through `tools/call`.
 *
 * `leadbay_research_lead_by_id` with an 8-character lead id. Production answers
 * the lens-scoped profile GET with `400 {"error":{"code":"bad_request",
 * "message":"bad 'leadId' parameter"}}`. Before: the agent read
 * "bad 'leadId' parameter. Try again or check the Leadbay API status" and
 * retried twenty times; telemetry filed it as API_ERROR/400. After: the text
 * names the parameter and says the call fails the same way on retry, and the
 * `mcp tool called` event carries BAD_INPUT with http_status 400 so the
 * dashboard can tell an argument error from a Leadbay fault.
 *
 * Drives `buildServer`, the handler both the stdio and hosted transports build.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../../src/server.js";
import { NOOP_TELEMETRY, type TelemetryHandle } from "../../src/telemetry.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-fr.leadbay.app";
const LENS = 48110;
const SHORT_ID = "5585c198";
const BAD_LEAD_ID = { error: { code: "bad_request", message: "bad 'leadId' parameter" } };

function spyTelemetry(): TelemetryHandle & {
  captureToolCall: ReturnType<typeof vi.fn>;
  captureCompositeCall: ReturnType<typeof vi.fn>;
  captureException: ReturnType<typeof vi.fn>;
} {
  return {
    ...NOOP_TELEMETRY,
    captureToolCall: vi.fn(),
    captureCompositeCall: vi.fn(),
    captureException: vi.fn(),
  } as any;
}

async function connect(telemetry: TelemetryHandle) {
  const lbClient = new LeadbayClient(BASE, "u.test-token", "fr");
  const server = buildServer(lbClient, { telemetry });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
  return { mcpClient };
}

const textOf = (res: any): string => res.content?.[0]?.text ?? "";

function mockIncident() {
  return mockHttp([
    { method: "POST", path: "/1.6/interactions", status: 400, body: BAD_LEAD_ID },
    { method: "GET", path: `/1.6/lenses/${LENS}/leads/${SHORT_ID}`, status: 400, body: BAD_LEAD_ID },
    { method: "GET", path: new RegExp(`^/1\\.6/leads/${SHORT_ID}/`), status: 400, body: BAD_LEAD_ID },
    { method: "GET", path: new RegExp(`^/1\\.6/leads/${SHORT_ID}/`), status: 400, body: BAD_LEAD_ID },
    { method: "GET", path: new RegExp(`^/1\\.6/leads/${SHORT_ID}/`), status: 400, body: BAD_LEAD_ID },
    { method: "GET", path: new RegExp(`^/1\\.6/leads/${SHORT_ID}/`), status: 400, body: BAD_LEAD_ID },
    { method: "GET", path: new RegExp(`^/1\\.6/leads/${SHORT_ID}/`), status: 400, body: BAD_LEAD_ID },
  ]);
}

beforeEach(() => resetHttpMock());

describe("leadbay_research_lead_by_id with an 8-character id, through tools/call (product#4085)", () => {
  it("the agent reads the parameter name and a no-retry instruction, not 'Try again'", async () => {
    mockIncident();
    const { mcpClient } = await connect(spyTelemetry());

    const res: any = await mcpClient.callTool({
      name: "leadbay_research_lead_by_id",
      arguments: {
        _triggered_by: "Re-poll enrichment après délai asynchrone, étape 9",
        leadId: SHORT_ID,
        lensId: LENS,
      },
    });

    expect(res.isError).toBe(true);
    const text = textOf(res);
    expect(text).toContain("bad 'leadId' parameter");
    expect(text).toContain("will fail the same way");
    expect(text).toContain(`endpoint=/lenses/${LENS}/leads/${SHORT_ID}`);
    expect(text).not.toContain("Try again or check the Leadbay API status");
  });

  it("telemetry files it as BAD_INPUT with http_status 400, not API_ERROR", async () => {
    mockIncident();
    const telemetry = spyTelemetry();
    const { mcpClient } = await connect(telemetry);

    await mcpClient.callTool({
      name: "leadbay_research_lead_by_id",
      arguments: { _triggered_by: "étape 9", leadId: SHORT_ID, lensId: LENS },
    });

    expect(telemetry.captureToolCall).toHaveBeenCalledTimes(1);
    expect(telemetry.captureToolCall.mock.calls[0][0]).toMatchObject({
      tool: "leadbay_research_lead_by_id",
      ok: false,
      error_code: "BAD_INPUT",
      http_status: 400,
    });
    // Sentry business capture keeps the backend message and the endpoint —
    // the two fields that proved the incident.
    expect(telemetry.captureException).toHaveBeenCalledTimes(1);
    expect(telemetry.captureException.mock.calls[0][1]).toMatchObject({
      code: "BAD_INPUT",
      message: "bad 'leadId' parameter",
      endpoint: `/lenses/${LENS}/leads/${SHORT_ID}`,
      http_status: 400,
    });
  });

  it("the rejected profile GET goes out exactly once", async () => {
    const { requests } = mockIncident();
    const { mcpClient } = await connect(spyTelemetry());
    await mcpClient.callTool({
      name: "leadbay_research_lead_by_id",
      arguments: { _triggered_by: "étape 9", leadId: SHORT_ID, lensId: LENS },
    });
    expect(
      requests.filter((r) => r.method === "GET" && r.path === `/1.6/lenses/${LENS}/leads/${SHORT_ID}`)
    ).toHaveLength(1);
  });
});
