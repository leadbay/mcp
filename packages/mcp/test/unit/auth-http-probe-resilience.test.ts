// Resilience of the hosted auth probe loop (Codex review, PR #162).
//
// Two ways the candidate walk could strand a user with a perfectly good token:
//
//   1. A STALLED REGION. The probes run in sequence — each outcome decides
//      whether the next one is meaningful — and node:https has no default socket
//      timeout. A backend that accepts the connection and then goes silent would
//      hold the request open forever, so the sibling region that WOULD have
//      accepted the token is never asked.
//   2. AN AMBIGUOUS SUFFIX. `_us`/`_fr` is how a Stargate token names its region,
//      but a legacy opaque bearer can end in those two characters by coincidence.
//      Reading the suffix as a hard pin turns one 401 from the wrong region into
//      authState "expired", pushing that user through reauth on every request
//      until their token is rotated.
//
// The shared harness in ../harness.ts always answers, so it cannot express (1).
// This file ships a minimal node:https double that can hang a given number of
// leading requests, and records whether each request was actually destroyed —
// a deadline that only races a promise would leave the socket dangling.

import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    calls: [] as Array<{ host: string; destroyed: boolean }>,
    /** How many leading requests never answer at all (the stall). */
    hangFirst: 0,
    /** Scripted replies for the requests that DO answer, in order. */
    scripts: [] as Array<{ status: number; body: unknown }>,
  };

  const request = (options: { hostname?: string }, callback?: (res: unknown) => void) => {
    const idx = state.calls.length;
    const entry = { host: String(options.hostname ?? ""), destroyed: false };
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
        if (idx < state.hangFirst) return; // …silence. No response, no error, ever.
        const scripted = state.scripts[idx - state.hangFirst] ?? {
          status: 200,
          body: { id: "u1" },
        };
        const handlers: Record<string, Array<(...a: unknown[]) => void>> = {};
        const res = {
          statusCode: scripted.status,
          headers: {} as Record<string, string>,
          on(ev: string, cb: (...a: unknown[]) => void) {
            (handlers[ev] ??= []).push(cb);
            return this;
          },
        };
        const emit = (ev: string, ...a: unknown[]) =>
          (handlers[ev] ?? []).forEach((cb) => cb(...a));
        setTimeout(() => {
          callback?.(res);
          emit("data", Buffer.from(JSON.stringify(scripted.body), "utf8"));
          emit("end");
        }, 0);
      },
    };
  };

  return { state, request };
});

vi.mock("node:https", () => ({ default: { request: h.request }, request: h.request }));

import { resolveClientFromToken, PROBE_TIMEOUT_MS } from "../../src/auth-http.js";

const AUTH_401 = { status: 401, body: { error: true, code: "AUTH_EXPIRED", message: "nope" } };
const OK_200 = { status: 200, body: { id: "u1" } };

beforeEach(() => {
  h.state.calls = [];
  h.state.hangFirst = 0;
  h.state.scripts = [];
});

describe("auth probe — a stalled region cannot strand the request", () => {
  it("has a default deadline at all (the regression is an absent one)", () => {
    expect(PROBE_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("primary region hangs → deadline fires, sibling is still probed, token resolves", async () => {
    h.state.hangFirst = 1; // US accepts the connection and never answers
    h.state.scripts = [OK_200]; // FR is healthy and would accept this token
    const startedAt = Date.now();

    const result = await resolveClientFromToken("o.legacytoken", { probeTimeoutMs: 40 });

    expect(result.authState).toBe("ok");
    expect(result.client.region).toBe("fr"); // resolved against the region that answered
    expect(h.state.calls).toHaveLength(2); // the stall did NOT swallow the sibling probe
    expect(h.state.calls[0].host).toContain("api-us");
    expect(h.state.calls[1].host).toContain("api-fr");
    expect(Date.now() - startedAt).toBeLessThan(4000); // bounded, where it used to be infinite
  });

  it("cancels the stalled probe rather than abandoning the socket", async () => {
    h.state.hangFirst = 1;
    h.state.scripts = [OK_200];

    await resolveClientFromToken("o.legacytoken", { probeTimeoutMs: 40 });

    expect(h.state.calls[0].destroyed).toBe(true); // destroy(), not just a raced promise
    expect(h.state.calls[1].destroyed).toBe(false); // the healthy probe is left alone
  });

  it("every region dark → bounded, and ok rather than a spurious re-auth", async () => {
    h.state.hangFirst = 2; // both regions stall

    const result = await resolveClientFromToken("o.legacytoken", { probeTimeoutMs: 30 });

    // A timeout is a transient fault, not an auth verdict: we must not tell the
    // host to re-authenticate a token no backend ever actually judged.
    expect(result.authState).toBe("ok");
    expect(h.state.calls).toHaveLength(2);
    expect(h.state.calls.every((c) => c.destroyed)).toBe(true);
  });
});

describe("auth probe — a `_us`/`_fr` suffix is a hint, not a pin", () => {
  it("legacy token that merely LOOKS tagged → falls back to the sibling, not `expired`", async () => {
    // An opaque pre-Stargate bearer whose value happens to end in `_fr`, but whose
    // account lives in US. Reading the suffix as a pin reports it expired and the
    // user re-authenticates on every single request until the token rotates.
    h.state.scripts = [AUTH_401, OK_200];

    const result = await resolveClientFromToken("legacy-opaque-value_fr");

    expect(result.authState).toBe("ok");
    expect(result.client.region).toBe("us"); // bound where it actually validated
    expect(h.state.calls).toHaveLength(2);
    expect(h.state.calls[0].host).toContain("api-fr"); // suffix still decides the ORDER
    expect(h.state.calls[1].host).toContain("api-us");
  });

  it("genuinely expired tagged token → still `expired`, bound to the suffix region", async () => {
    h.state.scripts = [AUTH_401, AUTH_401]; // no region accepts it

    const result = await resolveClientFromToken("o.staletoken_fr");

    expect(result.authState).toBe("expired"); // drives the invalid_token challenge
    expect(result.client.region).toBe("fr"); // the suffix still names the owning backend
    expect(h.state.calls).toHaveLength(2); // asked both before passing that verdict
  });

  it("valid tagged token still costs exactly ONE probe — the fallback is failure-path only", async () => {
    h.state.scripts = [OK_200];

    const result = await resolveClientFromToken("o.goodtoken_fr");

    expect(result.authState).toBe("ok");
    expect(h.state.calls).toHaveLength(1); // no extra round trip on the happy path
    expect(h.state.calls[0].host).toContain("api-fr");
  });
});
