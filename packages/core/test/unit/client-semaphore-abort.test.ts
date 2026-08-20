import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";

// Own node:https double: this suite needs requests that never answer, so it can
// occupy every concurrency slot and inspect what a queued caller does. The
// shared harness always responds on setImmediate, which is precisely the case
// that hides this bug.
const open: Array<() => void> = [];

vi.mock("node:https", () => ({
  default: {
    request: (_options: Record<string, unknown>, cb?: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        write: () => void;
        end: () => void;
        destroy: () => void;
      };
      req.write = () => {};
      req.destroy = () => {};
      req.end = () => {
        // Park it. `open` holds the completion trigger so the test decides when
        // (or whether) a slot is ever given back.
        open.push(() => {
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
const newClient = () => new LeadbayClient("https://api-us.leadbay.app", "u.test-token", "us");

beforeEach(() => {
  open.length = 0;
});

const settled = () => new Promise((r) => setImmediate(r));

describe("client — a cancelled call queued on the semaphore does not wait for unrelated traffic", () => {
  it("rejects the queued waiter on abort instead of blocking until a slot frees", async () => {
    const client = newClient();
    // Occupy every slot with requests that never answer.
    const stalled = Array.from({ length: MAX_CONCURRENT }, () =>
      client.request("GET", "/stalled").catch(() => {})
    );
    await settled();
    expect(client._semaphoreState.active).toBe(MAX_CONCURRENT);

    const ac = new AbortController();
    const queued = client.request("GET", "/users/me", undefined, { signal: ac.signal });
    await settled();
    expect(client._semaphoreState.queued).toBe(1);

    ac.abort();

    // The point of the test: this resolves while all five slots are STILL held.
    await expect(queued).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(client._semaphoreState.active).toBe(MAX_CONCURRENT);
    void stalled;
  });

  it("removes the cancelled waiter from the queue, so no slot is leaked", async () => {
    const client = newClient();
    const stalled = Array.from({ length: MAX_CONCURRENT }, () =>
      client.request("GET", "/stalled").catch(() => {})
    );
    await settled();

    const ac = new AbortController();
    const queued = client.request("GET", "/users/me", undefined, { signal: ac.signal });
    await settled();
    ac.abort();
    await expect(queued).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });

    // A tombstoned (rather than spliced) waiter would still be shifted here,
    // taking the ++ and resolving nobody — one slot lost per cancellation.
    expect(client._semaphoreState.queued).toBe(0);

    open.forEach((finish) => finish());
    await Promise.all(stalled);
    expect(client._semaphoreState.active).toBe(0);
    expect(client._semaphoreState.queued).toBe(0);
  });

  it("refuses an already-aborted signal without taking a slot at all", async () => {
    const client = newClient();
    const ac = new AbortController();
    ac.abort();

    await expect(
      client.request("GET", "/users/me", undefined, { signal: ac.signal })
    ).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(client._semaphoreState.active).toBe(0);
  });
});
