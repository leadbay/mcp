/**
 * Regression: leadbay_research_lead_by_id `_meta` must stay an OPEN envelope.
 *
 * The MCP server layer decorates every successful tool result with
 * server-side `_meta` keys after the composite returns — most importantly
 * `_meta.notifications` (drained from the notifications inbox) and
 * `_meta.update_available`. The SDK then validates the emitted
 * `structuredContent` against the tool's declared `outputSchema` using the
 * full JSON-Schema spec — which HONORS `additionalProperties`.
 *
 * When research_lead_by_id's `outputSchema._meta` carried
 * `additionalProperties: false`, those server-injected keys made the call
 * fail before any data reached the client:
 *
 *   MCP error -32602: Structured content does not match the tool's output
 *   schema: data/_meta must NOT have additional properties
 *
 * The existing output-schema-conformance suite did NOT catch this: its
 * happy-path mocks leave the inbox empty, so the server never injects an
 * extra `_meta` key, and its custom validator ignores `additionalProperties`
 * anyway. This test seeds the inbox so the server DOES inject
 * `_meta.notifications`, then drives the tool through the real in-process MCP
 * SDK client — which runs the genuine `additionalProperties`-honoring
 * validator. A future re-closure of `_meta` (here or in the fuzzy wrapper
 * that shares this output path) fails this test at the SDK layer, the same
 * way it broke at runtime.
 *
 * New file (existing conformance test left untouched per repo convention).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient, NotificationsInbox } from "@leadbay/core";
import type { Notification } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

// A terminal (in_progress:false) bulk-progress notification — the only shape
// the inbox records — so the server's maybeAttachNotifications injects
// `_meta.notifications` onto the result.
function terminalNotification(): Notification {
  return {
    id: "notif-1",
    created_at: "2026-06-18T00:00:00Z",
    updated_at: "2026-06-18T00:05:00Z",
    first_seen_at: null,
    archived: false,
    language: "en",
    title: "Qualification finished",
    content: null,
    in_progress: false,
    links: [],
    bulk_progress: {
      total_count: 10,
      success_count: 10,
      failure_count: 0,
      quota_hit_count: 0,
    },
    file_import_id: null,
  };
}

// Mirror the happy-path HTTP for research_lead_by_id (lensId 42, lead-1).
function mockResearchLeadHttp(): void {
  mockHttp([
    { method: "POST", path: "/1.5/interactions", status: 200, body: {} },
    {
      method: "GET",
      path: /\/1\.5\/lenses\/42\/leads\/lead-1$/,
      status: 200,
      body: {
        id: "lead-1",
        name: "Acme",
        sector_id: 7,
        score: 80,
        ai_agent_lead_score: 70,
        tags: [],
        size: null,
        location: null,
        website: "acme.com",
        description: null,
        short_description: null,
        social: {},
        liked: false,
        disliked: false,
        contacts_count: 0,
        org_contacts_count: 0,
        notes_count: 0,
        epilogue_actions_count: 0,
        prospecting_actions_count: 0,
        recommended_contact_title: null,
        recommended_contact: null,
      },
    },
    {
      method: "GET",
      path: "/1.5/leads/lead-1/ai_agent_responses",
      status: 200,
      body: [
        {
          question: "Why this lead?",
          question_created_at: "2026-04-20T00:00:00Z",
          lead_id: "lead-1",
          score: 8,
          response: "good fit",
          computed_at: "2026-04-20T00:00:00Z",
        },
      ],
    },
    {
      method: "GET",
      path: /\/1\.5\/leads\/lead-1\/enrich\/contacts/,
      status: 200,
      body: [],
    },
    {
      method: "GET",
      path: "/1.5/leads/lead-1/web_fetch",
      status: 200,
      body: { signals: [], status: "complete" },
    },
  ]);
}

async function connectWithInbox(inbox: NotificationsInbox) {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(lbClient, {
    includeWrite: true,
    includeAdvanced: true,
    notificationsInbox: inbox,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  // listTools() is what makes the SDK client cache each tool's outputSchema
  // and compile its validator. Without this call, callTool() skips output
  // validation entirely — so this step is load-bearing for the regression:
  // it's the SDK path that throws -32602 on an additionalProperties:false
  // `_meta` violation.
  await mcpClient.listTools();
  return { mcpClient };
}

beforeEach(() => {
  resetHttpMock();
});

describe("research_lead_by_id — _meta is an open envelope (regression for -32602)", () => {
  it("succeeds through the SDK validator when the server injects _meta.notifications", async () => {
    const inbox = new NotificationsInbox();
    inbox.record(terminalNotification());
    expect(inbox.size()).toBe(1); // sanity: the server will inject _meta.notifications

    const { mcpClient } = await connectWithInbox(inbox);
    mockResearchLeadHttp();

    // With `additionalProperties: false` on `_meta`, the SDK throws here:
    //   -32602 … data/_meta must NOT have additional properties.
    // With the envelope open, it resolves.
    const res: any = await mcpClient.callTool({
      name: "leadbay_research_lead_by_id",
      arguments: {
        leadId: "lead-1",
        lensId: 42,
        _triggered_by: "test: research_lead_by_id _meta regression",
      },
    });

    expect(res.isError).toBeFalsy();
    const structured = res.structuredContent;
    expect(structured).toBeTruthy();
    // The server-injected key that used to break validation is present…
    expect(structured._meta.notifications).toHaveLength(1);
    // …alongside the composite's own declared _meta fields.
    expect(structured._meta.region).toBeDefined();
    expect(structured._meta.lens_id).toBe(42);
  });

  it("succeeds across all response_format / concise variants with a populated inbox", async () => {
    const variants: Array<Record<string, unknown>> = [
      {},
      { response_format: "json" },
      { response_format: "markdown" },
      { concise: true },
    ];

    for (const extra of variants) {
      resetHttpMock();
      const inbox = new NotificationsInbox();
      inbox.record(terminalNotification());
      const { mcpClient } = await connectWithInbox(inbox);
      mockResearchLeadHttp();

      const res: any = await mcpClient.callTool({
        name: "leadbay_research_lead_by_id",
        arguments: {
          leadId: "lead-1",
          lensId: 42,
          _triggered_by: "test: research_lead_by_id _meta regression",
          ...extra,
        },
      });

      expect(
        res.isError,
        `variant ${JSON.stringify(extra)} should not error`
      ).toBeFalsy();
      expect(res.structuredContent?._meta?.notifications).toHaveLength(1);
    }
  });
});
