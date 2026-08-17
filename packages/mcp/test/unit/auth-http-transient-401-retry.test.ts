// A transient 401 on the owning region must not force a re-auth (Codex P1, PR #162).
//
// The probe loop runs with `retryOn401:false` for a good reason: an auto-retry
// would mask an auth rejection and break the dual-region fallback (a legacy FR
// token 401'ing on US must move to FR, not retry US and bind there). But a
// Leadbay 401 usually is NOT expiry. LeadbayClient carries a one-shot 401 retry
// precisely because "tokens don't expire, so a 401 is almost always a transient
// server-side blip" (client.ts, httpsRequestWithRetry).
//
// Without a retry somewhere, a blip cascades: the owning region 401s, the
// sibling 401s too (the token is region-scoped), both rejections look
// authoritative, and a perfectly valid token gets an `invalid_token` challenge.
// The pre-Stargate resolver used `resolveMe()`, which inherited the client's
// retry, so this was a regression rather than a pre-existing gap.
//
// The fix retries the PRIMARY region once AFTER the candidate walk. These tests
// pin both halves: the blip recovers, and a genuinely dead token is still
// reported expired (a retry that swallowed real expiry would be worse than the
// bug).
//
// Uses a local node:https double rather than ../harness.ts because the point is
// the ORDER and COUNT of raw requests, including the client's internal retry.

import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    calls: [] as Array<{ host: string }>,
    scripts: [] as Array<{ status: number; body: unknown }>,
  };

  const request = (options: { hostname?: string }, callback?: (res: unknown) => void) => {
    const idx = state.calls.length;
    state.calls.push({ host: String(options.hostname ?? "") });

    return {
      on() {
        return this;
      },
      write() {},
      destroy() {},
      end() {
        const scripted = state.scripts[idx] ?? { status: 200, body: { id: "u1" } };
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

import { resolveClientFromToken } from "../../src/auth-http.js";

const AUTH_401 = { status: 401, body: { error: true, code: "AUTH_EXPIRED", message: "nope" } };
const OK_200 = { status: 200, body: { id: "u1" } };
const FAULT_503 = { status: 503, body: { error: true, message: "backend down" } };

// A Stargate-tagged FR token: the suffix makes FR the owning/primary region.
const FR_TOKEN = "u.sometoken_fr";

const hosts = () => h.state.calls.map((c) => (c.host.includes("api-fr") ? "fr" : "us"));

beforeEach(() => {
  h.state.calls = [];
  h.state.scripts = [];
});

describe("transient 401 on the owning region", () => {
  it("recovers on the retry instead of emitting an expired challenge", async () => {
    // FR blips, US rejects it (region-scoped token), then the FR retry succeeds.
    // The client's own retry makes the last-chance step two raw requests.
    h.state.scripts = [AUTH_401, AUTH_401, AUTH_401, OK_200];

    const result = await resolveClientFromToken(FR_TOKEN, { probeTimeoutMs: 200 });

    expect(result.authState).toBe("ok");
    expect(result.client.region).toBe("fr");
    // fr (blip) → us (region-scoped reject) → fr retry (blip) → fr retry (200)
    expect(hosts()).toEqual(["fr", "us", "fr", "fr"]);
  });

  it("still reports a genuinely dead token as expired", async () => {
    // Every probe AND the retry reject: this really is expiry, and the host must
    // still get its invalid_token challenge.
    h.state.scripts = [AUTH_401, AUTH_401, AUTH_401, AUTH_401];

    const result = await resolveClientFromToken(FR_TOKEN, { probeTimeoutMs: 200 });

    expect(result.authState).toBe("expired");
    expect(hosts()).toEqual(["fr", "us", "fr", "fr"]);
  });

  it("treats a fault on the retry as transient, not as expiry", async () => {
    // The retry hits a 503 rather than a 401 — we can no longer be sure the token
    // is bad, so don't force re-auth. (503 is not a GET-401, so the client's
    // internal retry does not fire: one raw request.)
    h.state.scripts = [AUTH_401, AUTH_401, FAULT_503];

    const result = await resolveClientFromToken(FR_TOKEN, { probeTimeoutMs: 200 });

    expect(result.authState).toBe("ok");
    expect(hosts()).toEqual(["fr", "us", "fr"]);
  });

  it("costs nothing on the happy path", async () => {
    // The retry must live on the failure path only — a token the owning region
    // accepts still resolves in a single request.
    h.state.scripts = [OK_200];

    const result = await resolveClientFromToken(FR_TOKEN, { probeTimeoutMs: 200 });

    expect(result.authState).toBe("ok");
    expect(result.client.region).toBe("fr");
    expect(h.state.calls).toHaveLength(1);
  });

  it("does not spend a retry when the sibling already accepted the token", async () => {
    // The legacy-token fallback: US rejects, FR accepts. We return before the
    // last-chance step, so the extra round trip is never paid on this path.
    h.state.scripts = [AUTH_401, OK_200];

    const result = await resolveClientFromToken("o.legacytoken", { probeTimeoutMs: 200 });

    expect(result.authState).toBe("ok");
    expect(result.client.region).toBe("fr");
    expect(hosts()).toEqual(["us", "fr"]);
  });
});
