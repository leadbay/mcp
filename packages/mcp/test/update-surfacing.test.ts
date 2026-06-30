/**
 * Proactive update surfacing (product#3742).
 *
 * The auto-update CHECK already runs at boot + on every tool call and caches
 * an UpdateInfo. The gap this suite guards: a fresh session rarely calls
 * leadbay_account_status, so the cached proposal must ALSO ride along on the
 * first ordinary tool result of the session — otherwise the user never sees
 * the "newer version available" prompt.
 *
 * Two delivery channels, both exercised here against the real JSON-RPC server:
 *   1. leadbay_account_status → top-level `update_available` (its outputSchema
 *      documents the field; always reflects the cache).
 *   2. ANY other tool → `_meta.update_available` on the FIRST such response of
 *      the session, gated once-per-version so we don't decorate every call.
 *
 * New file (never modify existing test files — repo invariant).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";
import { vi } from "vitest";

vi.mock("node:https", () => httpsMockFactory());

import type { Tool } from "@leadbay/core";
import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { UpdateStateStore } from "../src/update-state.js";
import {
  checkForUpdate,
  getCachedUpdateInfo,
  __resetUpdateCacheForTests,
} from "../src/update-check.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";
const CURRENT = "0.19.2";
const LATEST = "0.20.0";
const DXT_URL =
  "https://github.com/leadbay/mcp/releases/download/mcp-v0.20.0/leadbay-0.20.0.dxt";
const MCPB_URL =
  "https://github.com/leadbay/mcp/releases/download/mcp-v0.20.0/leadbay-0.20.0.mcpb";
const RELEASE_URL = "https://github.com/leadbay/mcp/releases/tag/mcp-v0.20.0";

// A fetch stub returning one "newer release published" GitHub payload — enough
// to populate the in-process update cache via checkForUpdate().
function fakeReleaseFetch(): typeof fetch {
  return (async () => {
    const headers = new Headers();
    headers.set("etag", '"abc"');
    return {
      status: 200,
      headers,
      json: async () => ({
        tag_name: `mcp-v${LATEST}`,
        html_url: RELEASE_URL,
        // Both assets present — the picker must prefer .dxt.
        assets: [
          { name: "leadbay-0.20.0.mcpb", browser_download_url: MCPB_URL },
          { name: "leadbay-0.20.0.dxt", browser_download_url: DXT_URL },
        ],
      }),
    } as unknown as Response;
  }) as typeof fetch;
}

// Trivial JSON-returning tool — stands in for "any non-account_status tool"
// without coupling the test to a real composite's HTTP shape.
const pingTool: Tool = {
  name: "leadbay_ping_test",
  description: "test-only ping",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: {
    type: "object",
    properties: { pong: { type: "boolean" } },
    required: ["pong"],
  },
  annotations: { readOnlyHint: true },
  execute: async () => ({ pong: true }),
};

// Returns a Leadbay error envelope — the CallTool handler serializes these as
// a bare { content, isError } with NO _meta / structuredContent. The update
// proposal must NOT be consumed by such a result (regression guard for the
// "first call errors → proposal invisible all session" bug).
const errorTool: Tool = {
  name: "leadbay_error_test",
  description: "test-only error",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true },
  execute: async () => ({
    error: true as const,
    code: "QUOTA_EXCEEDED",
    message: "quota hit",
    hint: "retry later",
  }),
};

async function seedUpdateCache(stateStore: UpdateStateStore) {
  await checkForUpdate({
    currentVersion: CURRENT,
    stateStore,
    telemetry: {} as any,
    force: true,
    releasesUrl: "https://example.test/releases/latest",
    fetchImpl: fakeReleaseFetch(),
  });
}

async function connectWithUpdates(stateStore: UpdateStateStore) {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(lbClient, {
    includeWrite: true,
    version: CURRENT,
    updateStateStore: stateStore,
    extraTools: [pingTool, errorTool],
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return { mcpClient };
}

function newStore() {
  return new UpdateStateStore({ backend: "memory" });
}

beforeEach(() => {
  resetHttpMock();
  __resetUpdateCacheForTests();
});

describe("proactive update surfacing — non-account_status tools (product#3742)", () => {
  it("rides _meta.update_available on the FIRST ordinary tool result", async () => {
    const store = newStore();
    await seedUpdateCache(store);
    const { mcpClient } = await connectWithUpdates(store);

    const result = await mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });
    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as any;
    expect(structured.pong).toBe(true);
    expect(structured._meta?.update_available).toMatchObject({
      current_version: CURRENT,
      latest_version: LATEST,
      // .dxt preferred over .mcpb when both assets are published.
      install_url: DXT_URL,
      release_url: RELEASE_URL,
    });
  });

  it("does NOT re-decorate subsequent calls for the same version (surfaces once)", async () => {
    const store = newStore();
    await seedUpdateCache(store);
    const { mcpClient } = await connectWithUpdates(store);

    const first = await mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });
    expect((first.structuredContent as any)._meta?.update_available).toBeDefined();

    const second = await mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });
    expect((second.structuredContent as any)._meta?.update_available).toBeUndefined();
  });

  it("does not attach anything when no update is cached", async () => {
    const store = newStore();
    // Seed a RECENT check that found nothing newer than CURRENT (latest ==
    // current). This keeps the server's per-call refresh on the throttle path
    // (state is fresh, all latest_known_* present) so it never reaches live
    // GitHub — buildInfoIfUpgrade then resolves to null and nothing rides on
    // _meta. Without this seed the per-call check hits the real releases API,
    // making the case depend on the latest published release happening to equal
    // CURRENT — which breaks the moment any newer version ships.
    await store.write({
      last_check_time: Date.now(),
      latest_known_version: CURRENT,
      latest_known_install_url:
        "https://github.com/leadbay/mcp/releases/download/mcp-v0.19.2/leadbay-0.19.2.dxt",
      latest_known_release_url:
        "https://github.com/leadbay/mcp/releases/tag/mcp-v0.19.2",
      suppressed_versions: [],
    });
    const { mcpClient } = await connectWithUpdates(store);

    const result = await mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });
    expect((result.structuredContent as any)._meta?.update_available).toBeUndefined();
  });

  // Regression: an error envelope is serialized as a bare { content, isError }
  // with no _meta — so attaching there would burn the once-per-version gate
  // while dropping the field, making the proposal invisible for the rest of
  // the session. The proposal must survive a first-call error and surface on
  // the next non-error tool result instead.
  it("does NOT consume the proposal when the first tool call errors", async () => {
    const store = newStore();
    await seedUpdateCache(store);
    const { mcpClient } = await connectWithUpdates(store);

    const errored = await mcpClient.callTool({ name: "leadbay_error_test", arguments: {} });
    expect(errored.isError).toBe(true);

    // The next successful tool call must still carry the proposal.
    const ok = await mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });
    expect((ok.structuredContent as any)._meta?.update_available).toMatchObject({
      latest_version: LATEST,
      install_url: DXT_URL,
    });
  });
});

describe("update surfacing — account_status keeps top-level field", () => {
  it("attaches update_available as a top-level field", async () => {
    const store = newStore();
    await seedUpdateCache(store);
    const { mcpClient } = await connectWithUpdates(store);

    mockHttp([
      {
        method: "GET",
        path: "/1.6/users/me",
        status: 200,
        body: {
          id: "u",
          email: "a@b.co",
          name: "Tester",
          organization: { id: "org-1", name: "Org", ai_agent_enabled: true },
        },
      },
      {
        method: "GET",
        path: /\/1\.6\/organizations\/org-1\/quota_status/,
        status: 200,
        body: { plan: "pro", org: { spend: [], resources: [] } },
      },
    ]);

    const result = await mcpClient.callTool({
      name: "leadbay_account_status",
      arguments: { _triggered_by: "what's my account status" },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as any;
    expect(structured.update_available).toMatchObject({
      current_version: CURRENT,
      latest_version: LATEST,
    });
  });

  it("once account_status surfaces a version, a later ordinary tool does NOT re-prompt it", async () => {
    const store = newStore();
    await seedUpdateCache(store);
    const { mcpClient } = await connectWithUpdates(store);

    mockHttp([
      {
        method: "GET",
        path: "/1.6/users/me",
        status: 200,
        body: { email: "a@b.co", name: "T", organization: { id: "org-1", name: "Org" } },
      },
      {
        method: "GET",
        path: "/1.6/organizations/org-1/quota_status",
        status: 200,
        body: { plan: "pro" },
      },
    ]);

    const acct = await mcpClient.callTool({
      name: "leadbay_account_status",
      arguments: { _triggered_by: "what's my account status" },
    });
    expect((acct.structuredContent as any).update_available).toBeDefined();

    // The once-per-version gate is shared: the ordinary tool should NOT
    // re-surface a version account_status already prompted.
    const ping = await mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });
    expect((ping.structuredContent as any)._meta?.update_available).toBeUndefined();
  });
});

describe("proactive update surfacing — first-call race (product#3742 review)", () => {
  // A store whose read() is artificially slow, so the per-call checkForUpdate
  // is STILL IN FLIGHT when the (fast) tool returns and maybeAttachUpdate runs.
  // This is the deterministic stand-in for the production race: the boot-time /
  // per-call GitHub check hasn't populated the in-memory cache yet when the
  // first tool result is being assembled. The ONLY way the proposal surfaces is
  // if maybeAttachUpdate awaits the in-flight check rather than reading a cold
  // cache and giving up — which is exactly the fix under test.
  class SlowReadStore extends UpdateStateStore {
    constructor(private readonly delayMs: number) {
      super({ backend: "memory" });
    }
    async read() {
      await new Promise((r) => setTimeout(r, this.delayMs));
      return super.read();
    }
  }

  it("surfaces on the first tool call even when the check is still in flight", async () => {
    const store = new SlowReadStore(80);
    await store.write({
      // Recent check → checkForUpdate takes the throttle/disk path (no network),
      // but the slow read() keeps it in flight past the tool's return.
      last_check_time: Date.now(),
      latest_known_version: LATEST,
      latest_known_install_url: DXT_URL,
      latest_known_release_url: RELEASE_URL,
      suppressed_versions: [],
    });
    // Cache is cold at connect time — nothing has read the store into it yet.
    expect(getCachedUpdateInfo()).toBeNull();

    const { mcpClient } = await connectWithUpdates(store);

    // First (and only) call is an ordinary tool. ping returns instantly while
    // the slow store read is still resolving; maybeAttachUpdate must await the
    // in-flight check before concluding there's nothing to show.
    const result = await mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });
    expect((result.structuredContent as any)._meta?.update_available).toMatchObject({
      latest_version: LATEST,
      install_url: DXT_URL,
    });
  });

  it("shares the boot check's in-flight promise — first call awaits the real result", async () => {
    const store = newStore();
    await store.write({
      last_check_time: Date.now(),
      latest_known_version: LATEST,
      latest_known_install_url: DXT_URL,
      latest_known_release_url: RELEASE_URL,
      suppressed_versions: [],
    });

    // Simulate the boot-time force-check that's STILL FETCHING when the first
    // tool call lands. A slow fetchImpl keeps it in flight; force:true bypasses
    // the throttle so it genuinely awaits the wire. The server's per-call
    // refresh must de-dupe onto THIS promise (not start its own / not get an
    // instant stale-null), and maybeAttachUpdate awaits it.
    let releaseFetch!: () => void;
    const fetchGate = new Promise<void>((r) => (releaseFetch = r));
    const bootCheck = checkForUpdate({
      currentVersion: CURRENT,
      stateStore: store,
      telemetry: {} as any,
      force: true,
      releasesUrl: "https://example.test/releases/latest",
      fetchImpl: (async () => {
        await fetchGate;
        const headers = new Headers();
        headers.set("etag", '"boot"');
        return {
          status: 200,
          headers,
          json: async () => ({
            tag_name: `mcp-v${LATEST}`,
            html_url: RELEASE_URL,
            assets: [{ name: "leadbay-0.20.0.dxt", browser_download_url: DXT_URL }],
          }),
        } as unknown as Response;
      }) as typeof fetch,
    });

    const { mcpClient } = await connectWithUpdates(store);
    // Cache still cold — boot fetch is gated open.
    expect(getCachedUpdateInfo()).toBeNull();

    // Release the boot fetch a beat after the call starts, so the first tool
    // result genuinely waits on the shared in-flight promise.
    const callP = mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });
    setTimeout(() => releaseFetch(), 20);
    const result = await callP;
    await bootCheck;

    expect((result.structuredContent as any)._meta?.update_available).toMatchObject({
      latest_version: LATEST,
      install_url: DXT_URL,
    });
  });

  it("does NOT hold a tool response past the surface-wait bound on a slow check (P2 regression)", async () => {
    // A check that resolves far slower than the response can afford to wait
    // (store read parked well beyond the 1500ms surface-wait). This stands in
    // for the offline/cold case where the per-call fetch would otherwise hold
    // the response near checkForUpdate's full 5s timeout. maybeAttachUpdate
    // must give up at the bound, return promptly, and let a LATER call carry
    // the proposal once the cache warms — never stall an unrelated tool.
    class VerySlowReadStore extends UpdateStateStore {
      constructor() {
        super({ backend: "memory" });
      }
      async read() {
        await new Promise((r) => setTimeout(r, 2200)); // > 1500ms surface-wait
        return super.read();
      }
    }
    const store = new VerySlowReadStore();
    await store.write({
      last_check_time: Date.now(),
      latest_known_version: LATEST,
      latest_known_install_url: DXT_URL,
      latest_known_release_url: RELEASE_URL,
      suppressed_versions: [],
    });

    const { mcpClient } = await connectWithUpdates(store);

    const started = Date.now();
    const result = await mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });
    const elapsed = Date.now() - started;

    // The slow check didn't surface in time, so nothing is attached this call —
    // and crucially the response was NOT held for the full 2.2s read. Ceiling
    // is the 1500ms bound plus generous slack to stay non-flaky.
    expect((result.structuredContent as any)._meta?.update_available).toBeUndefined();
    expect(elapsed).toBeLessThan(3000);
  });

  it("does NOT fail the tool call when the in-flight update check REJECTS (P2 regression)", async () => {
    // The update-state file becomes unreadable after startup: stateStore.read()
    // rejects OUTSIDE doCheck's fetch try/catch, so the shared in-flight promise
    // rejects. Update checks are best-effort — the response path must catch this
    // and return the tool result normally, never surface it as an MCP error.
    class RejectingReadStore extends UpdateStateStore {
      constructor() {
        super({ backend: "memory" });
      }
      async read(): Promise<any> {
        // Reject while the check is in flight (after a beat so it's genuinely
        // pending when maybeAttachUpdate awaits it).
        await new Promise((r) => setTimeout(r, 10));
        throw new Error("update-state.json unreadable (EACCES)");
      }
    }
    const store = new RejectingReadStore();

    const { mcpClient } = await connectWithUpdates(store);

    const result = await mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });

    // Tool call succeeded despite the rejected check; no proposal attached.
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as any).pong).toBe(true);
    expect((result.structuredContent as any)._meta?.update_available).toBeUndefined();
  });
});
