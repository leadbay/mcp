/**
 * Regression test for leadbay/product#3718.
 *
 * A composite tool called WITHOUT `_triggered_by` is a recoverable agent
 * mistake — the LLM just re-calls with the field. It must NOT be reported
 * to Sentry. Previously the guard `throw`ed an `{error:true,code:...}`
 * envelope into the shared catch, where `isLeadbayBusinessError` matched it
 * and called `captureException` — filing a Sentry exception (and, via the
 * GitHub integration, auto-opening a top-priority bug) on every dropped
 * field.
 *
 * The guard now returns the isError envelope directly: still surfaces the
 * LAST_PROMPT_REQUIRED PostHog events (so we can see the rate of agents
 * ignoring the mandate), but never captureException.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { NOOP_TELEMETRY, type TelemetryHandle } from "../src/telemetry.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

// A composite tool (in COMPOSITE_FILE_TOOL_NAMES) that is exposed by default.
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

describe("triggered_by guard (leadbay/product#3718)", () => {
  it("missing _triggered_by on a composite → isError, NOT a Sentry exception", async () => {
    // No HTTP declared: the guard must short-circuit before tool.execute,
    // so the harness must see zero outbound calls.
    mockHttp([]);
    const telemetry = spyTelemetry();
    const { mcpClient } = await connect(telemetry);

    const res: any = await mcpClient.callTool({
      name: COMPOSITE_TOOL,
      arguments: {}, // no _triggered_by
    });

    // Surfaced to the LLM as a recoverable error envelope.
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("_triggered_by");

    // The load-bearing assertion: never reported to Sentry.
    expect(telemetry.captureException).not.toHaveBeenCalled();

    // PostHog visibility preserved — both events fire with the mandate code.
    expect(telemetry.captureToolCall).toHaveBeenCalledTimes(1);
    expect(telemetry.captureToolCall.mock.calls[0][0]).toMatchObject({
      tool: COMPOSITE_TOOL,
      ok: false,
      error_code: "LAST_PROMPT_REQUIRED",
    });
    expect(telemetry.captureCompositeCall).toHaveBeenCalledTimes(1);
    expect(telemetry.captureCompositeCall.mock.calls[0][0]).toMatchObject({
      tool: COMPOSITE_TOOL,
      ok: false,
      error_code: "LAST_PROMPT_REQUIRED",
    });
  });

  it("present _triggered_by → guard does not fire, dispatch proceeds past it", async () => {
    // We don't care what account_status's real HTTP shape is here; the point
    // is purely that the LAST_PROMPT_REQUIRED guard does NOT short-circuit
    // when the field is present. Declare no HTTP so the tool's first call
    // surfaces as the harness's "undeclared endpoint" error — proving the
    // guard let dispatch through to execute (the guard returns BEFORE any
    // HTTP). The guard's own envelope text must be absent.
    const telemetry = spyTelemetry();
    const { mcpClient } = await connect(telemetry);

    const res: any = await mcpClient.callTool({
      name: COMPOSITE_TOOL,
      arguments: { _triggered_by: "what's my account status" },
    });

    const text = res.content?.[0]?.text ?? "";
    expect(text).not.toContain(
      "Every call to this composite tool must carry"
    );
    // captureToolCall always fires once per dispatched call (ok or not),
    // confirming we reached the dispatch path rather than the early guard
    // return.
    expect(telemetry.captureToolCall).toHaveBeenCalledTimes(1);
    expect(telemetry.captureToolCall.mock.calls[0][0]).toMatchObject({
      tool: COMPOSITE_TOOL,
      triggered_by: "what's my account status",
    });
  });
});
