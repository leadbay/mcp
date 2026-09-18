/**
 * product#4175 — a hosted tool error reaches Sentry with the caller attached.
 *
 * Hosted is one multi-tenant process: it never calls identify(), so the
 * module-scoped `me` that stdio uses to tag Sentry stays empty. Every hosted
 * exception landed with no user and no organization tag — 894 of the 934 `mcp`
 * Sentry events in the 14 days to 2026-09-17, and all 894 anonymous. Sentry
 * read "Users Impacted: 0" on every issue, and a scheduled run that failed
 * twenty times in 38 seconds (Case 1: an 8-character lead id, MCP-38) could not
 * be traced to its account from Sentry.
 *
 * The chain under test is the hosted one: resolveIdentity() reads the request's
 * /users/me, bindTelemetryIdentity() wraps the shared handle, buildServer()'s
 * CallTool handler fires captureException, and the real initTelemetry() writes
 * the Sentry scope. Only the two SDKs are mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

vi.mock("posthog-node", () => {
  class PostHog {
    capture() {}
    identify() {}
    async shutdown() {}
  }
  return { PostHog };
});

const sentry = vi.hoisted(() => {
  const scopes: Array<{ tags: Record<string, unknown>; user?: unknown }> = [];
  return {
    scopes,
    init: vi.fn(),
    setUser: vi.fn(),
    captureException: vi.fn(),
    httpIntegration: vi.fn(() => ({})),
    withScope: vi.fn((fn: (s: any) => void) => {
      const scope: any = { tags: {}, user: undefined };
      scope.setTag = (k: string, v: unknown) => { scope.tags[k] = v; };
      scope.setExtra = () => {};
      scope.setFingerprint = () => {};
      scope.setUser = (u: unknown) => { scope.user = u; };
      scopes.push(scope);
      fn(scope);
    }),
    close: vi.fn(async () => true),
  };
});
vi.mock("@sentry/node", () => sentry);

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { initTelemetry } from "../src/telemetry.js";
import { resolveIdentity, bindTelemetryIdentity } from "../src/http-server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-fr.leadbay.app";
const LENS = 48110;
const SHORT_ID = "695be16b";
const BAD_LEAD_ID = { error: { code: "bad_request", message: "bad 'leadId' parameter" } };
const ME = {
  id: "0b7e2c1a-5f0e-4c7e-9a51-3f7c2d9e8a10",
  email: "scheduled-run@example.test",
  name: "Scheduled Run",
  organization: { id: "4f1d9c2e-8b3a-4e6f-a0d5-7c9b1e2f3a4d", name: "Example Org" },
};

let savedNodeEnv: string | undefined;
beforeEach(() => {
  resetHttpMock();
  sentry.scopes.length = 0;
  sentry.setUser.mockClear();
  sentry.captureException.mockClear();
  savedNodeEnv = process.env.NODE_ENV;
  // initTelemetry returns NOOP under NODE_ENV=test; drive the real handle.
  (process.env as any).NODE_ENV = "development";
  delete process.env.LEADBAY_TELEMETRY_ENABLED;
});
afterEach(() => {
  if (savedNodeEnv === undefined) delete (process.env as any).NODE_ENV;
  else (process.env as any).NODE_ENV = savedNodeEnv;
});

async function hostedCall(me: typeof ME, args: Record<string, unknown>) {
  resetHttpMock();
  mockHttp([
    { method: "GET", path: "/1.6/users/me", status: 200, body: me },
    { method: "POST", path: "/1.6/interactions", status: 400, body: BAD_LEAD_ID },
    { method: "GET", path: `/1.6/lenses/${LENS}/leads/${SHORT_ID}`, status: 400, body: BAD_LEAD_ID },
    ...Array.from({ length: 5 }, () => ({
      method: "GET" as const,
      path: new RegExp(`^/1\\.6/leads/${SHORT_ID}/`),
      status: 400,
      body: BAD_LEAD_ID,
    })),
  ]);
  const client = new LeadbayClient(BASE, "o.hosted-token", "fr");
  const shared = initTelemetry({ version: "0.0.0-test" });
  const bound = bindTelemetryIdentity(shared, await resolveIdentity(client));
  const server = buildServer(client, { telemetry: bound });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
  const res: any = await mcpClient.callTool({ name: "leadbay_research_lead_by_id", arguments: args });
  return res;
}

describe("hosted Sentry attribution (product#4175)", () => {
  it("the Case 1 exception carries the caller's email and organization", async () => {
    const res = await hostedCall(ME, {
      _triggered_by: "Scheduled routine: re-poll enrichment",
      leadId: SHORT_ID,
      lensId: LENS,
    });
    expect(res.isError).toBe(true);

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    const scope = sentry.scopes[sentry.scopes.length - 1];
    expect(scope.tags.tool).toBe("leadbay_research_lead_by_id");
    expect(scope.tags.endpoint).toBe(`/lenses/${LENS}/leads/${SHORT_ID}`);
    expect(scope.user).toEqual({ email: ME.email, username: ME.name });
    expect(scope.tags.organization).toBe(ME.organization.id);
  });

  it("two tenants on the one process are attributed to themselves", async () => {
    await hostedCall(ME, { _triggered_by: "run A", leadId: SHORT_ID, lensId: LENS });
    const first = sentry.scopes[sentry.scopes.length - 1];
    const other = { ...ME, email: "other-tenant@example.test", name: "Other", organization: { id: "org-b", name: "B" } };
    await hostedCall(other, { _triggered_by: "run B", leadId: SHORT_ID, lensId: LENS });
    const second = sentry.scopes[sentry.scopes.length - 1];

    expect(first.user).toEqual({ email: ME.email, username: ME.name });
    expect(first.tags.organization).toBe(ME.organization.id);
    expect(second.user).toEqual({ email: "other-tenant@example.test", username: "Other" });
    expect(second.tags.organization).toBe("org-b");
    // Hosted never sets the process-wide Sentry user, so no tenant leaks onto another's events.
    expect(sentry.setUser).not.toHaveBeenCalled();
  });
});
