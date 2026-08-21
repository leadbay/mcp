/**
 * `timeoutMs` and `totalTimeoutMs` answer different questions, and the 401
 * retry is where the difference bites.
 *
 *   timeoutMs      — bounds ONE attempt. The hosted auth probe needs this: its
 *                    250ms 401-backoff outlasts a 200ms probe budget, so a
 *                    retry charged against the first attempt's clock is deleted
 *                    rather than bounded.
 *   totalTimeoutMs — bounds the WHOLE call, backoff and retry included. A job
 *                    poll needs this: a transient 401 must not buy it a second
 *                    full wait_seconds on top of the one it already spent.
 *
 * Before they were separated, one knob had to be both, and whichever behaviour
 * it picked was wrong for the other caller.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";

let status = 200;
const calls: number[] = [];

vi.mock("node:https", () => ({
  default: {
    request: (_o: Record<string, unknown>, cb?: (res: unknown) => void) => {
      calls.push(Date.now());
      const s = status;
      const req = new EventEmitter() as EventEmitter & {
        write: () => void;
        end: () => void;
        destroy: () => void;
      };
      req.write = () => {};
      req.destroy = () => {};
      req.end = () => {
        setImmediate(() => {
          const res = new EventEmitter() as EventEmitter & {
            statusCode: number;
            headers: Record<string, string>;
          };
          res.statusCode = s;
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

const newClient = () => new LeadbayClient("https://api-us.leadbay.app", "u.tok", "us");

beforeEach(() => {
  status = 200;
  calls.length = 0;
});

describe("401 retry and the two budget knobs", () => {
  it("a per-attempt budget survives the 250ms backoff and retries", async () => {
    status = 401;
    // 200ms per attempt, backoff 250ms: the retry only happens if its window
    // starts after the sleep. This is the auth-probe contract.
    await newClient()
      .request("GET", "/users/me", undefined, { timeoutMs: 200 })
      .catch(() => {});
    expect(calls).toHaveLength(2);
  });

  it("a TOTAL budget refuses to fund a second attempt it cannot afford", async () => {
    status = 401;
    const startedAt = Date.now();
    const err = await newClient()
      .request("GET", "/users/me", undefined, { totalTimeoutMs: 200 })
      .catch((e) => e);

    expect(err).toMatchObject({ code: "TIMEOUT" });
    // The first attempt happened; the retry did not, because the 250ms backoff
    // already exhausted the caller's whole 200ms.
    expect(calls).toHaveLength(1);
    // And it did not silently run on to a second full budget.
    expect(Date.now() - startedAt).toBeLessThan(400);
  });

  it("honours both at once — whichever expires first wins", async () => {
    status = 401;
    await newClient()
      .request("GET", "/users/me", undefined, { timeoutMs: 200, totalTimeoutMs: 5000 })
      .catch(() => {});
    // Generous total, per-attempt window fresh after the backoff → retry runs.
    expect(calls).toHaveLength(2);
  });

  it("leaves a call with neither knob unbounded", async () => {
    status = 401;
    await newClient().request("GET", "/users/me").catch(() => {});
    expect(calls).toHaveLength(2);
  });
});
