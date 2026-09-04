import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";

// Deliberately NOT the shared harness: its stub drops `options.signal` on the
// floor, so it cannot see this boundary. The merge that brought the hosted
// auth deadline (`timeoutMs`) alongside caller cancellation (`signal`) made
// them adjacent optional params of the same three functions — a swapped slot
// is exactly the kind of mistake that type-checks away but is worth pinning,
// because both are `undefined` on almost every call.
const captured: Array<Record<string, unknown>> = [];

vi.mock("node:https", () => ({
  default: {
    request: (options: Record<string, unknown>, cb?: (res: unknown) => void) => {
      captured.push(options);
      const req = new EventEmitter() as EventEmitter & {
        write: () => void;
        end: () => void;
        destroy: () => void;
      };
      req.write = () => {};
      req.destroy = () => {};
      req.end = () => {
        const res = new EventEmitter() as EventEmitter & {
          statusCode: number;
          headers: Record<string, string>;
        };
        res.statusCode = 200;
        res.headers = {};
        setImmediate(() => {
          cb?.(res);
          res.emit("data", Buffer.from(JSON.stringify({ ok: true })));
          res.emit("end");
        });
      };
      return req;
    },
  },
}));

import { LeadbayClient } from "../../src/client.js";

const newClient = () => new LeadbayClient("https://api-us.leadbay.app", "u.test-token", "us");

beforeEach(() => {
  captured.length = 0;
});

describe("client — AbortSignal reaches the https request options", () => {
  it("forwards the caller's signal onto the request, not into the deadline slot", async () => {
    const ac = new AbortController();
    await newClient().request("GET", "/users/me", undefined, { signal: ac.signal });

    expect(captured).toHaveLength(1);
    // The identity check is the point: if `signal` landed in the `timeoutMs`
    // position it would never appear here at all.
    expect(captured[0].signal).toBe(ac.signal);
  });

  it("omits signal when the caller passes none, without disturbing the request", async () => {
    await newClient().request("GET", "/users/me");

    expect(captured).toHaveLength(1);
    expect(captured[0].signal).toBeUndefined();
    expect(captured[0].method).toBe("GET");
  });

  it("carries the signal on write paths too", async () => {
    const ac = new AbortController();
    await newClient().request("POST", "/leads/search", { q: "x" }, { signal: ac.signal });

    expect(captured).toHaveLength(1);
    expect(captured[0].signal).toBe(ac.signal);
    expect(captured[0].method).toBe("POST");
  });
});
