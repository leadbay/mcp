// product#4003 end-to-end — a stalled backend, driven through the real MCP
// dispatch surface with the real tool that produced the incident.
//
// On 19-20 July 2026 `leadbay_list_campaigns` (one `GET /campaigns`, nothing
// else) hung 28 times for one customer, up to 57 hours per call, and settled in
// two ~50 ms bursts when the backend finally gave up. She has zero web-app
// pageviews, so the MCP going quiet was a 36-hour total outage for her — and
// nothing alerted, because a request that never returns raises no exception.
//
// A client-level unit test can't prove that story is closed: the agent-visible
// outcome, the telemetry, and the semaphore all live on the server dispatch
// path. So this drives `buildServer` through an in-memory MCP client and calls
// the tool by name against a node:https double that stalls on `/campaigns`
// exactly the way the backend did.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// node:https double. `/users/me` always answers (telemetry identity has to
// resolve or every event stays buffered and nothing is assertable); the
// incident path stalls on demand — handshake accepted, no response, ever.
const h = vi.hoisted(() => {
  const state = {
    stallCampaigns: true,
    destroyed: 0,
    campaignCalls: 0,
  };

  const request = (options: any, callback?: (res: any) => void) => {
    const path: string = options.path ?? "/";
    const isCampaigns = path.includes("/campaigns");
    if (isCampaigns) state.campaignCalls++;
    return {
      on() {
        return this;
      },
      write() {},
      destroy() {
        state.destroyed++;
      },
      end() {
        if (isCampaigns && state.stallCampaigns) return;
        const handlers: Record<string, Array<(...a: unknown[]) => void>> = {};
        const res = {
          statusCode: 200,
          headers: {} as Record<string, string>,
          on(ev: string, cb: (...a: unknown[]) => void) {
            (handlers[ev] ??= []).push(cb);
            return this;
          },
        };
        const body = isCampaigns
          ? JSON.stringify([])
          : JSON.stringify({
              id: "user-1",
              email: "ludivine@groupeorionis.test",
              name: "Ludivine",
              organization: { id: "org-orionis", name: "Groupe Orionis" },
            });
        setTimeout(() => {
          callback?.(res);
          (handlers["data"] ?? []).forEach((cb) => cb(Buffer.from(body, "utf8")));
          (handlers["end"] ?? []).forEach((cb) => cb());
        }, 0);
      },
    };
  };

  return { state, request };
});

vi.mock("node:https", () => ({ default: { request: h.request }, request: h.request }));

const posthogState = vi.hoisted(() => ({
  capture: vi.fn(),
  identify: vi.fn(),
  shutdown: vi.fn(async () => {}),
}));

vi.mock("posthog-node", () => {
  class PostHog {
    capture(...args: any[]) {
      return posthogState.capture(...args);
    }
    identify(...args: any[]) {
      return posthogState.identify(...args);
    }
    shutdown(timeoutMs?: number) {
      return posthogState.shutdown(timeoutMs);
    }
  }
  return { PostHog };
});

vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  setUser: vi.fn(),
  captureException: vi.fn(),
  withScope: vi.fn((fn: (s: any) => void) => {
    fn({
      setTag: vi.fn(),
      setExtra: vi.fn(),
      setFingerprint: vi.fn(),
      setUser: vi.fn(),
    });
  }),
  close: vi.fn(async () => true),
}));

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../../src/server.js";
import { initTelemetry } from "../../src/telemetry.js";

const BASE = "https://api-fr.leadbay.app";

let savedNodeEnv: string | undefined;
let savedTimeout: string | undefined;

beforeEach(() => {
  posthogState.capture.mockClear();
  h.state.stallCampaigns = true;
  h.state.destroyed = 0;
  h.state.campaignCalls = 0;
  savedNodeEnv = process.env.NODE_ENV;
  savedTimeout = process.env.LEADBAY_TIMEOUT_MS;
  // Bypass the NODE_ENV=test short-circuit so the real telemetry path runs.
  (process.env as any).NODE_ENV = "development";
  delete process.env.LEADBAY_TELEMETRY_ENABLED;
  // Shrink the fleet default so the stall resolves in test time.
  process.env.LEADBAY_TIMEOUT_MS = "60";
});

afterEach(() => {
  if (savedNodeEnv === undefined) delete (process.env as any).NODE_ENV;
  else (process.env as any).NODE_ENV = savedNodeEnv;
  if (savedTimeout === undefined) delete process.env.LEADBAY_TIMEOUT_MS;
  else process.env.LEADBAY_TIMEOUT_MS = savedTimeout;
});

async function connect() {
  const client = new LeadbayClient(BASE, "u.test-token", "fr");
  const telemetry = initTelemetry({ version: "0.30.0" });
  const identityDone = telemetry.identify(client);
  const server = buildServer(client, { telemetry });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  await identityDone;
  return { mcpClient, client };
}

const eventsNamed = (name: string) =>
  posthogState.capture.mock.calls.filter((c: any[]) => c[0]?.event === name);

const callCampaigns = (mcpClient: Client) =>
  mcpClient.callTool({
    name: "leadbay_list_campaigns",
    arguments: { _triggered_by: "tâche planifiée quotidienne — mise à jour des leads" },
  });

describe("leadbay_list_campaigns against a stalled backend (product#4003)", () => {
  it("returns a TIMEOUT error to the agent instead of never answering", async () => {
    const { mcpClient } = await connect();

    const res: any = await callCampaigns(mcpClient);

    expect(res.isError).toBe(true);
    const text: string = res.content[0].text;
    // The agent has to be able to tell the user what happened AND know that
    // retrying is the right move — a bare "Error" leaves it guessing.
    expect(text).toContain("did not respond within 60ms");
    expect(text.toLowerCase()).toContain("retry");
    expect(text).toContain("GET /campaigns");
    // The socket was cancelled, not abandoned behind a raced promise.
    expect(h.state.destroyed).toBe(1);
  });

  it("fires the 'mcp tool timeout' alert event — the signal that was missing", async () => {
    const { mcpClient } = await connect();

    await callCampaigns(mcpClient);

    const alerts = eventsNamed("mcp tool timeout");
    expect(alerts).toHaveLength(1);
    const props = alerts[0][0].properties;
    expect(props.tool).toBe("leadbay_list_campaigns");
    expect(props.timeout_ms).toBe(60);
    expect(props.endpoint).toBe("GET /campaigns");
    expect(props.region).toBe("fr");

    // And the ordinary tool-call record still lands, coded so a dashboard can
    // join the two.
    const calls = eventsNamed("mcp tool called");
    expect(calls).toHaveLength(1);
    expect(calls[0][0].properties.ok).toBe(false);
    expect(calls[0][0].properties.error_code).toBe("TIMEOUT");
  });

  it("does not deadlock the session — the burst drains and the next call succeeds", async () => {
    const { mcpClient, client } = await connect();

    // Twelve concurrent calls is burst 1 of the incident, against a client whose
    // semaphore only has 5 slots.
    const results: any[] = await Promise.all(
      Array.from({ length: 12 }, () => callCampaigns(mcpClient))
    );
    expect(results.every((r) => r.isError === true)).toBe(true);
    expect(client._semaphoreState).toEqual({ active: 0, queued: 0 });

    // The backend recovers. Under the old behaviour the five slots were still
    // pinned by promises that would not settle for another two days.
    h.state.stallCampaigns = false;
    const after: any = await callCampaigns(mcpClient);
    expect(after.isError).toBeFalsy();
    expect(JSON.parse(after.content[0].text).campaigns).toEqual([]);
  });
});
