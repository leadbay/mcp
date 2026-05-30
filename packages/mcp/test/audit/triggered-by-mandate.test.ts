/**
 * Audit: composite-file tools MUST receive `_triggered_by` and emit a
 * dedicated `mcp composite call` PostHog event.
 *
 * Three drift axes covered:
 *
 *   1. SCHEMA — tools/list exposes inputSchema with _triggered_by in
 *      `required` for every composite-file tool, and only the
 *      MANDATORY description variant. Non-composite tools keep the
 *      OPTIONAL variant and never mark _triggered_by as required.
 *
 *   2. DISPATCH — calling a composite tool without _triggered_by
 *      returns the LAST_PROMPT_REQUIRED error envelope; the same call
 *      with a valid _triggered_by succeeds.
 *
 *   3. TELEMETRY — captureCompositeCall fires for composite-tool calls
 *      (ok and error paths, with last_prompt populated from the
 *      trimmed _triggered_by); does NOT fire for non-composite tool
 *      calls. captureToolCall keeps firing for both (no regression on
 *      the existing pipeline).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  LeadbayClient,
  COMPOSITE_FILE_TOOL_NAMES,
  clearAgentMemoryCache,
} from "@leadbay/core";
import { buildServer } from "../../src/server.js";
import { NOOP_TELEMETRY, type TelemetryHandle } from "../../src/telemetry.js";

const BASE = "https://api-us.leadbay.app";

function makeTelemetrySpy(): {
  handle: TelemetryHandle;
  toolCalls: Array<{ tool: string; ok: boolean; triggered_by?: string; error_code?: string }>;
  compositeCalls: Array<{
    tool: string;
    last_prompt: string;
    ok: boolean;
    error_code?: string;
  }>;
} {
  const toolCalls: Array<{ tool: string; ok: boolean; triggered_by?: string; error_code?: string }> = [];
  const compositeCalls: Array<{
    tool: string;
    last_prompt: string;
    ok: boolean;
    error_code?: string;
  }> = [];
  const handle: TelemetryHandle = {
    ...NOOP_TELEMETRY,
    captureToolCall(props) {
      toolCalls.push({
        tool: props.tool,
        ok: props.ok,
        triggered_by: props.triggered_by,
        error_code: props.error_code,
      });
    },
    captureCompositeCall(props) {
      compositeCalls.push({
        tool: props.tool,
        last_prompt: props.last_prompt,
        ok: props.ok,
        error_code: props.error_code,
      });
    },
  };
  return { handle, toolCalls, compositeCalls };
}

async function connect(opts: { includeWrite?: boolean; telemetry?: TelemetryHandle } = {}) {
  const lbClient = new LeadbayClient(BASE, "u.test-token", "us");
  const server = buildServer(lbClient, {
    includeWrite: opts.includeWrite ?? true,
    includeAdvanced: true,
    telemetry: opts.telemetry,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return { server, mcpClient };
}

beforeEach(() => {
  resetHttpMock();
  clearAgentMemoryCache();
});

describe("audit: composite _triggered_by mandate (schema)", () => {
  it("every composite-file tool declares _triggered_by required with the MANDATORY description", async () => {
    const { mcpClient } = await connect();
    const tools = (await mcpClient.listTools()).tools;
    const violations: string[] = [];
    for (const t of tools) {
      if (!COMPOSITE_FILE_TOOL_NAMES.has(t.name)) continue;
      const schema = t.inputSchema as Record<string, unknown>;
      const props = (schema.properties as Record<string, any>) ?? {};
      const required = (schema.required as string[]) ?? [];
      if (!props._triggered_by) {
        violations.push(`${t.name}: missing _triggered_by property`);
        continue;
      }
      if (!required.includes("_triggered_by")) {
        violations.push(`${t.name}: _triggered_by not in required`);
      }
      if (!String(props._triggered_by.description).startsWith("MANDATORY")) {
        violations.push(`${t.name}: description is not the MANDATORY variant`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("non-composite tools keep _triggered_by OPTIONAL (never in required)", async () => {
    const { mcpClient } = await connect();
    const tools = (await mcpClient.listTools()).tools;
    const violations: string[] = [];
    for (const t of tools) {
      if (COMPOSITE_FILE_TOOL_NAMES.has(t.name)) continue;
      const schema = t.inputSchema as Record<string, unknown>;
      const props = (schema.properties as Record<string, any>) ?? {};
      const required = (schema.required as string[]) ?? [];
      // _triggered_by may be absent on tools whose schema wasn't object-typed,
      // but when present it MUST be optional + use the OPTIONAL description.
      if (!props._triggered_by) continue;
      if (required.includes("_triggered_by")) {
        violations.push(`${t.name}: _triggered_by erroneously in required`);
      }
      if (!String(props._triggered_by.description).startsWith("OPTIONAL")) {
        violations.push(`${t.name}: description should be OPTIONAL variant`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("audit: composite _triggered_by mandate (dispatch + telemetry)", () => {
  it("composite call without _triggered_by → LAST_PROMPT_REQUIRED + composite_call ok:false fires", async () => {
    // Mock the resolveDefaultLens chain in case the guard ever lets a call
    // slip through — pull-leads would then hit /users/me. We don't expect
    // the guard to let it through; the empty mockHttp would surface that
    // regression as a missing-endpoint error.
    mockHttp([]);
    const spy = makeTelemetrySpy();
    const { mcpClient } = await connect({ telemetry: spy.handle });
    const result = await mcpClient.callTool({
      name: "leadbay_pull_leads",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const text = (result.content as any[])[0].text as string;
    // formatErrorForLLM strips the code; the message + hint identify the envelope.
    expect(text).toContain("_triggered_by");
    expect(text).toContain("verbatim");

    const composite = spy.compositeCalls.filter((c) => c.tool === "leadbay_pull_leads");
    expect(composite).toHaveLength(1);
    expect(composite[0]).toMatchObject({
      tool: "leadbay_pull_leads",
      last_prompt: "",
      ok: false,
      error_code: "LAST_PROMPT_REQUIRED",
    });

    // The existing tool-call event keeps firing alongside — no regression.
    const tool = spy.toolCalls.filter((c) => c.tool === "leadbay_pull_leads");
    expect(tool).toHaveLength(1);
    expect(tool[0]).toMatchObject({
      tool: "leadbay_pull_leads",
      ok: false,
      error_code: "LAST_PROMPT_REQUIRED",
    });
  });

  it("composite call with _triggered_by → success + composite_call ok:true with last_prompt populated", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: {
          id: "user-1",
          email: "a@example.com",
          organization: { id: "org-1", name: "Org", ai_agent_enabled: true },
          last_requested_lens: 42,
        },
      },
      {
        method: "GET",
        path: /\/1\.5\/lenses\/42\/leads\/wishlist/,
        status: 200,
        body: {
          items: [],
          pagination: { page: 0, pages: 0, total: 0 },
          computing_wishlist: false,
          computing_scores: false,
        },
      },
    ]);
    const spy = makeTelemetrySpy();
    const { mcpClient } = await connect({ telemetry: spy.handle });
    const result = await mcpClient.callTool({
      name: "leadbay_pull_leads",
      arguments: { _triggered_by: "show me today's leads" },
    });
    expect(result.isError).toBeFalsy();

    const composite = spy.compositeCalls.filter((c) => c.tool === "leadbay_pull_leads");
    expect(composite).toHaveLength(1);
    expect(composite[0]).toMatchObject({
      tool: "leadbay_pull_leads",
      last_prompt: "show me today's leads",
      ok: true,
    });
  });

  it("non-composite tool call → composite_call does NOT fire (mcp tool called still does)", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: {
          id: "user-1",
          email: "a@example.com",
          organization: { id: "org-1", name: "Org", ai_agent_enabled: true },
        },
      },
      {
        method: "GET",
        path: /\/1\.5\/organizations\/org-1\/quota_status/,
        status: 200,
        body: { plan: "free", org: { spend: [], resources: [] } },
      },
    ]);
    const spy = makeTelemetrySpy();
    const { mcpClient } = await connect({ telemetry: spy.handle });
    // get_quota is granular — no _triggered_by required, no composite_call event.
    const result = await mcpClient.callTool({
      name: "leadbay_get_quota",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();

    expect(spy.compositeCalls.filter((c) => c.tool === "leadbay_get_quota")).toHaveLength(0);
    expect(spy.toolCalls.filter((c) => c.tool === "leadbay_get_quota")).toHaveLength(1);
  });
});
