/**
 * The 401 retry is the only path that hands its semaphore slot back mid-request
 * and then tries to take it again. That makes "does this call still hold a
 * slot?" a variable rather than a constant, and it is the one place where an
 * abortable re-acquisition can corrupt the counter: if re-acquisition rejects,
 * the caller's `finally` must NOT release a slot it no longer owns.
 *
 * Drift here is permanent and one-directional — every occurrence costs the
 * client another slot until it can serve nothing at all.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";

let nextStatus = 200;
const pending: Array<() => void> = [];

vi.mock("node:https", () => ({
  default: {
    request: (_o: Record<string, unknown>, cb?: (res: unknown) => void) => {
      const status = nextStatus;
      const req = new EventEmitter() as EventEmitter & {
        write: () => void;
        end: () => void;
        destroy: () => void;
      };
      req.write = () => {};
      req.destroy = () => {};
      req.end = () => {
        const finish = () => {
          const res = new EventEmitter() as EventEmitter & {
            statusCode: number;
            headers: Record<string, string>;
          };
          res.statusCode = status;
          res.headers = {};
          cb?.(res);
          res.emit("data", Buffer.from("{}"));
          res.emit("end");
        };
        // A 401 answers at once so the retry path is entered; everything else
        // parks, so the test controls when slots free up.
        if (status === 401) setImmediate(finish);
        else pending.push(finish);
      };
      return req;
    },
  },
}));

import { LeadbayClient } from "../../src/client.js";

const MAX_CONCURRENT = 5;
const newClient = () => new LeadbayClient("https://api-us.leadbay.app", "u.tok", "us");
const settled = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  nextStatus = 200;
  pending.length = 0;
});

describe("401 retry — slot accounting survives an abort during the backoff", () => {
  it("does not release a slot it failed to re-acquire", async () => {
    const client = newClient();

    // A GET that 401s: it releases its slot and enters the 250ms backoff.
    nextStatus = 401;
    const ac = new AbortController();
    const retrying = client
      .request("GET", "/users/me", undefined, { signal: ac.signal })
      .catch(() => "rejected");
    await settled();

    // While it is backing off, unrelated traffic takes every slot, so its
    // re-acquisition will have to queue.
    nextStatus = 200;
    const stalled = Array.from({ length: MAX_CONCURRENT }, () =>
      client.request("GET", "/stalled").catch(() => {})
    );
    await settled();
    expect(client._semaphoreState.active).toBe(MAX_CONCURRENT);

    // Cancel while it is queued for its slot back.
    ac.abort();
    await retrying;

    // THE ASSERTION: the five stalled requests still hold exactly five slots.
    // Releasing unconditionally in the caller's `finally` would decrement one
    // of THEIR slots — the counter drifts to 4 and one slot is gone for good.
    expect(client._semaphoreState.active).toBe(MAX_CONCURRENT);
    expect(client._semaphoreState.queued).toBe(0);

    pending.splice(0).forEach((f) => f());
    await Promise.all(stalled);
    expect(client._semaphoreState.active).toBe(0);
  });
});
