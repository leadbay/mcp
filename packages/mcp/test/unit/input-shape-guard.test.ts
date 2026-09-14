/**
 * Regression test for leadbay/product#4079.
 *
 * The CallTool handler never checked `inputSchema`, so an array-typed argument
 * sent as a string reached `execute` raw and threw a TypeError that named no
 * argument (`(params.lead_ids ?? []).filter is not a function`, five retries in
 * 29s on the hosted route; `texts.filter is not a function` out of
 * leadbay_new_lens on 2026-08-04). The dispatcher now answers a wrong-shaped
 * array/object argument with the same BAD_INPUT envelope a tool returns
 * itself, before execute, and never coerces a string into an array.
 *
 * Drives `tools/call` through `buildServer`, the handler both the stdio and
 * hosted transports build.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../../src/server.js";
import { NOOP_TELEMETRY, type TelemetryHandle } from "../../src/telemetry.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";
const LEAD = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

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
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  // All three tools under test live in compositeWriteTools.
  const server = buildServer(lbClient, { telemetry, includeWrite: true });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return { mcpClient };
}

const textOf = (res: any): string => res.content?.[0]?.text ?? "";

beforeEach(() => resetHttpMock());

describe("input shape guard (leadbay/product#4079)", () => {
  it("a. lead_ids as a bare string → BAD_INPUT naming the field, no HTTP, no throw", async () => {
    const { requests } = mockHttp([]);
    const telemetry = spyTelemetry();
    const { mcpClient } = await connect(telemetry);

    const res: any = await mcpClient.callTool({
      name: "leadbay_set_lead_status",
      arguments: { lead_ids: LEAD, status: "WANTED" },
    });

    expect(res.isError).toBe(true);
    const text = textOf(res);
    expect(text).toContain("lead_ids must be a JSON array (got string)");
    expect(text).toContain("Do not JSON-stringify");
    expect(text).not.toContain("is not a function");
    expect(requests).toHaveLength(0);

    // Same telemetry as a tool-returned BAD_INPUT: PostHog ok:false, Sentry
    // business capture (contrast with LAST_PROMPT_REQUIRED, which skips Sentry).
    expect(telemetry.captureToolCall).toHaveBeenCalledTimes(1);
    expect(telemetry.captureToolCall.mock.calls[0][0]).toMatchObject({
      tool: "leadbay_set_lead_status",
      ok: false,
      error_code: "BAD_INPUT",
    });
    expect(telemetry.captureCompositeCall).not.toHaveBeenCalled();
    expect(telemetry.captureException).toHaveBeenCalledTimes(1);
    expect(telemetry.captureException.mock.calls[0][1]).toMatchObject({
      tool: "leadbay_set_lead_status",
      source: "business",
    });
  });

  it("b. lead_ids as an array → guard is silent, execute runs, status is written", async () => {
    const { requests } = mockHttp([
      { method: "POST", path: `/1.6/leads/${LEAD}/set_status`, status: 200, body: {} },
    ]);
    const telemetry = spyTelemetry();
    const { mcpClient } = await connect(telemetry);

    const res: any = await mcpClient.callTool({
      name: "leadbay_set_lead_status",
      arguments: { lead_ids: [LEAD], status: "WANTED" },
    });

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(textOf(res));
    expect(parsed).toMatchObject({ applied: true, count: 1, status: "WANTED", failed: [] });
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toContain('"status":"WANTED"');
    expect(telemetry.captureToolCall.mock.calls[0][0]).toMatchObject({ ok: true });
  });

  it("c. lead_ids: null counts as absent → the tool's own empty-input envelope", async () => {
    const { requests } = mockHttp([]);
    const telemetry = spyTelemetry();
    const { mcpClient } = await connect(telemetry);

    const res: any = await mcpClient.callTool({
      name: "leadbay_set_lead_status",
      arguments: { lead_ids: null, status: "WANTED" },
    });

    expect(res.isError).toBe(true);
    const text = textOf(res);
    expect(text).toContain("lead_ids is empty");
    expect(text).not.toContain("must be a JSON array");
    expect(requests).toHaveLength(0);
    expect(telemetry.captureToolCall.mock.calls[0][0]).toMatchObject({ error_code: "BAD_INPUT" });
  });

  it("d. a JSON-stringified array is NOT coerced — rejected like a bare string", async () => {
    const { requests } = mockHttp([]);
    const telemetry = spyTelemetry();
    const { mcpClient } = await connect(telemetry);

    const res: any = await mcpClient.callTool({
      name: "leadbay_set_lead_status",
      arguments: { lead_ids: JSON.stringify([LEAD]), status: "WANTED" },
    });

    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("lead_ids must be a JSON array (got string)");
    expect(requests).toHaveLength(0);
  });

  it("e. an object-typed param given a string or an array → BAD_INPUT naming it", async () => {
    const { requests } = mockHttp([]);
    const telemetry = spyTelemetry();
    const { mcpClient } = await connect(telemetry);

    const asString: any = await mcpClient.callTool({
      name: "leadbay_report_outreach",
      arguments: {
        _triggered_by: "log that I emailed Acme",
        lead_id: LEAD,
        note: "Sent intro email",
        verification: "user_confirmed",
      },
    });
    expect(asString.isError).toBe(true);
    expect(textOf(asString)).toContain("verification must be a JSON object (got string)");
    // The guard pre-empted execute: the tool's own verification error is absent.
    expect(textOf(asString)).not.toContain("VERIFICATION_REQUIRED");

    const asArray: any = await mcpClient.callTool({
      name: "leadbay_report_outreach",
      arguments: {
        _triggered_by: "log that I emailed Acme",
        lead_id: LEAD,
        note: "Sent intro email",
        verification: ["user_confirmed"],
      },
    });
    expect(asArray.isError).toBe(true);
    expect(textOf(asArray)).toContain("verification must be a JSON object (got array)");

    expect(requests).toHaveLength(0);
    // Composite: both PostHog events fire per call.
    expect(telemetry.captureToolCall).toHaveBeenCalledTimes(2);
    expect(telemetry.captureCompositeCall).toHaveBeenCalledTimes(2);
    expect(telemetry.captureCompositeCall.mock.calls[0][0]).toMatchObject({
      tool: "leadbay_report_outreach",
      ok: false,
      error_code: "BAD_INPUT",
    });
  });

  it("f. the 2026-08-04 case: new_lens locations as a string → BAD_INPUT, no throw", async () => {
    const { requests } = mockHttp([]);
    const telemetry = spyTelemetry();
    const { mcpClient } = await connect(telemetry);

    const res: any = await mcpClient.callTool({
      name: "leadbay_new_lens",
      arguments: { _triggered_by: "create a Paris lens", name: "Paris", locations: "Paris" },
    });

    expect(res.isError).toBe(true);
    const text = textOf(res);
    expect(text).toContain("locations must be a JSON array");
    expect(text).not.toContain("is not a function");
    expect(requests).toHaveLength(0);
    expect(telemetry.captureCompositeCall.mock.calls[0][0]).toMatchObject({
      tool: "leadbay_new_lens",
      ok: false,
      error_code: "BAD_INPUT",
    });
  });

  it("g. ordering: a composite with a bad shape AND no _triggered_by hears the mandate first", async () => {
    mockHttp([]);
    const telemetry = spyTelemetry();
    const { mcpClient } = await connect(telemetry);

    const res: any = await mcpClient.callTool({
      name: "leadbay_new_lens",
      arguments: { name: "Paris", locations: "Paris" },
    });

    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("_triggered_by");
    expect(textOf(res)).not.toContain("must be a JSON array");
    expect(telemetry.captureToolCall.mock.calls[0][0]).toMatchObject({
      error_code: "LAST_PROMPT_REQUIRED",
    });
  });
});
