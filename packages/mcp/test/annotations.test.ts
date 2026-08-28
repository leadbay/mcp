/**
 * Annotations test — asserts MCP-spec ToolAnnotations land in the
 * tools/list payload for tools that declare them.
 *
 * Per MCP 2025-11-25 §Tools, annotations are HINTS — clients use them
 * to decide UX (auto-approve vs prompt). The Tool type in core carries
 * an optional `annotations` field; toolsListPayload surfaces it on the
 * wire when present.
 *
 * This test pins the canonical annotations for two representative
 * composites — pull_leads (read) and report_outreach (destructive,
 * non-idempotent). Subsequent iterations will add per-tool assertions
 * for the remaining tools as their annotations land.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

async function connect(opts: { includeAdvanced?: boolean; includeWrite?: boolean } = { includeWrite: true }) {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(lbClient, opts);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return { mcpClient };
}

beforeEach(() => {
  resetHttpMock();
});

describe("every composite tool has annotations (drift catcher)", () => {
  it("every default-surface composite (read + write) declares annotations", async () => {
    const { mcpClient } = await connect();
    const listed = await mcpClient.listTools();
    // The default surface (with includeWrite=true) is composite reads
    // + composite writes. EVERY tool must declare annotations.
    const missing: string[] = [];
    for (const t of listed.tools) {
      if (!t.annotations) {
        missing.push(t.name);
      }
    }
    expect(missing, `tools missing annotations: ${missing.join(", ")}`).toEqual([]);
  });

  it("every annotated tool sets at least one of the four hints", async () => {
    const { mcpClient } = await connect();
    const listed = await mcpClient.listTools();
    const HINT_KEYS = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"];
    const missingHints: string[] = [];
    for (const t of listed.tools) {
      if (!t.annotations) continue;
      const hasAny = HINT_KEYS.some((k) => k in (t.annotations as Record<string, unknown>));
      if (!hasAny) missingHints.push(t.name);
    }
    expect(missingHints).toEqual([]);
  });

  it("destructive tools that mutate state are flagged readOnlyHint:false", async () => {
    const { mcpClient } = await connect();
    const listed = await mcpClient.listTools();
    const destructiveNames = [
      "leadbay_report_outreach",
      "leadbay_bulk_qualify_leads",
      "leadbay_enrich_titles",
      "leadbay_adjust_audience",
      "leadbay_refine_prompt",
      "leadbay_answer_clarification",
      "leadbay_import_leads",
      "leadbay_import_and_qualify",
    ];
    for (const name of destructiveNames) {
      const t = listed.tools.find((tool) => tool.name === name);
      expect(t, `${name} not found`).toBeDefined();
      expect(t!.annotations).toBeDefined();
      expect(t!.annotations!.destructiveHint, `${name} destructiveHint`).toBe(true);
      expect(t!.annotations!.readOnlyHint, `${name} readOnlyHint`).toBe(false);
    }
  });
});

describe("tools/list annotations (MCP spec ToolAnnotations)", () => {
  it("leadbay_pull_leads is annotated readOnly + idempotent + openWorld", async () => {
    const { mcpClient } = await connect();
    const listed = await mcpClient.listTools();
    const t = listed.tools.find((tool) => tool.name === "leadbay_pull_leads");
    expect(t).toBeDefined();
    expect(t!.annotations).toEqual({
      title: "Pull fresh Leadbay leads",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it("leadbay_report_outreach is annotated destructive + non-idempotent + openWorld", async () => {
    const { mcpClient } = await connect();
    const listed = await mcpClient.listTools();
    const t = listed.tools.find((tool) => tool.name === "leadbay_report_outreach");
    expect(t).toBeDefined();
    expect(t!.annotations).toEqual({
      title: "Report outreach to Leadbay",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it("research_lead is annotated readOnly + idempotent + openWorld (extended in iter 2)", async () => {
    const { mcpClient } = await connect();
    const listed = await mcpClient.listTools();
    const t = listed.tools.find((tool) => tool.name === "leadbay_research_lead_by_id");
    expect(t).toBeDefined();
    expect(t!.annotations).toEqual({
      title: "Research a Leadbay lead in depth (by UUID)",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });
});

describe("granular tool annotations (advanced surface — iter 3)", () => {
  it("every granular tool has annotations when includeAdvanced=true", async () => {
    const { mcpClient } = await connect({ includeAdvanced: true, includeWrite: true });
    const listed = await mcpClient.listTools();
    const missing: string[] = [];
    for (const t of listed.tools) {
      if (!t.annotations) {
        missing.push(t.name);
      }
    }
    expect(missing, `tools missing annotations: ${missing.join(", ")}`).toEqual([]);
  });

  it("granular reads are flagged readOnlyHint:true", async () => {
    const { mcpClient } = await connect({ includeAdvanced: true, includeWrite: true });
    const listed = await mcpClient.listTools();
    const granularReadNames = [
      "leadbay_list_lenses",
      "leadbay_discover_leads",
      "leadbay_get_lead_profile",
      "leadbay_get_lead_activities",
      "leadbay_get_taste_profile",
      "leadbay_get_contacts",
      "leadbay_get_quota",
      "leadbay_get_lens_filter",
      "leadbay_get_lens_scoring",
      "leadbay_list_sectors",
      "leadbay_get_user_prompt",
      "leadbay_get_clarification",
      "leadbay_get_lead_notes",
      "leadbay_get_epilogue_responses",
      "leadbay_get_prospecting_actions",
      "leadbay_get_web_fetch",
      "leadbay_get_selection_ids",
      "leadbay_get_enrichment_job_titles",
      "leadbay_list_mappable_fields",
      // preview_bulk_enrichment is in granularWriteTools by catalog but
      // is read-only on the wire.
      "leadbay_preview_bulk_enrichment",
    ];
    for (const name of granularReadNames) {
      const t = listed.tools.find((tool) => tool.name === name);
      expect(t, `${name} not found`).toBeDefined();
      expect(t!.annotations!.readOnlyHint, `${name} readOnlyHint`).toBe(true);
      expect(t!.annotations!.destructiveHint, `${name} destructiveHint`).toBe(false);
    }
  });

  it("granular writes are flagged destructiveHint:true with correct idempotency", async () => {
    const { mcpClient } = await connect({ includeAdvanced: true, includeWrite: true });
    const listed = await mcpClient.listTools();
    // (toolName, expectedIdempotent)
    const granularWrites: Array<[string, boolean]> = [
      ["leadbay_qualify_lead", true],
      ["leadbay_enrich_contacts", true],
      ["leadbay_add_note", false],
      ["leadbay_select_leads", true],
      ["leadbay_deselect_leads", true],
      ["leadbay_clear_selection", true],
      ["leadbay_set_active_lens", true],
      ["leadbay_create_lens", false],
      ["leadbay_update_lens", true],
      ["leadbay_update_lens_filter", true],
      ["leadbay_create_lens_draft", false],
      ["leadbay_promote_lens", false],
      ["leadbay_set_user_prompt", true],
      ["leadbay_clear_user_prompt", true],
      ["leadbay_pick_clarification", false],
      ["leadbay_dismiss_clarification", false],
      ["leadbay_set_epilogue_status", true],
      ["leadbay_remove_epilogue", true],
      ["leadbay_launch_bulk_enrichment", true],
    ];
    for (const [name, idempotent] of granularWrites) {
      const t = listed.tools.find((tool) => tool.name === name);
      expect(t, `${name} not found`).toBeDefined();
      expect(t!.annotations!.destructiveHint, `${name} destructiveHint`).toBe(true);
      expect(t!.annotations!.readOnlyHint, `${name} readOnlyHint`).toBe(false);
      expect(t!.annotations!.idempotentHint, `${name} idempotentHint`).toBe(idempotent);
    }
  });
});
