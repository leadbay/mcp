/**
 * Annotation-presence audit — every EXPOSED tool must carry a non-empty
 * `title` and an explicit `openWorldHint`.
 *
 * Why a separate test: the existing annotations.test.ts pins read/destructive
 * hints for named tools, but nothing asserts that EVERY tool has a `title` or an
 * `openWorldHint`. Those two are exactly what the connector directories key on —
 * missing/incorrect action labels + non-human-readable names are the #1 stated
 * rejection cause for both the Anthropic Connectors Directory and the ChatGPT
 * Apps SDK. Without this, a future tool could ship with no title / no
 * openWorldHint and pass CI, silently regressing directory compliance.
 *
 * This is a drift-catcher over the real wire payload (buildServer → listTools),
 * across the default surface AND the advanced (granular) surface — so it covers
 * every tool that can ever be exposed. New file; does not modify
 * annotations.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

async function listAllTools(opts: { includeAdvanced?: boolean; includeWrite?: boolean }) {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(lbClient, opts);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return (await mcpClient.listTools()).tools;
}

beforeEach(() => {
  resetHttpMock();
});

// The widest surface: default composites + write + advanced granular. If a tool
// can be exposed on any deployment, it shows up here and must be compliant.
const WIDEST = { includeWrite: true, includeAdvanced: true } as const;

describe("annotation presence (directory compliance drift-catcher)", () => {
  it("every exposed tool declares an `annotations` object", async () => {
    const tools = await listAllTools(WIDEST);
    expect(tools.length).toBeGreaterThan(0);
    const missing = tools.filter((t) => !t.annotations).map((t) => t.name);
    expect(missing, `tools missing annotations: ${missing.join(", ")}`).toEqual([]);
  });

  it("every exposed tool has a non-empty human-readable `title`", async () => {
    const tools = await listAllTools(WIDEST);
    const bad = tools
      .filter((t) => {
        const title = t.annotations?.title;
        return typeof title !== "string" || title.trim().length === 0;
      })
      .map((t) => t.name);
    expect(bad, `tools missing a non-empty annotations.title: ${bad.join(", ")}`).toEqual([]);
  });

  it("every exposed tool sets an explicit boolean `openWorldHint`", async () => {
    // openWorldHint is meaningful for directory review (external-system calls);
    // every Leadbay tool hits the external Leadbay API, so it must be present
    // and true. Pinning presence stops a future tool from omitting it.
    const tools = await listAllTools(WIDEST);
    const bad = tools
      .filter((t) => typeof t.annotations?.openWorldHint !== "boolean")
      .map((t) => t.name);
    expect(bad, `tools missing a boolean openWorldHint: ${bad.join(", ")}`).toEqual([]);
  });

  it("every exposed tool sets explicit boolean readOnlyHint + destructiveHint, never both true", async () => {
    // Both hints must be present + boolean (directories reject missing action
    // labels). They must never be simultaneously true (readOnly + destructive is
    // a contradiction). Note: a write that only CREATES/adds is legitimately
    // readOnly:false + destructive:false — creating new data isn't destructive —
    // so we do NOT require exactly-one, only "never both true".
    const tools = await listAllTools(WIDEST);
    const bad = tools
      .filter((t) => {
        const ro = t.annotations?.readOnlyHint;
        const de = t.annotations?.destructiveHint;
        if (typeof ro !== "boolean" || typeof de !== "boolean") return true; // missing
        return ro === true && de === true; // contradiction
      })
      .map((t) => t.name);
    expect(
      bad,
      `tools with missing or contradictory readOnly/destructive hints: ${bad.join(", ")}`
    ).toEqual([]);
  });

  it("tool names are within the 64-char MCP limit and snake_case leadbay_ prefixed", async () => {
    const tools = await listAllTools(WIDEST);
    const bad = tools
      .filter((t) => t.name.length > 64 || !/^leadbay_[a-z0-9_]+$/.test(t.name))
      .map((t) => `${t.name} (${t.name.length})`);
    expect(bad, `non-conforming tool names: ${bad.join(", ")}`).toEqual([]);
  });
});
