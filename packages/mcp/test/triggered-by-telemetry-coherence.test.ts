/**
 * `_triggered_by` is a PROTOCOL requirement, not a telemetry-conditional one.
 * Follow-up to leadbay/product#3718 (Milan's review on PR #92).
 *
 * Resolution of the original "telemetry-off contradiction": the field stays
 * MANDATORY + non-empty on every composite call regardless of the telemetry
 * setting. It is an auditable intent trace; when telemetry is off the captured
 * value simply never leaves the process (capture is a no-op via NOOP_TELEMETRY).
 * So there is no contradiction — the requirement is not framed as analytics.
 *
 * In every mode the missing field is reported to the agent (LAST_PROMPT_REQUIRED,
 * isError) but NOT to Sentry (no captureException) — that is the original
 * #3718 fix, still intact.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer, buildServerInstructions } from "../src/server.js";
import { NOOP_TELEMETRY, type TelemetryHandle } from "../src/telemetry.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";
const COMPOSITE_TOOL = "leadbay_account_status";

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
  const server = buildServer(lbClient, { telemetry });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return { mcpClient };
}

beforeEach(() => resetHttpMock());

describe("_triggered_by is a protocol requirement (leadbay/product#3718 review)", () => {
  it("composite without _triggered_by is rejected (LAST_PROMPT_REQUIRED), NOT to Sentry", async () => {
    mockHttp([]);
    const telemetry = spyTelemetry();
    const { mcpClient } = await connect(telemetry);

    const res: any = await mcpClient.callTool({
      name: COMPOSITE_TOOL,
      arguments: {},
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("_triggered_by");
    // The #3718 fix: recoverable, never a Sentry exception.
    expect(telemetry.captureException).not.toHaveBeenCalled();
    expect(telemetry.captureToolCall.mock.calls[0][0]).toMatchObject({
      tool: COMPOSITE_TOOL,
      ok: false,
      error_code: "LAST_PROMPT_REQUIRED",
    });
  });

  it("composite schema marks _triggered_by required", async () => {
    const telemetry = spyTelemetry();
    const { mcpClient } = await connect(telemetry);

    const listed = await mcpClient.listTools();
    const tool = listed.tools.find((t) => t.name === COMPOSITE_TOOL)!;
    const required = (tool.inputSchema as any)?.required ?? [];
    expect(required).toContain("_triggered_by");
  });

  it("the schema description does NOT instruct a magic-string sentinel", async () => {
    const telemetry = spyTelemetry();
    const { mcpClient } = await connect(telemetry);

    const listed = await mcpClient.listTools();
    const tool = listed.tools.find((t) => t.name === COMPOSITE_TOOL)!;
    const desc = (tool.inputSchema as any)?.properties?._triggered_by?.description ?? "";
    // Milan: absent value should be a real trace, not the "<no user message>"
    // antipattern.
    expect(desc).not.toContain("<no user message>");
    expect(desc).toContain("actual instruction you are acting on");
  });

  it("the server prompt always carries the _triggered_by mandate", () => {
    const exposed = new Set([COMPOSITE_TOOL, "leadbay_pull_leads"]);
    const prompt = buildServerInstructions(exposed);
    expect(prompt).toContain("Trigger provenance");
    expect(prompt).toContain("_triggered_by");
    expect(prompt).not.toContain("<no user message>");
  });
});
