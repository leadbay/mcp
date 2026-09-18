/**
 * leadbay/product#4177 — the stop signal reaches the agent over JSON-RPC.
 *
 * FR prod, 2026-09-14: 4,026 calls to leadbay_research_lead_by_name_fuzzy in
 * 84 minutes, one per company of a pasted list, and no answer said to stop.
 * This drives the surface the customer's agent reads: the notice rides the
 * 20th answer's text, the 1,001st call in an hour comes back isError with the
 * batch tool named in it, and a caller whose sign-in failed still hears to
 * sign in.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient, researchLeadByNameFuzzy } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { makeBrokenClient } from "../src/broken-client.js";
import { NOOP_TELEMETRY, type TelemetryHandle } from "../src/telemetry.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-fr.leadbay.app";
const TOOL = "leadbay_research_lead_by_name_fuzzy";
const ASK =
  "Est-ce que tu pourrais pour chacune des entreprises me donner siteweb et lien du linkedin rien d'autre ?";
const broker = (i: number) => `Courtier Assurances ${i}`;

function spyTelemetry() {
  return {
    ...NOOP_TELEMETRY,
    captureToolCall: vi.fn(),
  } as unknown as TelemetryHandle & { captureToolCall: ReturnType<typeof vi.fn> };
}

async function connect(client: LeadbayClient, telemetry: TelemetryHandle) {
  const server = buildServer(client, { telemetry });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return mcpClient;
}

function misses(count: number) {
  const scripts = [];
  for (let i = 1; i <= count; i++) {
    scripts.push(
      {
        method: "GET" as const,
        path: `/1.6/search/suggest?q=${encodeURIComponent(broker(i))}`,
        status: 200,
        body: [],
      },
      {
        method: "POST" as const,
        path: "/1.6/leads/resolve",
        status: 200,
        body: { type: "none", would_help: ["website"] },
      }
    );
  }
  return scripts;
}

beforeEach(() => resetHttpMock());

describe("a list looked up one company at a time is told to stop (product#4177)", () => {
  it("the 20th answer carries the notice, the 1,001st in an hour is refused with the batch tool named", async () => {
    const { requests } = mockHttp(misses(1000));
    const telemetry = spyTelemetry();
    const mcpClient = await connect(
      new LeadbayClient(BASE, "u.william-shape", "fr"),
      telemetry
    );

    const answers: any[] = [];
    for (let i = 1; i <= 1000; i++) {
      answers.push(
        await mcpClient.callTool({
          name: TOOL,
          arguments: { companyName: broker(i), _triggered_by: ASK },
        })
      );
    }

    expect(answers.some((a) => a.isError)).toBe(false);
    expect(answers[18].content[0].text).not.toContain("Lookup 19");
    expect(answers[19].structuredContent.notice).toContain("Lookup 20 by name");
    expect(answers[19].content[0].text).toContain("leadbay_qualify_leads");

    const before = requests.length;
    const refused: any = await mcpClient.callTool({
      name: TOOL,
      arguments: { companyName: broker(1001), _triggered_by: ASK },
    });

    expect(refused.isError).toBe(true);
    const text = refused.content[0].text;
    expect(text).toContain("1000 companies were looked up by name in the last hour, 1000 of them not found.");
    expect(text).toContain("leadbay_qualify_leads");
    expect(text).toMatch(/Retry after \d+s\./);
    expect(requests.length).toBe(before);
    expect(telemetry.captureToolCall).toHaveBeenLastCalledWith(
      expect.objectContaining({ tool: TOOL, ok: false, error_code: "TOO_MANY_LOOKUPS" })
    );
  });

  it("a caller whose sign-in failed is told to sign in on every call, never TOO_MANY_LOOKUPS", async () => {
    mockHttp([]);
    const broken = makeBrokenClient(
      {
        error: true,
        code: "AUTH_MISSING",
        message: "Missing bearer token on hosted MCP request.",
        hint: "Pass a Leadbay OAuth bearer token.",
      },
      "fr"
    );

    const codes = new Set<string>();
    for (let i = 1; i <= 1001; i++) {
      const e: any = await researchLeadByNameFuzzy
        .execute(broken, { companyName: broker(i) })
        .catch((err) => err);
      codes.add(e.code);
    }

    expect([...codes]).toEqual(["AUTH_MISSING"]);
  });
});
