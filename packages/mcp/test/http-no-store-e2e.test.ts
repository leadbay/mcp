/**
 * The hosted surface, end to end, with no store anywhere (product#4005).
 *
 * Drives the real exported Hono app on a real socket through
 * StreamableHTTPServerTransport, which is the transport the hosted server
 * actually runs. That matters for two reasons:
 *
 *  1. The bug this replaces was in transport wiring, not in a composite —
 *     every core-level test passed while hosted was completely broken.
 *  2. The transport is stateless: a fresh MCP Server per request, torn down on
 *     close. So a handle that resolves on a SECOND request proves the handle
 *     needs nothing held between them. That is the whole design.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { serve } from "@hono/node-server";
import { app } from "../src/http-server.js";
import { resetLaunchGuard } from "@leadbay/core";

const LEAD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LENS = 77;
const NOTIF = "11d949d5-f4e9-4591-b106-f289b863b298";
const TOKEN_A = "u.token-org-a_us";
const TOKEN_B = "u.token-org-b_us";

const meFor = (orgId: string, email: string) => ({
  id: `user-${orgId}`,
  email,
  organization: { id: orgId },
  admin: true,
  last_requested_lens: String(LENS),
});
const ME_A = { method: "GET" as const, path: "/1.6/users/me", status: 200, body: meFor("org-A", "a@example.com") };
const ME_B = { method: "GET" as const, path: "/1.6/users/me", status: 200, body: meFor("org-B", "b@example.com") };

const LAUNCH = [
  { method: "POST" as const, path: /^\/1\.6\/leads\/selection\/select/, status: 204 },
  {
    method: "POST" as const,
    path: "/1.6/leads/selection/web_fetch?force_fetch=false",
    status: 200,
    body: { queued: 1, skipped: 0, queued_ids: [LEAD], skipped_ids: [], notification_id: NOTIF },
  },
  { method: "POST" as const, path: "/1.6/leads/selection/clear", status: 204 },
];

const notificationListing = (over: Record<string, unknown> = {}) => ({
  method: "GET" as const,
  path: /^\/1\.6\/notifications/,
  status: 200,
  body: {
    items: [
      {
        id: NOTIF,
        created_at: "2026-09-01T10:00:00Z",
        in_progress: true,
        links: [],
        bulk_progress: { total_count: 1, success_count: 0, failure_count: 0, quota_hit_count: 0 },
        file_import_id: null,
        ...over,
      },
    ],
    total_unseen: 0,
    pagination: { page: 0, pages: 1, count: 1 },
  },
});

async function boot(): Promise<{ close: () => void; url: string }> {
  const server: any = await new Promise((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => resolve(s));
  });
  return { close: () => server.close(), url: `http://127.0.0.1:${server.address().port}/mcp` };
}

// One tool call = one HTTP request = one MCP session, as a hosted connector drives it.
async function callTool(url: string, token: string, name: string, args: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const json = (await res.json()) as any;
  return {
    isError: json.result?.isError === true,
    text: json.result?.content?.[0]?.text ?? "",
    structured: json.result?.structuredContent,
  };
}

const launchArgs = {
  _triggered_by: "qualify these leads",
  leadIds: [LEAD],
  lensId: LENS,
  wait_for_completion: false,
};

beforeEach(() => {
  resetHttpMock();
  resetLaunchGuard();
});

describe("hosted MCP end to end, no store (product#4005)", () => {
  it("a non-blocking launch hands back the BACKEND's job id", async () => {
    mockHttp([ME_A, ...LAUNCH]);
    const { close, url } = await boot();
    try {
      const launch = await callTool(url, TOKEN_A, "leadbay_bulk_qualify_leads", launchArgs);
      expect(launch.isError).toBe(false);
      expect(launch.structured.notification_id).toBe(NOTIF);
      expect(launch.structured.lead_ids).toEqual([LEAD]);
      // Nothing client-minted survives in the contract.
      expect(launch.structured).not.toHaveProperty("handle_id");
      expect(launch.structured).not.toHaveProperty("qualify_id");
    } finally {
      close();
    }
  });

  it("the id resolves on a SECOND, separate HTTP request", async () => {
    mockHttp([ME_A, ...LAUNCH, ME_A, notificationListing()]);
    const { close, url } = await boot();
    try {
      const launch = await callTool(url, TOKEN_A, "leadbay_bulk_qualify_leads", launchArgs);

      // New connection, new client, new MCP Server. Nothing is carried over —
      // the backend is the only thing that remembers.
      const status = await callTool(url, TOKEN_A, "leadbay_qualify_status", {
        _triggered_by: "how is the qualification going",
        notification_id: launch.structured.notification_id,
      });

      expect(status.isError).toBe(false);
      expect(status.structured.notification_id).toBe(NOTIF);
      expect(status.structured.bulk_progress).toMatchObject({ total_count: 1 });
      expect(status.structured.in_progress).toBe(true);
    } finally {
      close();
    }
  });

  it("progress costs ONE backend call, not one per lead", async () => {
    const { requests } = mockHttp([ME_A, notificationListing()]);
    const { close, url } = await boot();
    try {
      await callTool(url, TOKEN_A, "leadbay_qualify_status", {
        _triggered_by: "how is it going",
        notification_id: NOTIF,
      });
      // /users/me for auth, then the ledger. No per-lead fan-out.
      expect(requests.filter((r: any) => /\/leads\//.test(r.path))).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("another organization's token cannot read the job", async () => {
    // The backend 404s a job belonging to another org — no existence leak, and
    // no MCP-side check needed, because the MCP holds nothing to leak.
    mockHttp([
      ME_B,
      {
        method: "GET",
        path: /^\/1\.6\/notifications/,
        status: 200,
        body: { items: [], total_unseen: 0, pagination: { page: 0, pages: 1, count: 0 } },
      },
    ]);
    const { close, url } = await boot();
    try {
      const leaked = await callTool(url, TOKEN_B, "leadbay_qualify_status", {
        _triggered_by: "how is it going",
        notification_id: NOTIF,
      });
      expect(leaked.isError).toBe(true);
      expect(leaked.text).not.toContain(LEAD);
    } finally {
      close();
    }
  });

  it("hosted and stdio run the same code path — no tracker to be missing", async () => {
    // The original bug: hosted built its server without a bulkTracker and every
    // bulk tool failed there while passing everywhere else. There is no such
    // option any more, so the divergence cannot recur.
    mockHttp([ME_A, ...LAUNCH]);
    const { close, url } = await boot();
    try {
      const launch = await callTool(url, TOKEN_A, "leadbay_bulk_qualify_leads", launchArgs);
      expect(launch.text).not.toContain("BULK_TRACKER_UNAVAILABLE");
      expect(launch.text).not.toContain("BulkTracker");
    } finally {
      close();
    }
  });
});
