// A suffix must not become an ownership claim on the expiry path
// (Codex P2 follow-up, PR #162).
//
// The probe loop treats `_us`/`_fr` as a HINT: a legacy opaque bearer can end in
// those two characters by coincidence, so the sibling is probed before anything
// is declared expired. The first transient-401 fix then contradicted that one
// step later — it retried only the suffix region, so:
//
//   legacy US bearer ending in `_fr`
//     → FR 401  (a legitimate rejection: FR never issued this token)
//     → US 401  (a transient blip on the backend that actually owns it)
//     → retry FR only → 401 → `expired` on a perfectly live token
//
// Provenance is ambiguous exactly when every candidate rejected, so on that path
// every rejecting region is re-tested, suffix or no suffix. The suffix keeps its
// weight where it is evidence rather than a guess: probe order, bind region, and
// the mixed-outcome retry (pinned in auth-http-mixed-outcome-retry.test.ts).

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

/** A legacy US bearer whose opaque value merely ENDS in `_fr`. */
const LOOKS_TAGGED = "legacy-opaque-value_fr";

const hosts = () => h.state.calls.map((c) => (c.host.includes("api-fr") ? "fr" : "us"));

beforeEach(() => {
  h.state.calls = [];
  h.state.scripts = [];
});

describe("suffix-looking legacy token, blip on the real owner", () => {
  it("retries the sibling too, and resolves instead of expiring", async () => {
    // fr 401 (legitimate) → us 401 (blip) → fr retry 401 → us retry 200.
    h.state.scripts = [AUTH_401, AUTH_401, AUTH_401, OK_200];

    const result = await resolveClientFromToken(LOOKS_TAGGED, { probeTimeoutMs: 200 });

    expect(result.authState).toBe("ok"); // was "expired" — a live token forced through reauth
    expect(result.client.region).toBe("us"); // bound to the region that accepted it
    expect(hosts()).toEqual(["fr", "us", "fr", "us"]);
  });

  it("recovers on the suffix region's own retry without spending the sibling's", async () => {
    // The genuinely-tagged case still short-circuits: fr blips, fr retry answers.
    h.state.scripts = [AUTH_401, AUTH_401, OK_200];

    const result = await resolveClientFromToken(LOOKS_TAGGED, { probeTimeoutMs: 200 });

    expect(result.authState).toBe("ok");
    expect(result.client.region).toBe("fr");
    expect(hosts()).toEqual(["fr", "us", "fr"]); // stops at the first recovery
  });

  it("still expires when both regions reject on the retry as well", async () => {
    h.state.scripts = [AUTH_401, AUTH_401, AUTH_401, AUTH_401];

    const result = await resolveClientFromToken(LOOKS_TAGGED, { probeTimeoutMs: 200 });

    expect(result.authState).toBe("expired");
    expect(result.client.region).toBe("fr"); // the challenge names the claimed region
    expect(h.state.calls).toHaveLength(4); // bounded: two probes, two retries
  });

  it("costs nothing when the suffix region accepts the token", async () => {
    h.state.scripts = [OK_200];

    const result = await resolveClientFromToken(LOOKS_TAGGED, { probeTimeoutMs: 200 });

    expect(result.authState).toBe("ok");
    expect(h.state.calls).toHaveLength(1);
  });
});
