// product#4003, primary mechanism — a cancelled tool call cancels its sockets.
//
// A wall-clock deadline can't be the answer to "the backend stalled", because
// picking its value means asserting how long Leadbay may legitimately take, and
// this product runs work that takes minutes on purpose. The bound that IS
// legitimate already exists and belongs to someone else: the MCP host aborts the
// handler's AbortSignal on `notifications/cancelled`, which the SDK sends both
// when the user cancels and when its OWN request timeout fires.
//
// server.ts forwarded that signal to ToolContext.signal, so composites stopped
// polling — but the HTTP request in flight at that moment kept running and kept
// its MAX_CONCURRENT slot. The host could give up in 60 seconds and the socket
// behind it would still be pinning a slot hours later. That is the deadlock the
// incident actually was.
//
// `runWithRequestSignal` makes the signal ambient, so all 174 existing
// `client.request(...)` call sites inherit it without an argument.
//
// Mid-flight abort is GET-ONLY, reusing the predicate httpsRequestWithRetry
// already applies to replay. A write may have committed server-side before we
// destroyed the socket, so reporting CANCELLED on it makes the agent tell the
// user their note wasn't sent when it IS in the CRM, or write it twice.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { vi } from "vitest";
import { getEventListeners } from "node:events";

const h = vi.hoisted(() => {
  const state = {
    calls: [] as Array<{ destroyed: boolean; path: string }>,
    hang: false,
  };

  const request = (options: any, callback?: (res: unknown) => void) => {
    const entry = { destroyed: false, path: options?.path ?? "/" };
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

import { LeadbayClient, runWithRequestSignal } from "../../src/client.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

let savedEnv: string | undefined;

beforeEach(() => {
  h.state.calls = [];
  h.state.hang = false;
  savedEnv = process.env.LEADBAY_TIMEOUT_MS;
  // Disable the backstop entirely. Every assertion below must be produced by
  // cancellation alone — if a deadline could rescue the test it proves nothing.
  process.env.LEADBAY_TIMEOUT_MS = "0";
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.LEADBAY_TIMEOUT_MS;
  else process.env.LEADBAY_TIMEOUT_MS = savedEnv;
});

describe("cancellation reaches the socket", () => {
  it("aborting the ambient signal destroys the in-flight request", async () => {
    h.state.hang = true;
    const ac = new AbortController();
    const client = newClient();

    const inflight = runWithRequestSignal(ac.signal, () =>
      client.request("GET", "/campaigns").catch((e) => e)
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(h.state.calls[0].destroyed).toBe(false);

    ac.abort();
    const err: any = await inflight;

    expect(h.state.calls[0].destroyed).toBe(true);
    expect(err.code).toBe("CANCELLED");
    // Composites already branch on `name === "AbortError"` to tell a user
    // cancellation from a real failure; keep that working.
    expect(err.name).toBe("AbortError");
  });

  it("cancellation frees the concurrency slots — the deadlock, closed", async () => {
    h.state.hang = true;
    const ac = new AbortController();
    const client = newClient();

    // Twelve concurrent calls against five slots: burst 1 of the incident.
    const inflight = runWithRequestSignal(ac.signal, () =>
      Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          client.request("GET", `/campaigns?p=${i}`).catch(() => "cancelled")
        )
      )
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(client._semaphoreState.active).toBe(5);

    ac.abort();
    expect(await inflight).toEqual(Array(12).fill("cancelled"));
    expect(client._semaphoreState).toEqual({ active: 0, queued: 0 });

    // The client is immediately usable again — with the backstop switched off,
    // only cancellation can have achieved that.
    h.state.hang = false;
    await expect(
      runWithRequestSignal(undefined, () =>
        client.request<{ id: string }>("GET", "/users/me")
      )
    ).resolves.toMatchObject({ id: "u1" });
  });

  it("an already-aborted signal opens no socket at all", async () => {
    const ac = new AbortController();
    ac.abort();

    const err: any = await runWithRequestSignal(ac.signal, () =>
      newClient().request("GET", "/campaigns").catch((e) => e)
    );

    expect(err.code).toBe("CANCELLED");
    expect(h.state.calls).toHaveLength(0);
  });

  it("one tool call's cancellation cannot touch another's socket", async () => {
    h.state.hang = true;
    const a = new AbortController();
    const b = new AbortController();
    const client = newClient();

    const callA = runWithRequestSignal(a.signal, () =>
      client.request("GET", "/a").catch(() => "a-cancelled")
    );
    const callB = runWithRequestSignal(b.signal, () =>
      client.request("GET", "/b").catch(() => "b-cancelled")
    );
    await new Promise((r) => setTimeout(r, 10));

    a.abort();
    expect(await callA).toBe("a-cancelled");

    const pathA = h.state.calls.find((c) => c.path.endsWith("/a"))!;
    const pathB = h.state.calls.find((c) => c.path.endsWith("/b"))!;
    expect(pathA.destroyed).toBe(true);
    expect(pathB.destroyed).toBe(false);

    b.abort();
    expect(await callB).toBe("b-cancelled");
  });

  it("no ambient signal — a request outside a tool call still works", async () => {
    // Telemetry identity and the hosted SSE refresh run outside any tool
    // invocation. They must not break for want of a store.
    await expect(
      newClient().request<{ id: string }>("GET", "/users/me")
    ).resolves.toMatchObject({ id: "u1" });
  });

  it("an in-flight WRITE is NOT aborted — it may already have committed", async () => {
    h.state.hang = true;
    const ac = new AbortController();
    const client = newClient();

    let settled = false;
    void runWithRequestSignal(ac.signal, () =>
      client
        .requestVoid("POST", "/leads/l1/notes", { note: "called them" })
        .then(
          () => (settled = true),
          () => (settled = true)
        )
    );
    await new Promise((r) => setTimeout(r, 10));

    ac.abort();
    await new Promise((r) => setTimeout(r, 50));

    // Still running, socket intact, slot still held — deliberately. Telling the
    // agent CANCELLED here would misreport a note that may already be written.
    expect(settled).toBe(false);
    expect(h.state.calls[0].destroyed).toBe(false);
    expect(client._semaphoreState.active).toBe(1);
  });

  it("a write cancelled BEFORE it is sent is still refused — nothing committed yet", async () => {
    const ac = new AbortController();
    ac.abort();

    const err: any = await runWithRequestSignal(ac.signal, () =>
      newClient()
        .requestVoid("POST", "/leads/l1/notes", { note: "x" })
        .catch((e) => e)
    );

    expect(err.code).toBe("CANCELLED");
    expect(h.state.calls).toHaveLength(0);
  });

  it("a settled request leaves no abort listener behind on a long-lived signal", async () => {
    // One bulk_qualify can issue hundreds of requests against ONE signal. If the
    // listener isn't removed on settle they accumulate and Node warns about a
    // leak — and the signal keeps every dead request's closure alive.
    const ac = new AbortController();
    const client = newClient();

    await runWithRequestSignal(ac.signal, async () => {
      for (let i = 0; i < 30; i++) {
        await client.request("GET", `/campaigns?p=${i}`);
      }
    });

    expect(h.state.calls).toHaveLength(30);
    expect(getEventListeners(ac.signal, "abort")).toHaveLength(0);
  });
});
