// A transient 401 must not expire an UNTAGGED (legacy) token either
// (Codex P1 follow-up, PR #162).
//
// The first transient-401 fix gated the last-chance retry on
// `suffixRegion !== undefined`, on the reasoning that for an untagged token
// `primaryRegion` is only a guess. True for the BIND decision — but it also
// suppressed the retry on the one path where the guess doesn't matter: both
// regions auth-rejected and nothing faulted, so we are about to emit an
// `invalid_token` challenge.
//
// The failure it left behind:
//
//   valid US legacy token → US 401 (transient blip) → FR 401 (region-scoped,
//   expected) → `expired` → needless reauth
//
// and the mirror, an FR legacy token blipping on FR. The two are
// indistinguishable from the outside, which is exactly why BOTH rejecting
// regions get the second look here. The pre-Stargate resolver probed both
// through `resolveMe()` and inherited the client's one-shot 401 retry on each,
// so this is a restoration, not new leniency.
//
// Cost: one extra request per rejecting region — the untagged retries pass
// `retryOn401:false`, so the client's internal double doesn't stack on top and
// the whole failure path stays at four requests.
//
// Local node:https double rather than ../harness.ts because the point is the
// ORDER and COUNT of raw requests.

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

/** No `_us`/`_fr` suffix → the legacy population this PR must not strand. */
const LEGACY_TOKEN = "o.legacytoken";

const hosts = () => h.state.calls.map((c) => (c.host.includes("api-fr") ? "fr" : "us"));

beforeEach(() => {
  h.state.calls = [];
  h.state.scripts = [];
});

describe("untagged token — transient 401 before an expiry verdict", () => {
  it("recovers when the blip was on the DEFAULT-FIRST region (US)", async () => {
    // us 401 (blip) → fr 401 (region-scoped, expected) → us retried → 200.
    h.state.scripts = [AUTH_401, AUTH_401, OK_200];

    const result = await resolveClientFromToken(LEGACY_TOKEN, { probeTimeoutMs: 200 });

    expect(result.authState).toBe("ok"); // was "expired" — a needless challenge
    expect(result.client.region).toBe("us");
    expect(hosts()).toEqual(["us", "fr", "us"]);
  });

  it("recovers when the blip was on the SIBLING region (the mirror case)", async () => {
    // A valid FR legacy token on the shared /mcp URL: us rejects it correctly,
    // fr blips, then the fr retry succeeds. Retrying only the primary would have
    // left this half of the legacy population reauthing.
    h.state.scripts = [AUTH_401, AUTH_401, AUTH_401, OK_200];

    const result = await resolveClientFromToken(LEGACY_TOKEN, { probeTimeoutMs: 200 });

    expect(result.authState).toBe("ok");
    expect(result.client.region).toBe("fr");
    expect(hosts()).toEqual(["us", "fr", "us", "fr"]);
  });

  it("still reports a genuinely dead legacy token as expired", async () => {
    // Every probe and every retry rejects. A retry that swallowed real expiry
    // would be worse than the bug it fixes — the host must still get its
    // invalid_token challenge.
    h.state.scripts = [AUTH_401, AUTH_401, AUTH_401, AUTH_401];

    const result = await resolveClientFromToken(LEGACY_TOKEN, { probeTimeoutMs: 200 });

    expect(result.authState).toBe("expired");
    expect(hosts()).toEqual(["us", "fr", "us", "fr"]); // bounded at four
  });

  it("honours preferRegion — the /fr/mcp alias retries FR first", async () => {
    // fr 401 (blip) → us 401 → fr retried → 200. The retry order follows the
    // candidate order, so an EU connector's blip is re-tested first.
    h.state.scripts = [AUTH_401, AUTH_401, OK_200];

    const result = await resolveClientFromToken(LEGACY_TOKEN, {
      preferRegion: "fr",
      probeTimeoutMs: 200,
    });

    expect(result.authState).toBe("ok");
    expect(result.client.region).toBe("fr");
    expect(hosts()).toEqual(["fr", "us", "fr"]);
  });

  it("does not stack the client's internal retry on top of ours", async () => {
    // The untagged retries pass retryOn401:false: each rejecting region gets ONE
    // extra request, not two. Four raw requests total, not six — the probes here
    // run in sequence, so an unbounded retry budget is latency the caller waits on.
    h.state.scripts = [AUTH_401, AUTH_401, AUTH_401, AUTH_401, OK_200, OK_200];

    const result = await resolveClientFromToken(LEGACY_TOKEN, { probeTimeoutMs: 200 });

    expect(result.authState).toBe("expired");
    expect(h.state.calls).toHaveLength(4);
  });

  it("spends nothing extra when a region merely faulted", async () => {
    // us rejects, fr faults → we are not about to challenge anyway (a fault could
    // be masking a valid token), and fr stays the better bind. No retry.
    h.state.scripts = [AUTH_401, FAULT_503];

    const result = await resolveClientFromToken(LEGACY_TOKEN, { probeTimeoutMs: 200 });

    expect(result.authState).toBe("ok");
    expect(result.client.region).toBe("fr"); // the faulting region, not the rejecting one
    expect(hosts()).toEqual(["us", "fr"]);
  });

  it("treats a fault on the retry as transient rather than expiry", async () => {
    // us 401 → fr 401 → us retry 503. Both regions are now unproven, so no
    // challenge; bind to the region that faulted, where the token may well be live.
    h.state.scripts = [AUTH_401, AUTH_401, FAULT_503, AUTH_401];

    const result = await resolveClientFromToken(LEGACY_TOKEN, { probeTimeoutMs: 200 });

    expect(result.authState).toBe("ok");
    expect(result.client.region).toBe("us");
  });

  it("costs nothing on the happy path", async () => {
    h.state.scripts = [OK_200];

    const result = await resolveClientFromToken(LEGACY_TOKEN, { probeTimeoutMs: 200 });

    expect(result.authState).toBe("ok");
    expect(h.state.calls).toHaveLength(1);
  });
});
