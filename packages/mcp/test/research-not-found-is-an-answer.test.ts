/**
 * leadbay/product#4145 — "do we have this company?" answered "no" is a
 * correct answer, not a failure.
 *
 * Milan's live run on 2026-09-16 asked for `Menuiserie Vercellone et Fils
 * Chambéry`, got an MCP error, followed the error's own advice and re-called
 * with `website`, and got a second one. One user question, two recorded
 * failures, nothing broken. In the 30 days to that date 677 of this tool's
 * 806 recorded failures were this shape.
 *
 * These drive the JSON-RPC surface the customer's agent actually sees, so the
 * assertion is on `isError` and on what telemetry recorded — not on the
 * resolved value of a function call.
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
const TOOL = "leadbay_research_lead_by_name_fuzzy";
const NAME = "Menuiserie Vercellone et Fils Chambéry";
const DOMAIN = "vercellone-menuiserie-chambery.fr";
const SUGGEST = `/1.6/search/suggest?q=${encodeURIComponent(NAME)}`;

function spyTelemetry() {
  return {
    ...NOOP_TELEMETRY,
    captureToolCall: vi.fn(),
    captureCompositeCall: vi.fn(),
    captureException: vi.fn(),
  } as unknown as TelemetryHandle & {
    captureToolCall: ReturnType<typeof vi.fn>;
    captureCompositeCall: ReturnType<typeof vi.fn>;
    captureException: ReturnType<typeof vi.fn>;
  };
}

async function connect(telemetry: TelemetryHandle) {
  const server = buildServer(new LeadbayClient(BASE, "u.test-token"), {
    telemetry,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return mcpClient;
}

const registryMiss = {
  method: "POST" as const,
  path: "/1.6/leads/resolve",
  status: 200,
  body: { type: "none", would_help: ["website", "registry_number"] },
};
const corpusMiss = {
  method: "GET" as const,
  path: SUGGEST,
  status: 200,
  body: [],
};

beforeEach(() => resetHttpMock());

describe("a company nobody has is an answer, not an MCP error (product#4145)", () => {
  it("the name Milan asked for comes back as a result, not isError", async () => {
    mockHttp([corpusMiss, registryMiss]);
    const telemetry = spyTelemetry();
    const mcpClient = await connect(telemetry);

    const res: any = await mcpClient.callTool({
      name: TOOL,
      arguments: { companyName: NAME, _triggered_by: `do we have ${NAME}?` },
    });

    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.resolution).toBe("not_found");
    expect(res.structuredContent.would_help).toEqual([
      "website",
      "registry_number",
    ]);
    expect(res.structuredContent.summary).toContain(NAME);
    expect(res.structuredContent.next_step).toContain("website");

    expect(telemetry.captureToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ tool: TOOL, ok: true })
    );
    expect(telemetry.captureException).not.toHaveBeenCalled();
  });

  it("the retry the hint asks for does not record a second failure", async () => {
    mockHttp([registryMiss, corpusMiss]);
    const telemetry = spyTelemetry();
    const mcpClient = await connect(telemetry);

    const res: any = await mcpClient.callTool({
      name: TOOL,
      arguments: {
        companyName: NAME,
        website: DOMAIN,
        _triggered_by: `their website is ${DOMAIN}`,
      },
    });

    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.resolution).toBe("not_found");
    expect(res.structuredContent.summary).toContain(DOMAIN);
    expect(telemetry.captureToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ tool: TOOL, ok: true })
    );
    expect(telemetry.captureToolCall).not.toHaveBeenCalledWith(
      expect.objectContaining({ ok: false })
    );
    expect(telemetry.captureException).not.toHaveBeenCalled();
  });

  it("a search route that is down still raises — that one really is broken", async () => {
    const down = Object.assign(new Error("dns"), { code: "ENOTFOUND" });
    mockHttp([
      registryMiss,
      { method: "GET", path: SUGGEST, status: 0, error: down },
    ]);
    const telemetry = spyTelemetry();
    const mcpClient = await connect(telemetry);

    const res: any = await mcpClient.callTool({
      name: TOOL,
      arguments: {
        companyName: NAME,
        website: DOMAIN,
        _triggered_by: `do we have ${NAME}?`,
      },
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("could NOT be searched");
    expect(res.content[0].text).toContain("Retry once");
    expect(telemetry.captureToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error_code: "LEAD_NOT_FOUND" })
    );
  });
});
