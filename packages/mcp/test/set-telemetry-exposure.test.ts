/**
 * leadbay_set_telemetry must be exposed even in read-only mode (Codex P2).
 *
 * It's the ONLY in-product telemetry opt-out/status control, and a hosted user
 * has no local LEADBAY_TELEMETRY_ENABLED env var to edit. So it stays available
 * when LEADBAY_MCP_WRITE=0 (includeWrite:false) — a user must always be able to
 * turn telemetry OFF — even though it's a mutating (write) tool. Other write
 * composites stay hidden in read-only mode as before.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

async function toolNames(includeWrite: boolean): Promise<string[]> {
  const server = buildServer(new LeadbayClient(BASE, "u.test-token"), { includeWrite });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([server.connect(st), mcp.connect(ct)]);
  const { tools } = await mcp.listTools();
  return tools.map((t) => t.name);
}

beforeEach(() => resetHttpMock());

describe("leadbay_set_telemetry exposure vs LEADBAY_MCP_WRITE", () => {
  it("read-only mode (includeWrite:false) still exposes leadbay_set_telemetry", async () => {
    const names = await toolNames(false);
    expect(names).toContain("leadbay_set_telemetry");
  });

  it("read-only mode still hides OTHER write composites (the exception is telemetry-only)", async () => {
    const names = await toolNames(false);
    // A representative write composite that should stay gated off in read-only.
    expect(names).not.toContain("leadbay_refine_prompt");
  });

  it("write mode (includeWrite:true) exposes leadbay_set_telemetry exactly once (no dup)", async () => {
    const names = await toolNames(true);
    expect(names.filter((n) => n === "leadbay_set_telemetry")).toHaveLength(1);
  });
});
