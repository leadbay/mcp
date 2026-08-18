// LeadbayClient.request({ timeoutMs }) — the opt-in per-attempt deadline.
//
// node:https sets no socket timeout, so before this option a peer that completed
// the TCP handshake and then went silent left the promise pending forever. The
// hosted auth probe walks candidate regions in sequence and needs a bounded
// attempt; this pins the contract it relies on:
//   - the deadline rejects with a TIMEOUT code — deliberately NOT an auth code, so
//     a caller classifying failures reads it as transient and keeps going;
//   - it cancels the request rather than abandoning the socket behind a race;
//   - it is opt-in — a call without `timeoutMs` behaves exactly as before.
//
// The shared harness always answers, so it cannot express a stall. This file
// ships a minimal node:https double that can hang on demand.

import { describe, it, expect, beforeEach } from "vitest";
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

import { LeadbayClient } from "../../src/client.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => {
  h.state.calls = [];
  h.state.hang = false;
});

describe("LeadbayClient.request — timeoutMs", () => {
  it("a stalled response rejects at the deadline instead of hanging forever", async () => {
    h.state.hang = true;
    const startedAt = Date.now();

    await expect(
      newClient().request("GET", "/users/me", undefined, { retryOn401: false, timeoutMs: 40 })
    ).rejects.toMatchObject({ code: "TIMEOUT" });

    expect(Date.now() - startedAt).toBeLessThan(4000);
  });

  it("the deadline destroys the request — it does not leave the socket dangling", async () => {
    h.state.hang = true;

    await expect(
      newClient().request("GET", "/users/me", undefined, { retryOn401: false, timeoutMs: 40 })
    ).rejects.toThrow();

    expect(h.state.calls).toHaveLength(1);
    expect(h.state.calls[0].destroyed).toBe(true);
  });

  it("the TIMEOUT code is not an auth code — callers must read it as transient", async () => {
    h.state.hang = true;

    const err = await newClient()
      .request("GET", "/users/me", undefined, { retryOn401: false, timeoutMs: 40 })
      .catch((e: { code?: string }) => e);

    // The hosted auth resolver branches on these two; a timeout landing in that
    // branch would report a live token as expired and force a needless re-auth.
    expect((err as { code?: string }).code).not.toBe("AUTH_EXPIRED");
    expect((err as { code?: string }).code).not.toBe("NOT_AUTHENTICATED");
  });

  it("is opt-in — a call without timeoutMs is untouched", async () => {
    const result = await newClient().request<{ id: string }>("GET", "/users/me");
    expect(result.id).toBe("u1");
    expect(h.state.calls[0].destroyed).toBe(false);
  });

  it("a response that beats the deadline resolves normally and clears it", async () => {
    const result = await newClient().request<{ id: string }>("GET", "/users/me", undefined, {
      timeoutMs: 5000,
    });
    expect(result.id).toBe("u1");
    expect(h.state.calls[0].destroyed).toBe(false);
  });
});
