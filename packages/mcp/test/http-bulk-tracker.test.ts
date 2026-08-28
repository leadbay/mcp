/**
 * Hosted HTTP MCP — bulk handles survive a request, and don't cross tenants
 * (leadbay/product#4005).
 *
 * `buildServerFromClient()` built every hosted MCP server WITHOUT a
 * `bulkTracker`. The option is optional on `BuildServerOptions`, so it compiled
 * and failed silently: `ctx.bulkTracker` was `undefined` on 100% of hosted
 * calls and every one of the six `!ctx?.bulkTracker` guards fired.
 * `leadbay_import_and_qualify` — whose guard is unconditional — had never once
 * succeeded on mcp.leadbay.app; `leadbay_bulk_qualify_leads` failed whenever
 * `wait_for_completion` was false. Nine external users hit it over six weeks.
 *
 * These tests drive the REAL hosted surface: the exported Hono app on a real
 * socket, through StreamableHTTPServerTransport, with only the Leadbay backend
 * stubbed. That matters here more than usual, because the bug was not in a
 * composite — it was in the transport wiring, and every core-level test passed
 * throughout. The load-bearing case is the second one: the streamable transport
 * is stateless (`sessionIdGenerator: undefined`, a fresh MCP Server per request,
 * torn down on close), so a handle is only usable if the store outlives the
 * request that minted it.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

// Point the store at a scratch file BEFORE http-server.ts is imported — it
// builds the store at module scope, and the default path is the developer's
// real ~/.leadbay/bulks.json. Hoisted so it runs above the import below.
const STORE = vi.hoisted(() => {
  const { mkdtempSync } = require("node:fs");
  const { join } = require("node:path");
  const { homedir } = require("node:os");
  // $HOME-rooted: LocalBulkStore refuses paths outside it without the unsafe flag.
  const dir = mkdtempSync(join(homedir(), ".leadbay-bulk-e2e-"));
  const previous = process.env.LEADBAY_BULK_STORE_PATH;
  process.env.LEADBAY_BULK_STORE_PATH = join(dir, "bulks.json");
  return { dir, previous };
});

import { rmSync } from "node:fs";
import { createDefaultBulkStore } from "@leadbay/core";
import { serve } from "@hono/node-server";
import { app } from "../src/http-server.js";

afterAll(() => {
  rmSync(STORE.dir, { recursive: true, force: true });
  // Vitest reuses a worker across files. Leaving this set would point a later
  // suite's createDefaultBulkStore() at a directory this one just deleted,
  // making results order-dependent.
  if (STORE.previous === undefined) delete process.env.LEADBAY_BULK_STORE_PATH;
  else process.env.LEADBAY_BULK_STORE_PATH = STORE.previous;
});

// Per-case lead id. Every case launches through the same shared store, and the
// idempotency key is (lead_ids, import_ids, lens_id, mapping_fingerprint) inside
// a 5-minute window — so with one shared LEAD the second case would reuse the
// first case's reservation, skip its own launch, and pass without ever
// exercising the thing it claims to test.
let LEAD: string;
let seq = 0;
const nextLead = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++seq).padStart(12, "0")}`;
const LENS = 77;
const TOKEN_A = "u.token-org-a_us";
const TOKEN_B = "u.token-org-b_us";

const meFor = (orgId: string, email: string) => ({
  id: `user-${orgId}`,
  email,
  organization: { id: orgId },
  // import_and_qualify gates on admin before it touches the backend.
  admin: true,
  last_requested_lens: String(LENS),
});

// One /users/me per HTTP request: the auth probe seeds the client's cache, and
// both the telemetry identity read and the organization lookup hit it.
const ME_A = { method: "GET" as const, path: "/1.6/users/me", status: 200, body: meFor("org-A", "a@example.com") };
const ME_B = { method: "GET" as const, path: "/1.6/users/me", status: 200, body: meFor("org-B", "b@example.com") };

// The whole wait_for_completion=false launch path with explicit leadIds.
const launchScript = () => [
  { method: "POST" as const, path: /^\/1\.6\/leads\/selection\/select/, status: 204 },
  {
    method: "POST" as const,
    path: "/1.6/leads/selection/web_fetch?force_fetch=false",
    status: 200,
    body: { queued: 1, skipped: 0, queued_ids: [LEAD], skipped_ids: [], notification_id: "notif-1" },
  },
  { method: "POST" as const, path: "/1.6/leads/selection/clear", status: 204 },
];

// What leadbay_qualify_status reads once it has resolved the handle.
const statusScript = () => [
  { method: "GET" as const, path: /^\/1\.6\/organizations\//, status: 200, body: {} },
  { method: "GET" as const, path: /^\/1\.6\/organizations\//, status: 200, body: {} },
  { method: "GET" as const, path: /^\/1\.6\/organizations\//, status: 200, body: {} },
  { method: "GET" as const, path: /^\/1\.6\/lenses\/77\/leads\//, status: 200, body: { id: LEAD, name: "Acme" } },
  { method: "GET" as const, path: /^\/1\.6\/leads\/.*\/web_fetch/, status: 200, body: { status: "SUCCESS" } },
  { method: "GET" as const, path: /^\/1\.6\/leads\/.*\/ai_agent_responses/, status: 200, body: [] },
  {
    method: "GET" as const,
    path: /^\/1\.6\/notifications/,
    status: 200,
    body: { items: [], total_unseen: 0, pagination: { page: 0, pages: 1, count: 0 } },
  },
];

// import_and_qualify in domains mode with wait_for_completion=false: upload the
// generated CSV, wait for preprocess, hand back the handle.
const IMPORT_SCRIPT = [
  {
    method: "POST" as const,
    path: /^\/1\.6\/imports\?file_name=/,
    status: 200,
    body: { id: "imp-1", pre_processing: { finished: true }, processing: { finished: false } },
  },
  {
    method: "GET" as const,
    path: "/1.6/imports/imp-1",
    status: 200,
    body: { id: "imp-1", pre_processing: { finished: true }, processing: { finished: false } },
  },
];

const IMPORT_SCRIPT_B = [
  {
    method: "POST" as const,
    path: /^\/1\.6\/imports\?file_name=/,
    status: 200,
    body: { id: "imp-2", pre_processing: { finished: true }, processing: { finished: false } },
  },
  {
    method: "GET" as const,
    path: "/1.6/imports/imp-2",
    status: 200,
    body: { id: "imp-2", pre_processing: { finished: true }, processing: { finished: false } },
  },
];

async function boot(): Promise<{ close: () => void; url: string }> {
  const server: any = await new Promise((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => resolve(s));
  });
  return { close: () => server.close(), url: `http://127.0.0.1:${server.address().port}/mcp` };
}

// One tool call = one HTTP request = one MCP session, exactly as a hosted
// connector drives it.
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
    httpStatus: res.status,
    isError: json.result?.isError === true,
    text: json.result?.content?.[0]?.text ?? "",
    structured: json.result?.structuredContent,
  };
}

const launchArgs = () => ({ _triggered_by: "qualify these leads", leadIds: [LEAD], lensId: LENS, wait_for_completion: false });

beforeEach(() => {
  resetHttpMock();
  // Fresh store AND fresh inputs per case — either alone would leave the suite
  // order-dependent.
  rmSync(process.env.LEADBAY_BULK_STORE_PATH!, { force: true });
  LEAD = nextLead();
});

describe("hosted HTTP MCP — bulk tracker (product#4005)", () => {
  it("a non-blocking launch returns a handle instead of BULK_TRACKER_UNAVAILABLE", async () => {
    mockHttp([ME_A, ...launchScript()]);
    const { close, url } = await boot();
    try {
      const launch = await callTool(url, TOKEN_A, "leadbay_bulk_qualify_leads", launchArgs());
      expect(launch.text).not.toContain("BULK_TRACKER_UNAVAILABLE");
      expect(launch.isError).toBe(false);
      expect(launch.structured.qualify_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
      expect(launch.structured.status).toBe("running");
    } finally {
      close();
    }
  });

  it("the handle resolves on a SECOND, separate HTTP request", async () => {
    mockHttp([ME_A, ...launchScript(), ME_A, ...statusScript()]);
    const { close, url } = await boot();
    try {
      const launch = await callTool(url, TOKEN_A, "leadbay_bulk_qualify_leads", launchArgs());
      const qualifyId = launch.structured.qualify_id;

      // New request, new LeadbayClient, new MCP Server, new transport — the
      // process-level registry is the only thing connecting the two.
      const status = await callTool(url, TOKEN_A, "leadbay_qualify_status", {
        _triggered_by: "how is the qualification going",
        qualify_id: qualifyId,
      });

      expect(status.isError).toBe(false);
      expect(status.structured.qualify_id).toBe(qualifyId);
      expect(status.structured.status).toBe("launched");
      expect(status.structured.lead_ids).toEqual([LEAD]);
      expect(status.structured.lens_id).toBe(LENS);
      // Persisted at markLaunched from the backend's launch response.
      expect(status.structured.notification_id).toBe("notif-1");
    } finally {
      close();
    }
  });

  // The unconditional guard, and the worst case in the telemetry: 13 hosted
  // calls, 13 failures, zero successes ever. It is a different code path from
  // the two conditional guards above, so it gets its own case.
  it("leadbay_import_and_qualify gets past the guard it had never once cleared", async () => {
    mockHttp([ME_A, ...IMPORT_SCRIPT]);
    const { close, url } = await boot();
    try {
      const res = await callTool(url, TOKEN_A, "leadbay_import_and_qualify", {
        _triggered_by: "import and qualify these companies",
        domains: [{ domain: "acme.com" }],
        wait_for_completion: false,
      });

      expect(res.text).not.toContain("BULK_TRACKER_UNAVAILABLE");
      expect(res.isError).toBe(false);
      expect(res.structured.status).toBe("running");
      expect(res.structured.handle_id).toBeTruthy();
      expect(res.structured.import_ids).toEqual(["imp-1"]);
    } finally {
      close();
    }
  });

  // The one collision a shared store actually makes possible. The enrich and
  // qualify idempotency keys both carry lens_id, which is per-organization; the
  // import key carried no tenant component at all, so two organizations
  // uploading identical rows inside the 5-minute window would have had the
  // second handed the first's handle — and its imported leads.
  it("does not reuse another organization's import for identical rows", async () => {
    mockHttp([ME_A, ...IMPORT_SCRIPT, ME_B, ...IMPORT_SCRIPT_B]);
    const { close, url } = await boot();
    const args = {
      _triggered_by: "import and qualify these companies",
      domains: [{ domain: "acme.com" }],
      wait_for_completion: false,
    };
    try {
      const a = await callTool(url, TOKEN_A, "leadbay_import_and_qualify", args);
      const b = await callTool(url, TOKEN_B, "leadbay_import_and_qualify", args);

      expect(a.isError).toBe(false);
      expect(b.isError).toBe(false);
      // Same rows, same window, different organizations — so a fresh
      // reservation each, not a reused handle.
      expect(b.structured.handle_id).not.toBe(a.structured.handle_id);
      expect(a.structured.import_ids).toEqual(["imp-1"]);
      expect(b.structured.import_ids).toEqual(["imp-2"]);
    } finally {
      close();
    }
  });

  it("survives a process restart — the handle is on disk, not in the heap", async () => {
    mockHttp([ME_A, ...launchScript()]);
    const { close, url } = await boot();
    let qualifyId: string;
    try {
      const launch = await callTool(url, TOKEN_A, "leadbay_bulk_qualify_leads", launchArgs());
      qualifyId = launch.structured.qualify_id;
    } finally {
      close();
    }

    // A brand-new store over the same path is what the next pod sees after a
    // release. The user who launched this in the evening polls it the next
    // morning, and Argo has rolled the image in between.
    const restarted = await createDefaultBulkStore({ logger: undefined });
    const record = await restarted.getQualify(qualifyId!);
    expect(record?.bulk_id).toBe(qualifyId!);
    expect(record?.lead_ids).toEqual([LEAD]);
    // product#4010: qualify records used to lose this on every file read, which
    // silently forced qualify_status onto the per-lead fallback.
    expect(record?.notification_id).toBe("notif-1");
  });
});
