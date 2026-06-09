/**
 * Coherence between the `_triggered_by` mandate and the telemetry setting.
 * Follow-up to leadbay/product#3718 (Milan's review on PR #92).
 *
 * `_triggered_by` exists ONLY to feed product analytics. So its mandate is
 * telemetry-conditional:
 *   - telemetry ON  → composite calls without it are rejected
 *                     (LAST_PROMPT_REQUIRED), the schema marks it required, and
 *                     the system prompt carries the mandate paragraph.
 *   - telemetry OFF → the field is optional, the guard does not fire, and the
 *                     mandate paragraph is omitted from the prompt — requiring
 *                     an analytics-only field with no analytics consumer would
 *                     contradict the user's opt-out.
 *
 * Never, in either mode, does the missing field reach Sentry
 * (captureException) — that is the original #3718 fix.
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

async function connect(opts: {
  telemetry: TelemetryHandle;
  telemetryEnabled?: boolean;
}) {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(lbClient, {
    telemetry: opts.telemetry,
    telemetryEnabled: opts.telemetryEnabled,
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

describe("_triggered_by coherence with telemetry (leadbay/product#3718 review)", () => {
  it("telemetry OFF → composite without _triggered_by is NOT guard-blocked (dispatch proceeds)", async () => {
    // With telemetry OFF the LAST_PROMPT_REQUIRED guard must NOT short-circuit:
    // dispatch proceeds to the real tool's execute. We don't declare HTTP (so
    // execute then errors on a missing mock) — that's irrelevant here. The
    // discriminator is that NO captureToolCall recorded the guard's
    // error_code "LAST_PROMPT_REQUIRED" and the guard envelope text is absent.
    const telemetry = spyTelemetry();
    const { mcpClient } = await connect({ telemetry, telemetryEnabled: false });

    const res: any = await mcpClient.callTool({
      name: COMPOSITE_TOOL,
      arguments: {}, // no _triggered_by
    });

    const text = res.content?.[0]?.text ?? "";
    expect(text).not.toContain("Every call to this composite tool must carry");
    expect(text).not.toContain("LAST_PROMPT_REQUIRED");
    // Reached dispatch (guard skipped). When the guard fires it sets
    // error_code:"LAST_PROMPT_REQUIRED"; here the dispatched call must carry a
    // different (or no) guard code — assert no call recorded the guard code.
    const guardCalls = telemetry.captureToolCall.mock.calls.filter(
      (c) => c[0]?.error_code === "LAST_PROMPT_REQUIRED"
    );
    expect(guardCalls).toHaveLength(0);
  });

  it("telemetry OFF → composite schema does NOT mark _triggered_by required", async () => {
    const telemetry = spyTelemetry();
    const { mcpClient } = await connect({ telemetry, telemetryEnabled: false });

    const listed = await mcpClient.listTools();
    const tool = listed.tools.find((t) => t.name === COMPOSITE_TOOL)!;
    const required = (tool.inputSchema as any)?.required ?? [];
    expect(required).not.toContain("_triggered_by");
  });

  it("telemetry ON → composite without _triggered_by is rejected, NOT to Sentry", async () => {
    mockHttp([]);
    const telemetry = spyTelemetry();
    const { mcpClient } = await connect({ telemetry, telemetryEnabled: true });

    const res: any = await mcpClient.callTool({
      name: COMPOSITE_TOOL,
      arguments: {},
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("_triggered_by");
    expect(telemetry.captureException).not.toHaveBeenCalled();
    expect(telemetry.captureToolCall.mock.calls[0][0]).toMatchObject({
      tool: COMPOSITE_TOOL,
      ok: false,
      error_code: "LAST_PROMPT_REQUIRED",
    });
  });

  it("telemetry ON → composite schema marks _triggered_by required", async () => {
    const telemetry = spyTelemetry();
    const { mcpClient } = await connect({ telemetry, telemetryEnabled: true });

    const listed = await mcpClient.listTools();
    const tool = listed.tools.find((t) => t.name === COMPOSITE_TOOL)!;
    const required = (tool.inputSchema as any)?.required ?? [];
    expect(required).toContain("_triggered_by");
  });

  it("prompt carries the _triggered_by mandate only when telemetry is on", () => {
    const exposed = new Set([COMPOSITE_TOOL, "leadbay_pull_leads"]);
    const onPrompt = buildServerInstructions(exposed, true);
    const offPrompt = buildServerInstructions(exposed, false);
    expect(onPrompt).toContain("_triggered_by");
    expect(onPrompt).toContain("Trigger provenance");
    expect(offPrompt).not.toContain("Trigger provenance");
  });
});
