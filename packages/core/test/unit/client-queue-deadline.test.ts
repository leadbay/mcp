/**
 * `totalTimeoutMs` covers the queue wait. `timeoutMs` does not.
 *
 * A total used to start only when httpsRequest ran — i.e. after the semaphore
 * was acquired. Five slow or stalled unrelated requests therefore let a bounded
 * call sit in the queue without limit, so even `wait_seconds: 1` could exceed
 * its contract by minutes while every individual request looked well-behaved.
 * Time spent waiting for a slot is time the caller waited, so a TOTAL now
 * covers it.
 *
 * A per-attempt `timeoutMs` deliberately does not. Waiting for a slot is not an
 * attempt; nothing has been sent. The three callers that pass a bare
 * `timeoutMs` — `research_lead_by_name_fuzzy` at 10s against `/leads/resolve`,
 * the hosted auth probe, and the identity resolve on connect — all predate this
 * branch and none of them is bounded in the queue on `origin/main`. Bounding
 * them here would newly fail calls that main completes: `/leads/resolve` is
 * measured at up to 61.7s, so a burst of them makes the slot wait alone exceed
 * 10s. The split is pinned in
 * `client-per-attempt-does-not-bound-queue.test.ts`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";

const seen: Array<Record<string, unknown>> = [];
const pending: Array<() => void> = [];

vi.mock("node:https", () => ({
  default: {
    request: (options: Record<string, unknown>, cb?: (res: unknown) => void) => {
      seen.push(options);
      const req = new EventEmitter() as EventEmitter & {
        write: () => void;
        end: () => void;
        destroy: () => void;
      };
      req.write = () => {};
      req.destroy = () => {};
      req.end = () => {
        pending.push(() => {
          const res = new EventEmitter() as EventEmitter & {
            statusCode: number;
            headers: Record<string, string>;
          };
          res.statusCode = 200;
          res.headers = {};
          cb?.(res);
          res.emit("data", Buffer.from("{}"));
          res.emit("end");
        });
      };
      return req;
    },
  },
}));

import { LeadbayClient } from "../../src/client.js";

const MAX_CONCURRENT = 5;
const newClient = () => new LeadbayClient("https://api-us.leadbay.app", "u.tok", "us");
const settled = () => new Promise((r) => setImmediate(r));
const flush = () => pending.splice(0).forEach((f) => f());
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  seen.length = 0;
  pending.length = 0;
});

describe("the request deadline covers the queue wait", () => {
  it("expires a queued call instead of stranding it behind stalled traffic", async () => {
    const client = newClient();
    const stalled = Array.from({ length: MAX_CONCURRENT }, () =>
      client.request("GET", "/stalled").catch(() => {})
    );
    await settled();
    expect(client._semaphoreState.active).toBe(MAX_CONCURRENT);
    seen.length = 0;

    // Bounded call, no slot available, and nothing will free one. A TOTAL is
    // what the job poll passes (`totalTimeoutMs: remaining()`), and it is what
    // has to cover the queue.
    const bounded = client.request("GET", "/mcp/jobs/j1", undefined, {
      totalTimeoutMs: 60,
    });

    await expect(bounded).rejects.toMatchObject({ code: "TIMEOUT" });
    // It never reached the wire — the deadline was enforced while queued.
    expect(seen).toHaveLength(0);
    // And it left the queue clean rather than lingering as a dead waiter.
    expect(client._semaphoreState.queued).toBe(0);
    expect(client._semaphoreState.active).toBe(MAX_CONCURRENT);

    flush();
    await Promise.all(stalled);
    expect(client._semaphoreState.active).toBe(0);
  });

  it("refuses a budget spent in the queue without ever reaching the wire", async () => {
    // This case used to pass `timeoutMs: 0` as shorthand for "already spent".
    // That shorthand is no longer available: since the default request deadline
    // landed, an explicit `timeoutMs <= 0` is the caller OPTING OUT of a bound
    // (client-default-request-deadline.test.ts pins it), so the two readings of
    // the same value collided. The behaviour under test is unchanged — a budget
    // that really has run out must refuse before dispatch — so it is now
    // exercised by letting the budget expire during the queue wait, which is
    // also how it actually happens.
    const client = newClient();
    const stalled = Array.from({ length: MAX_CONCURRENT }, () =>
      client.request("GET", "/stalled").catch(() => {})
    );
    await settled();
    seen.length = 0;

    const bounded = client
      .request("GET", "/mcp/jobs/j1", undefined, { totalTimeoutMs: 50 })
      .catch((e) => e);

    // Outlive the budget while every slot is still held.
    await wait(120);
    flush();
    await Promise.all(stalled);

    expect(await bounded).toMatchObject({ code: "TIMEOUT" });
    // The point of the assertion: nothing was sent, so nothing could have been
    // charged or committed server-side.
    expect(seen).toHaveLength(0);
    expect(client._semaphoreState.active).toBe(0);
  });

  it("charges queue time against a TOTAL budget rather than restarting it", async () => {
    const client = newClient();
    const stalled = Array.from({ length: MAX_CONCURRENT }, () =>
      client.request("GET", "/stalled").catch(() => {})
    );
    await settled();
    seen.length = 0;

    const startedAt = Date.now();
    // 300ms TOTAL. ~200ms of it will be spent queued; the socket must inherit
    // only what is LEFT. (`timeoutMs` is the other knob — a per-attempt bound —
    // and is asserted separately below.)
    const bounded = client
      .request("GET", "/mcp/jobs/j1", undefined, { totalTimeoutMs: 300 })
      .catch((e) => e);

    await wait(200);
    // Free every slot. `bounded` acquires and dispatches — and is never
    // answered, so its socket deadline decides when it fails.
    flush();
    const err = await bounded;
    const elapsed = Date.now() - startedAt;

    expect(err).toMatchObject({ code: "TIMEOUT" });
    // A restarted clock would give it a fresh 300ms after acquiring, landing
    // near 500ms. Spending the remaining ~100ms lands near 300ms.
    expect(elapsed).toBeLessThan(450);
    await Promise.all(stalled);
  });

  it("does NOT bound the queue wait with the per-attempt knob", async () => {
    // `timeoutMs` gives each ATTEMPT its own window — the hosted auth probe
    // needs that, since its 401 backoff outlasts its probe budget. Waiting for
    // a slot is not an attempt, and on `origin/main` acquireSemaphore takes no
    // deadline at all, so bounding it here would newly fail calls that main
    // completes. The queued call must survive and then get its own window.
    const client = newClient();
    const stalled = Array.from({ length: MAX_CONCURRENT }, () =>
      client.request("GET", "/stalled").catch(() => {})
    );
    await settled();
    seen.length = 0;

    const queued = client
      .request("GET", "/leads/resolve", undefined, { timeoutMs: 60 })
      .then(
        () => "resolved",
        (e) => e
      );

    // Outlive the per-attempt budget while every slot is still held.
    await wait(150);
    expect(seen).toHaveLength(0);
    expect(client._semaphoreState.queued).toBe(1);

    // Free the slots. The call dispatches and answers.
    flush();
    await settled();
    flush();
    expect(await queued).toBe("resolved");

    await Promise.all(stalled);
  });

  it("leaves unbounded calls unbounded", async () => {
    const client = newClient();
    const p = client.request("GET", "/mcp/jobs/j1");
    await settled();
    expect(seen).toHaveLength(1);
    expect(seen[0].signal).toBeUndefined();
    flush();
    await p;
  });
});
