// product#4003 — every request through LeadbayClient carries a deadline.
//
// The incident: node:https sets no socket timeout, and `timeoutMs` was opt-in.
// Only the hosted auth probe passed it, so a backend that completed the TCP
// handshake and then went silent left tool calls pending — one customer had 28
// calls hang for up to 57 hours across two bursts. Worse than 28 failures: the
// API semaphore is released in request()'s `finally`, so hung calls pinned all
// MAX_CONCURRENT=5 slots and stalled EVERY tool on the client.
//
// This file pins the inverted contract:
//   - no `timeoutMs` no longer means unbounded, it means the backstop;
//   - expiry cancels the socket, releases the slot, and yields a TIMEOUT-coded
//     LeadbayError envelope the agent can read out and retry;
//   - more hung requests than there are slots cannot deadlock the client;
//   - the backstop is still overridable, including all the way off, for the
//     operator who needs it.
//
// The backstop is the LAST line of defence, not the primary one — cancellation
// is (see client-request-cancellation.test.ts). It exists for the case where
// nothing ever cancels: a scheduled run, or a poll loop that already returned
// and left its last request orphaned.
//
// The shared harness always answers, so it cannot express a stall. This file
// ships a node:https double that can hang on demand.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    calls: [] as Array<{ destroyed: boolean }>,
    /** When true the request never answers — no response, no error. */
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
            cb(Buffer.from(JSON.stringify({ id: "u1" }), "utf8"))
          );
          (handlers["end"] ?? []).forEach((cb) => cb());
        }, 0);
      },
    };
  };

  return { state, request };
});

vi.mock("node:https", () => ({ default: { request: h.request }, request: h.request }));

import { LeadbayClient, DEFAULT_REQUEST_TIMEOUT_MS } from "../../src/client.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

let savedEnv: string | undefined;

beforeEach(() => {
  h.state.calls = [];
  h.state.hang = false;
  savedEnv = process.env.LEADBAY_TIMEOUT_MS;
  // Shrink the fleet default so a stall resolves in test time. The point under
  // test is that the deadline applies with no per-call opts, not its magnitude.
  process.env.LEADBAY_TIMEOUT_MS = "40";
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.LEADBAY_TIMEOUT_MS;
  else process.env.LEADBAY_TIMEOUT_MS = savedEnv;
});

describe("LeadbayClient — the request deadline is on by default", () => {
  it("a plain request() with no opts still times out instead of hanging forever", async () => {
    h.state.hang = true;

    await expect(newClient().request("GET", "/campaigns")).rejects.toMatchObject({
      error: true,
      code: "TIMEOUT",
    });
  });

  it("requestVoid() and requestRawBinary() carry the same default", async () => {
    h.state.hang = true;
    const client = newClient();

    await expect(
      client.requestVoid("POST", "/leads/epilogue", { lead_ids: ["l1"] })
    ).rejects.toMatchObject({ code: "TIMEOUT" });

    await expect(
      client.requestRawBinary("POST", "/imports", "text/csv", "a,b\n1,2\n")
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("the deadline cancels the socket rather than abandoning it", async () => {
    h.state.hang = true;

    await newClient().request("GET", "/campaigns").catch(() => undefined);

    expect(h.state.calls).toHaveLength(1);
    expect(h.state.calls[0].destroyed).toBe(true);
  });

  it("the timeout is a LeadbayError envelope the agent can act on, not a bare Error", async () => {
    h.state.hang = true;

    const err = await newClient()
      .request("GET", "/campaigns")
      .catch((e) => e);

    // formatErrorForLLM (server.ts) only renders `{error:true, code, message,
    // hint}`; a bare Error would reach the agent as an opaque string with no
    // instruction on what to do next.
    expect(err.error).toBe(true);
    expect(err.code).toBe("TIMEOUT");
    expect(err.message).toContain("40ms");
    expect(err.hint).toMatch(/retry/i);
    expect(err._meta?.endpoint).toBe("GET /campaigns");
    // The deadline that expired travels on the envelope so telemetry doesn't
    // have to re-parse the message to alert with it.
    expect(err._meta?.timeout_ms).toBe(40);
    // latency_ms must describe THIS failure, not whatever the previous request
    // happened to take (makeError's default reads the stale _lastMeta).
    expect(err._meta?.latency_ms).toBe(40);
    // Not an auth code: the hosted auth probe branches on these two and would
    // otherwise report a live token as expired (auth-http.ts).
    expect(err.code).not.toBe("AUTH_EXPIRED");
    expect(err.code).not.toBe("NOT_AUTHENTICATED");
  });

  it("a hung request never holds its concurrency slot past the deadline", async () => {
    h.state.hang = true;
    const client = newClient();

    // MAX_CONCURRENT is 5. Twelve hung calls is burst 1 of the incident.
    const inflight = Array.from({ length: 12 }, (_, i) =>
      client.request("GET", `/campaigns?p=${i}`).catch(() => "timed-out")
    );
    expect(await Promise.all(inflight)).toEqual(Array(12).fill("timed-out"));

    // The queue drained: nothing left holding a slot, nothing left waiting.
    expect(client._semaphoreState).toEqual({ active: 0, queued: 0 });

    // And the client still works — the deadlock is what made the incident a
    // 36-hour outage rather than 28 failed calls.
    h.state.hang = false;
    await expect(client.request<{ id: string }>("GET", "/users/me")).resolves.toMatchObject({
      id: "u1",
    });
  });

  it("an explicit timeoutMs still wins over the default", async () => {
    h.state.hang = true;

    const err = await newClient()
      .request("GET", "/campaigns", undefined, { retryOn401: false, timeoutMs: 15 })
      .catch((e) => e);

    expect(err.message).toContain("15ms");
  });

  it("timeoutMs <= 0 is the explicit opt-out — the request stays unbounded", async () => {
    h.state.hang = true;
    let settled = false;

    void newClient()
      .request("GET", "/campaigns", undefined, { timeoutMs: 0 })
      .then(
        () => (settled = true),
        () => (settled = true)
      );

    // Well past the 40ms default; only an armed deadline could have settled it.
    await new Promise((r) => setTimeout(r, 150));
    expect(settled).toBe(false);
    expect(h.state.calls[0].destroyed).toBe(false);
  });

  it("a response that beats the deadline resolves normally and disarms it", async () => {
    const result = await newClient().request<{ id: string }>("GET", "/users/me");
    expect(result.id).toBe("u1");
    expect(h.state.calls[0].destroyed).toBe(false);
  });

  it("the backstop outlives the longest budget any workflow grants itself", () => {
    // Deliberately NOT derived from observed request latency. Leadbay LAUNCHES
    // its AI work rather than awaiting it (a lens creation with wishlist is
    // 148ms, a web_fetch AI launch 166ms, measured live 2026-08-28), but a
    // number picked from that would encode "Leadbay never answers after N
    // seconds" — a claim about a backend we do not own, and one an AI product
    // will eventually break.
    //
    // Anchor it to OUR code instead: the longest budget any workflow in this
    // repo grants itself is 300s (bulk_qualify total_budget_ms, import-leads
    // DEFAULT_TOTAL_BUDGET_MS). A request that outlives the workflow that issued
    // it is already abandoned, so cancelling it cannot lose an answer anyone is
    // waiting for.
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(600_000);
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(2 * 300_000);
  });
});
