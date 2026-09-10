/**
 * `timeoutMs` bounds an attempt. It must not bound the wait for a slot.
 *
 * `request()` accepts two knobs and documents them as different things:
 * `timeoutMs` bounds a single ATTEMPT, `totalTimeoutMs` bounds the WHOLE call
 * including the queue wait. Waiting for a concurrency slot is not an attempt —
 * nothing has been sent when it happens.
 *
 * Feeding the per-attempt budget to `acquireSemaphore` newly failed calls that
 * `origin/main` completes, and there is a real caller: `research_lead_by_name_fuzzy`
 * passes `timeoutMs: 10_000` to `POST /leads/resolve`, an endpoint measured at up
 * to 61.7s. With MAX_CONCURRENT in flight its slot wait alone can pass 10s, and
 * on main `acquireSemaphore()` takes no deadline and cannot expire.
 *
 * Local node:https mock: the behaviour under test is a stall, and the shared
 * harness answers instantly.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";

const pending: Array<() => void> = [];
const seen: string[] = [];

vi.mock("node:https", () => ({
  default: {
    request: (options: Record<string, unknown>, cb?: (res: unknown) => void) => {
      seen.push(String(options.path ?? ""));
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
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  pending.length = 0;
  seen.length = 0;
});

describe("the queue wait is bounded by totalTimeoutMs, never by timeoutMs", () => {
  it("a per-attempt budget does not expire a queued call", async () => {
    const client = newClient();
    const stalled = Array.from({ length: MAX_CONCURRENT }, () =>
      client.request("GET", "/stalled").catch(() => {})
    );
    await settled();
    seen.length = 0;

    // 40ms per ATTEMPT. The slot does not free for 150ms.
    const queued = client
      .request("GET", "/leads/resolve", undefined, { timeoutMs: 40 })
      .then(
        () => "resolved",
        (e) => e
      );

    await wait(150);
    // Nothing was sent while it waited, so nothing could have timed out yet.
    expect(seen).toHaveLength(0);

    // Free the slots; the queued call now gets its own 40ms attempt.
    pending.splice(0).forEach((f) => f());
    await settled();
    pending.splice(0).forEach((f) => f());

    expect(await queued).toBe("resolved");
    await Promise.all(stalled);
  });

  it("a TOTAL budget still expires a queued call", async () => {
    const client = newClient();
    const stalled = Array.from({ length: MAX_CONCURRENT }, () =>
      client.request("GET", "/stalled").catch(() => {})
    );
    await settled();
    seen.length = 0;

    const err: any = await client
      .request("GET", "/mcp/jobs/j1", undefined, { totalTimeoutMs: 60 })
      .catch((e) => e);

    expect(err?._meta?.timeout_ms).toBe(60);
    // The point of a total: it refuses before anything reaches the wire.
    expect(seen).toHaveLength(0);

    pending.splice(0).forEach((f) => f());
    await Promise.all(stalled);
  });

  it("both knobs together: the total bounds the queue, the attempt bounds the socket", async () => {
    const client = newClient();
    const stalled = Array.from({ length: MAX_CONCURRENT }, () =>
      client.request("GET", "/stalled").catch(() => {})
    );
    await settled();
    seen.length = 0;

    // A generous total and a tight attempt: the call must survive the queue.
    const queued = client
      .request("GET", "/leads/resolve", undefined, {
        timeoutMs: 40,
        totalTimeoutMs: 5_000,
      })
      .then(
        () => "resolved",
        (e) => e
      );

    await wait(120);
    expect(seen).toHaveLength(0);

    pending.splice(0).forEach((f) => f());
    await settled();
    pending.splice(0).forEach((f) => f());

    expect(await queued).toBe("resolved");
    await Promise.all(stalled);
  });
});
