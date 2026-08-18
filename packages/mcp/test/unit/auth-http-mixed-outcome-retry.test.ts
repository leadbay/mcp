// The MIXED outcome: owning region blips 401 while the sibling faults
// (Codex P2 follow-up, PR #162).
//
// The first transient-401 fix gated its last-chance retry on
// `sawAuthReject && nonAuthFaultRegion === undefined` — i.e. "retry only if no
// sibling faulted". That gate was too narrow, and the case it missed fails
// silently rather than loudly:
//
//   owning region (from the token suffix) → transient 401
//   sibling region                       → timeout / 5xx
//
// `nonAuthFaultRegion` is set, so the retry was skipped, and the resolver then
// bound the client to the FAULTING SIBLING (the "bind to the transient-fault
// region" fallback). For a suffixed token that is the wrong backend entirely:
// no OAuth challenge is raised, the MCP request proceeds looking healthy, and
// every subsequent tool call 401s against a region the token was never scoped
// to. A silent wrong-region bind is worse than a challenge.
//
// The gate is now "did the PRIMARY auth-reject", so a recovered retry — positive
// evidence that the owning region does accept this token — wins over the
// transient-region fallback.

import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    calls: [] as Array<{ host: string }>,
    /** How many leading requests never answer at all (a stalled region). */
    hangFirst: 0,
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
        if (idx < state.hangFirst) return; // silence — models a stalled backend
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

import { resolveClientFromToken } from "../../src/auth-http.js";

const AUTH_401 = { status: 401, body: { error: true, code: "AUTH_EXPIRED", message: "nope" } };
const OK_200 = { status: 200, body: { id: "u1" } };
const FAULT_503 = { status: 503, body: { error: true, message: "backend down" } };

/** Stargate-tagged FR token → FR is the owning/primary region, US the sibling. */
const FR_TOKEN = "u.sometoken_fr";

const hosts = () => h.state.calls.map((c) => (c.host.includes("api-fr") ? "fr" : "us"));

beforeEach(() => {
  h.state.calls = [];
  h.state.hangFirst = 0;
  h.state.scripts = [];
});

describe("mixed outcome — owning region 401s, sibling faults", () => {
  it("still retries the owning region, and binds there on recovery", async () => {
    // fr blips 401 → us 503 (fault) → fr retried: 401 then 200.
    h.state.scripts = [AUTH_401, FAULT_503, AUTH_401, OK_200];

    const result = await resolveClientFromToken(FR_TOKEN, { probeTimeoutMs: 200 });

    expect(result.authState).toBe("ok");
    // The regression bound to "us" here — the sibling that faulted.
    expect(result.client.region).toBe("fr");
    expect(hosts()).toEqual(["fr", "us", "fr", "fr"]);
  });

  it("binds to the owning region, not the faulting sibling, when the retry also faults", async () => {
    // Both regions unproven: fr 401 then 503 on retry, us 503. Neither is
    // confirmed, so no challenge — but the token CLAIMS fr, so fr is the better
    // bind than a sibling that merely faulted first.
    h.state.scripts = [AUTH_401, FAULT_503, FAULT_503];

    const result = await resolveClientFromToken(FR_TOKEN, { probeTimeoutMs: 200 });

    expect(result.authState).toBe("ok"); // a fault is not an auth verdict
    expect(result.client.region).toBe("fr");
  });

  it("does not force re-auth when a fault could be masking a valid token", async () => {
    // fr 401 ×3 (probe + both retry attempts), us 503. The sibling fault means we
    // cannot call this expiry, so no invalid_token challenge.
    h.state.scripts = [AUTH_401, FAULT_503, AUTH_401, AUTH_401];

    const result = await resolveClientFromToken(FR_TOKEN, { probeTimeoutMs: 200 });

    expect(result.authState).toBe("ok");
  });

  it("leaves the all-regions-reject verdict intact", async () => {
    // No faults anywhere: every probe and the retry reject → genuinely expired.
    h.state.scripts = [AUTH_401, AUTH_401, AUTH_401, AUTH_401];

    const result = await resolveClientFromToken(FR_TOKEN, { probeTimeoutMs: 200 });

    expect(result.authState).toBe("expired");
    expect(result.client.region).toBe("fr");
  });

  it("does not retry when the primary never auth-rejected", async () => {
    // fr faults (no auth verdict), us auth-rejects. The primary was never
    // rejected, so there is no blip to retry — spending a request here would be
    // pure latency on an already-failing path.
    h.state.scripts = [FAULT_503, AUTH_401];

    const result = await resolveClientFromToken(FR_TOKEN, { probeTimeoutMs: 200 });

    expect(result.authState).toBe("ok"); // fr's fault could be masking validity
    expect(hosts()).toEqual(["fr", "us"]); // exactly two probes, no retry
  });

  it("leaves the UNTAGGED contract alone — no retry, sibling still wins", async () => {
    // Without a suffix, `primaryRegion` is only a guess (preferRegion, else US),
    // so a 401 there is NOT a blip on the owning backend and the retry must not
    // fire. The deliberate untagged behaviour stands: bind to the region that
    // merely FAULTED, never to the one that definitively rejected the token —
    // it may well be an FR token while FR is briefly down.
    h.state.scripts = [AUTH_401, FAULT_503];

    const result = await resolveClientFromToken("o.legacytoken", { probeTimeoutMs: 200 });

    expect(result.authState).toBe("ok");
    expect(result.client.region).toBe("fr"); // the faulting sibling, not rejecting US
    expect(hosts()).toEqual(["us", "fr"]); // exactly two probes — no retry spent
  });
});
