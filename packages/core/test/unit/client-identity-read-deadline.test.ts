// The identity reads must be cancellable, not merely abandonable
// (Codex P1 follow-up, PR #162).
//
// `resolveMe()` and `fetchTelemetryEnabled()` are both consumed by callers that
// stop waiting after ~1.5s — the hosted telemetry context races resolveMe, and
// the SSE refresh fires fetchTelemetryEnabled behind a timer. Giving up on a
// promise does NOT stop the HTTPS request underneath it, and node:https sets no
// socket timeout, so against a backend that completes the handshake and then
// goes silent each of those reads pins a socket AND an API-semaphore slot for
// the life of the process.
//
// That is not a theoretical outage-only path: the hosted auth resolver returns
// an `ok` (unseeded) client when its probes time out, so during a silent
// regional outage EVERY authenticated request starts one of these reads — the
// leak compounds per request until the client can no longer make any.
//
// Both now take `{ timeoutMs }`, which destroys the request. The shared harness
// always answers, so this file ships a node:https double that can hang.

import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    calls: [] as Array<{ destroyed: boolean }>,
    /** When true the request never answers — no response, no error, ever. */
    hang: false,
  };

  const request = (_options: unknown, callback?: (res: unknown) => void) => {
    const entry = { destroyed: false };
    state.calls.push(entry);
    return {
      on() {
        return this;
      },
      write() {},
      destroy() {
        entry.destroyed = true;
      },
      end() {
        if (state.hang) return;
        const handlers: Record<string, Array<(...a: unknown[]) => void>> = {};
        const res = {
          statusCode: 200,
          headers: {} as Record<string, string>,
          on(ev: string, cb: (...a: unknown[]) => void) {
            (handlers[ev] ??= []).push(cb);
            return this;
          },
        };
        setTimeout(() => {
          callback?.(res);
          (handlers["data"] ?? []).forEach((cb) =>
            cb(Buffer.from(JSON.stringify({ id: "u1", telemetry_enabled: true }), "utf8"))
          );
          (handlers["end"] ?? []).forEach((cb) => cb());
        }, 0);
      },
    };
  };

  return { state, request };
});

vi.mock("node:https", () => ({ default: { request: h.request }, request: h.request }));

import { LeadbayClient } from "../../src/client.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => {
  h.state.calls = [];
  h.state.hang = false;
});

describe("resolveMe — timeoutMs", () => {
  it("cancels a stalled read instead of leaving it pending forever", async () => {
    h.state.hang = true;
    const client = newClient();

    await expect(client.resolveMe(false, { timeoutMs: 40 })).rejects.toMatchObject({
      code: "TIMEOUT",
    });

    expect(h.state.calls).toHaveLength(1);
    expect(h.state.calls[0].destroyed).toBe(true);
  });

  it("gives the API-semaphore slot back when the deadline fires", async () => {
    // The slot is what actually starves the process: a client that leaks all of
    // them can no longer issue tool calls even after the region recovers.
    h.state.hang = true;
    const client = newClient();

    await client.resolveMe(false, { timeoutMs: 40 }).catch(() => undefined);

    expect(client._semaphoreState.active).toBe(0);
    expect(client._semaphoreState.queued).toBe(0);
  });

  it("does not let a repeated stall accumulate live requests", async () => {
    h.state.hang = true;
    const client = newClient();

    for (let i = 0; i < 5; i++) {
      // force:true — otherwise the 60s /me cache would answer, and a failed read
      // never populates it anyway.
      await client.resolveMe(true, { timeoutMs: 20 }).catch(() => undefined);
    }

    expect(h.state.calls).toHaveLength(5);
    expect(h.state.calls.every((c) => c.destroyed)).toBe(true);
    expect(client._semaphoreState.active).toBe(0);
  });

  it("is opt-in and does not disturb a normal read", async () => {
    const client = newClient();
    const me = await client.resolveMe();

    expect(me.id).toBe("u1");
    expect(h.state.calls[0].destroyed).toBe(false);
  });

  it("resolves normally when the response beats the deadline", async () => {
    const client = newClient();
    const me = await client.resolveMe(false, { timeoutMs: 5000 });

    expect(me.id).toBe("u1");
    expect(h.state.calls[0].destroyed).toBe(false);
  });
});

describe("fetchTelemetryEnabled — timeoutMs", () => {
  it("cancels a stalled read", async () => {
    // Same leak on the SSE refresh path: it is fired without ever being awaited,
    // so nothing downstream would notice the request never finishing.
    h.state.hang = true;
    const client = newClient();

    await expect(client.fetchTelemetryEnabled({ timeoutMs: 40 })).rejects.toMatchObject({
      code: "TIMEOUT",
    });

    expect(h.state.calls[0].destroyed).toBe(true);
    expect(client._semaphoreState.active).toBe(0);
  });

  it("still reads the preference when the backend answers", async () => {
    const client = newClient();

    await expect(client.fetchTelemetryEnabled({ timeoutMs: 5000 })).resolves.toBe(true);
    expect(h.state.calls[0].destroyed).toBe(false);
  });
});
