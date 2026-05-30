/**
 * report_outreach.user_confirmed elicit-consumer integration test (iter22).
 *
 * Mission: prevent agents from poisoning the SDR pipeline by fabricating
 * `verification.ref` prose. When the agent passes verification.source
 * ='user_confirmed' AND the client supports elicitation, the server
 * elicits the user's literal confirmation directly via the client UI.
 * The agent never sees the elicit prompt; the user types into the client;
 * the response replaces verification.ref.
 *
 * Coverage:
 *   1. elicit-accept path: ref is replaced; confirmed_via='elicit'
 *   2. elicit-decline path: returns OUTREACH_USER_CANCELLED
 *   3. elicit-cancel path: same
 *   4. legacy fallback: client without elicitation capability sees
 *      confirmed_via='agent_supplied' with the original ref
 *   5. dry_run path: no elicit triggered, response shape unchanged
 *   6. non-user_confirmed sources (gmail/calendar): no elicit; tag is
 *      'non_user_confirmed'
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const BASE = "https://api-us.leadbay.app";

interface ElicitResponse {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
}

async function connectWithElicit(elicitResponse: ElicitResponse | null) {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(lbClient, { includeWrite: true });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  // Capability negotiation: when elicitResponse is null, the client doesn't
  // advertise elicitation, so the server's ctx.elicit call would fail —
  // the composite falls back to agent-supplied.
  const mcpClient = new Client(
    { name: "test", version: "0.0.1" },
    elicitResponse ? { capabilities: { elicitation: {} } } : {}
  );
  if (elicitResponse) {
    mcpClient.setRequestHandler(ElicitRequestSchema, async () => elicitResponse);
  }
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return { mcpClient };
}

beforeEach(() => {
  resetHttpMock();
});

describe("report_outreach.user_confirmed elicit-consumer (iter22)", () => {
  it("elicit-accept replaces verification.ref with the user's literal text", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.5/leads/lead-1/notes",
        status: 200,
        body: { id: "note-1", note: "ok", created_at: "2026-05-07T20:00:00Z" },
      },
    ]);
    const { mcpClient } = await connectWithElicit({
      action: "accept",
      content: { confirmation: "yes I called Acme today" },
    });

    const result = await mcpClient.callTool({
      name: "leadbay_report_outreach",
      arguments: {
        lead_id: "lead-1",
        note: "Called Acme",
        verification: {
          source: "user_confirmed",
          ref: "agent claims user said yes",
        },
        _triggered_by: "test trigger",
      },
    });

    expect((result as any).isError).not.toBe(true);
    const structured = (result as any).structuredContent;
    expect(structured.confirmed_via).toBe("elicit");
    expect(structured.verification.ref).toBe("yes I called Acme today");
    expect(structured.verification.source).toBe("user_confirmed");
  });

  it("elicit-decline returns OUTREACH_USER_CANCELLED", async () => {
    const { mcpClient } = await connectWithElicit({ action: "decline" });
    const result = await mcpClient.callTool({
      name: "leadbay_report_outreach",
      arguments: {
        lead_id: "lead-1",
        note: "Called Acme",
        verification: { source: "user_confirmed", ref: "agent ref" },
        _triggered_by: "test trigger",
      },
    });
    expect((result as any).isError).toBe(true);
    const text = (result as any).content[0].text;
    expect(text).toMatch(/OUTREACH_USER_CANCELLED|declined/i);
  });

  it("elicit-cancel returns OUTREACH_USER_CANCELLED", async () => {
    const { mcpClient } = await connectWithElicit({ action: "cancel" });
    const result = await mcpClient.callTool({
      name: "leadbay_report_outreach",
      arguments: {
        lead_id: "lead-1",
        note: "Called Acme",
        verification: { source: "user_confirmed", ref: "agent ref" },
        _triggered_by: "test trigger",
      },
    });
    expect((result as any).isError).toBe(true);
    const text = (result as any).content[0].text;
    expect(text).toMatch(/cancelled/i);
  });

  it("empty confirmation accept is treated as decline", async () => {
    const { mcpClient } = await connectWithElicit({
      action: "accept",
      content: { confirmation: "   " },
    });
    const result = await mcpClient.callTool({
      name: "leadbay_report_outreach",
      arguments: {
        lead_id: "lead-1",
        note: "Called Acme",
        verification: { source: "user_confirmed", ref: "agent ref" },
        _triggered_by: "test trigger",
      },
    });
    expect((result as any).isError).toBe(true);
    const text = (result as any).content[0].text;
    expect(text).toMatch(/empty|cancelled/i);
  });

  it("client without elicitation capability falls back to agent_supplied", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.5/leads/lead-1/notes",
        status: 200,
        body: { id: "note-1", note: "ok", created_at: "2026-05-07T20:00:00Z" },
      },
    ]);
    const { mcpClient } = await connectWithElicit(null);

    const result = await mcpClient.callTool({
      name: "leadbay_report_outreach",
      arguments: {
        lead_id: "lead-1",
        note: "Called Acme",
        verification: { source: "user_confirmed", ref: "agent ref" },
        _triggered_by: "test trigger",
      },
    });

    expect((result as any).isError).not.toBe(true);
    const structured = (result as any).structuredContent;
    expect(structured.confirmed_via).toBe("agent_supplied");
    // Original agent-supplied ref preserved.
    expect(structured.verification.ref).toBe("agent ref");
  });

  it("dry_run does not trigger elicit", async () => {
    let elicitCalled = false;
    const lbClient = new LeadbayClient(BASE, "u.test-token");
    const server = buildServer(lbClient, { includeWrite: true });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client(
      { name: "test", version: "0.0.1" },
      { capabilities: { elicitation: {} } }
    );
    mcpClient.setRequestHandler(ElicitRequestSchema, async () => {
      elicitCalled = true;
      return { action: "accept", content: { confirmation: "anything" } };
    });
    await Promise.all([
      server.connect(serverTransport),
      mcpClient.connect(clientTransport),
    ]);

    const result = await mcpClient.callTool({
      name: "leadbay_report_outreach",
      arguments: {
        lead_id: "lead-1",
        note: "Called Acme",
        verification: { source: "user_confirmed", ref: "agent ref" },
        dry_run: true,
        _triggered_by: "test trigger",
      },
    });

    expect(elicitCalled).toBe(false);
    expect((result as any).isError).not.toBe(true);
    // dry_run shape — has would_write_notes but no confirmed_via tag (only
    // the live shape carries confirmed_via).
    const structured = (result as any).structuredContent;
    expect(structured.dry_run).toBe(true);
  });

  it("gmail_message_id source skips elicit and tags confirmed_via=non_user_confirmed", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.5/leads/lead-1/notes",
        status: 200,
        body: { id: "note-1", note: "ok", created_at: "2026-05-07T20:00:00Z" },
      },
    ]);
    let elicitCalled = false;
    const lbClient = new LeadbayClient(BASE, "u.test-token");
    const server = buildServer(lbClient, { includeWrite: true });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client(
      { name: "test", version: "0.0.1" },
      { capabilities: { elicitation: {} } }
    );
    mcpClient.setRequestHandler(ElicitRequestSchema, async () => {
      elicitCalled = true;
      return { action: "accept", content: { confirmation: "" } };
    });
    await Promise.all([
      server.connect(serverTransport),
      mcpClient.connect(clientTransport),
    ]);

    const result = await mcpClient.callTool({
      name: "leadbay_report_outreach",
      arguments: {
        lead_id: "lead-1",
        note: "Sent intro to Acme",
        verification: {
          source: "gmail_message_id",
          ref: "<CADxx@mail.gmail.com>",
        },
        _triggered_by: "test trigger",
      },
    });

    expect(elicitCalled).toBe(false);
    expect((result as any).isError).not.toBe(true);
    const structured = (result as any).structuredContent;
    expect(structured.confirmed_via).toBe("non_user_confirmed");
    expect(structured.verification.source).toBe("gmail_message_id");
  });
});
