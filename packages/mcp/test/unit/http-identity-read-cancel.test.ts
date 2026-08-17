// The hosted identity reads must cancel, not just stop being awaited
// (Codex P1 follow-up, PR #162).
//
// Both hosted handlers resolve a telemetry identity per request, and the SSE
// path refreshes the opt-out preference per message. Each of those gives up on
// its read after IDENTITY_RESOLVE_TIMEOUT_MS — but giving up on a promise leaves
// the HTTPS request running, and node:https never times a socket out on its own.
//
// The compounding case is the one this PR created a path to: when both auth
// probes time out, `resolveClientFromToken` deliberately returns `ok` with a
// live (unseeded) client rather than forcing re-auth, so during a silent
// regional outage every authenticated request reaches this code and starts a
// read that never ends. The core-level contract is pinned in
// core/test/unit/client-identity-read-deadline.test.ts; this file pins that the
// hosted call sites actually pass the deadline down.

import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    calls: [] as Array<{ destroyed: boolean }>,
    /** When true the backend accepts the connection and then says nothing. */
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
            cb(
              Buffer.from(
                JSON.stringify({ id: "u1", email: "a@b.co", telemetry_enabled: true }),
                "utf8"
              )
            )
          );
          (handlers["end"] ?? []).forEach((cb) => cb());
        }, 0);
      },
    };
  };

  return { state, request };
});

vi.mock("node:https", () => ({ default: { request: h.request }, request: h.request }));

import { createClient } from "@leadbay/core";
import { resolveIdentity, scheduleSseTelemetryRefresh } from "../../src/http-server.js";

const newClient = () => createClient({ token: "u.test-token", region: "us" });

beforeEach(() => {
  h.state.calls = [];
  h.state.hang = false;
});

describe("hosted identity resolve — a stalled /users/me is cancelled", () => {
  // The caller's race and the request's deadline are both IDENTITY_RESOLVE_TIMEOUT_MS
  // (1.5s, not injectable here), so these wait it out and then let the deadline's
  // own timer land before asserting.
  const settle = () => new Promise((r) => setTimeout(r, 100));

  it("attributes to mcp:unknown AND destroys the abandoned request", async () => {
    h.state.hang = true;
    const client = newClient();

    const identity = await resolveIdentity(client);
    await settle();

    // Fail-closed attribution is the pre-existing contract and still holds…
    expect(identity.distinctId).toBe("mcp:unknown");
    // …but the request behind it is no longer left running.
    expect(h.state.calls).toHaveLength(1);
    expect(h.state.calls[0].destroyed).toBe(true);
    expect(client._semaphoreState.active).toBe(0);
  }, 10_000);

  it("does not accumulate live requests across repeated stalled resolves", async () => {
    // One per authenticated request during a silent outage — the shape that
    // exhausts the hosted process. Run concurrently, which is also how they'd
    // arrive.
    h.state.hang = true;

    await Promise.all([newClient(), newClient(), newClient(), newClient()].map(resolveIdentity));
    await settle();

    expect(h.state.calls).toHaveLength(4);
    expect(h.state.calls.every((c) => c.destroyed)).toBe(true);
  }, 10_000);

  it("leaves the healthy path alone", async () => {
    const identity = await resolveIdentity(newClient());

    expect(identity.distinctId).toBe("a@b.co");
    expect(h.state.calls[0].destroyed).toBe(false);
  });
});

describe("SSE telemetry refresh — a stalled preference read is cancelled", () => {
  it("destroys the read it stopped waiting for", async () => {
    h.state.hang = true;
    const client = newClient();
    const session = {
      client,
      suppressed: false,
      forceClosed: false,
      refreshPending: false,
      refreshing: false,
      refreshEpoch: 0,
    };

    scheduleSseTelemetryRefresh(session as never, 0, 30);

    await new Promise((r) => setTimeout(r, 120));

    expect(session.forceClosed).toBe(true); // unreadable preference → fail closed
    expect(h.state.calls).toHaveLength(1);
    expect(h.state.calls[0].destroyed).toBe(true);
    // The guard the refresh holds until the read releases its slot is now
    // reachable — before the deadline it never was.
    expect(client._semaphoreState.active).toBe(0);
    expect(session.refreshing).toBe(false);
  });
});
