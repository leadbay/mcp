/**
 * Notifications-inbox integration tests on the MCP server.
 *
 * Asserts:
 *   1. When the inbox holds terminal bulk-progress notifications, EVERY
 *      tool response carries them in `_meta.notifications` (implicit
 *      delivery channel).
 *   2. `leadbay_account_status` surfaces the same entries at the top
 *      level (daily-rhythm channel).
 *   3. `leadbay_acknowledge_notification` posts to the backend AND
 *      removes the entry from the inbox so subsequent calls no longer
 *      carry it.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import {
  LeadbayClient,
  NotificationsInbox,
  type Notification,
} from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";
const NOTIF_ID = "abcdef01-2345-4678-89ab-cdef01234567";

function mkTerminalEnrichNotification(): Notification {
  return {
    id: NOTIF_ID,
    created_at: "2026-05-26T00:00:00Z",
    updated_at: "2026-05-26T00:01:00Z",
    first_seen_at: null,
    archived: false,
    language: "en",
    title: "Enrichment done",
    content: null,
    in_progress: false,
    links: [{ type: "bulk_enrichment", id: "42" }],
    bulk_progress: {
      total_count: 5,
      success_count: 5,
      failure_count: 0,
      quota_hit_count: 0,
    },
    file_import_id: null,
  };
}

async function connectWithInbox(inbox: NotificationsInbox) {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(lbClient, {
    includeWrite: true,
    notificationsInbox: inbox,
  });
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

describe("notifications inbox surfaces on every tool response", () => {
  it("decorates _meta.notifications when the inbox has entries", async () => {
    const inbox = new NotificationsInbox();
    inbox.record(mkTerminalEnrichNotification());
    const { mcpClient } = await connectWithInbox(inbox);

    mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: {
          id: "u",
          email: "test@x.com",
          organization: { id: "org-1", name: "X", ai_agent_enabled: true },
          last_requested_lens: 42,
        },
      },
      {
        method: "GET",
        path: /\/1\.5\/organizations\/org-1\/quota_status/,
        status: 200,
        body: { plan: "free", org: { spend: [], resources: [] } },
      },
      // Notifications list request (account-status notifications block AND
      // any inbox catch-up that the composite triggers).
      {
        method: "GET",
        path: /\/1\.5\/notifications\?archived=false/,
        status: 200,
        body: { items: [], total_unseen: 0, pagination: { page: 0, pages: 1, total: 0 } },
      },
    ]);

    const result: any = await mcpClient.callTool({
      name: "leadbay_account_status",
      arguments: { _triggered_by: "show me account status" },
    });
    expect(result.isError).not.toBe(true);
    // Implicit channel — _meta.notifications on the structured payload.
    const structured = result.structuredContent;
    expect(structured._meta?.notifications).toBeDefined();
    const entries = structured._meta.notifications;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      notification_id: NOTIF_ID,
      kind: "bulk_enrich",
      anchor_id: "42",
    });
    expect(entries[0].revise_hint).toMatch(/contact enrichment/i);
  });

  it("does not inject _meta.notifications when the inbox is empty", async () => {
    const inbox = new NotificationsInbox();
    const { mcpClient } = await connectWithInbox(inbox);

    mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: {
          id: "u",
          email: "test@x.com",
          organization: { id: "org-1", name: "X" },
        },
      },
      {
        method: "GET",
        path: /\/1\.5\/organizations\/org-1\/quota_status/,
        status: 200,
        body: { plan: "free", org: { spend: [], resources: [] } },
      },
    ]);

    const result: any = await mcpClient.callTool({
      name: "leadbay_account_status",
      arguments: { _triggered_by: "show me account status" },
    });
    expect(result.isError).not.toBe(true);
    const structured = result.structuredContent;
    expect(structured._meta?.notifications).toBeUndefined();
  });

  it("leadbay_acknowledge_notification posts /seen and drops the inbox entry", async () => {
    const inbox = new NotificationsInbox();
    inbox.record(mkTerminalEnrichNotification());
    expect(inbox.size()).toBe(1);
    const { mcpClient } = await connectWithInbox(inbox);

    mockHttp([
      {
        method: "POST",
        path: `/1.5/notifications/${NOTIF_ID}/seen`,
        status: 204,
      },
    ]);

    const result: any = await mcpClient.callTool({
      name: "leadbay_acknowledge_notification",
      arguments: { notification_id: NOTIF_ID },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      acknowledged: true,
      notification_id: NOTIF_ID,
      action: "seen",
    });
    expect(inbox.size()).toBe(0);
  });
});
