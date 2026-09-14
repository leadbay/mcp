/**
 * A TIMEOUT envelope must report the deadline that actually expired.
 *
 * `mapTransportError` reads `timeout_ms ?? defaultTimeoutMs()`. The socket path
 * set that property; the QUEUE path (acquireSemaphore) and the budget helpers
 * raised a bare `timeoutError` with only `code`. So a 30-second job snapshot or
 * a short auth probe that expired while waiting for a slot reported that
 * Leadbay had failed to respond for 600,000ms — and stamped that invented
 * number into `_meta.latency_ms`, where Sentry shows it beside the failure as
 * if it had been measured.
 *
 * Local node:https mock: the behaviour under test is a stall, and the shared
 * harness answers instantly.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";

const pending: Array<() => void> = [];

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
      // Never answers on its own — the test releases it, or the deadline fires.
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

beforeEach(() => {
  pending.length = 0;
});

describe("a timeout envelope carries the deadline it blew, not the default", () => {
  it("a QUEUE-wait expiry reports the budget the caller granted", async () => {
    const client = newClient();
    // Fill every slot with requests that never answer.
    const stalled = Array.from({ length: MAX_CONCURRENT }, () =>
      client.request("GET", "/stalled").catch(() => {})
    );
    await settled();

    const err: any = await client
      .request("GET", "/mcp/jobs/j1", undefined, { totalTimeoutMs: 60 })
      .catch((e) => e);

    // The whole point: 60, not defaultTimeoutMs().
    expect(err?._meta?.timeout_ms).toBe(60);
    expect(err?._meta?.latency_ms).toBe(60);
    expect(String(err?.message)).toContain("60ms");
    expect(String(err?.message)).not.toContain("600000");

    pending.splice(0).forEach((f) => f());
    await Promise.all(stalled);
  });

  it("the narrower of the two knobs is the one reported", async () => {
    const client = newClient();
    const stalled = Array.from({ length: MAX_CONCURRENT }, () =>
      client.request("GET", "/stalled").catch(() => {})
    );
    await settled();

    const err: any = await client
      .request("GET", "/mcp/jobs/j1", undefined, {
        timeoutMs: 5_000,
        totalTimeoutMs: 80,
      })
      .catch((e) => e);

    expect(err?._meta?.timeout_ms).toBe(80);

    pending.splice(0).forEach((f) => f());
    await Promise.all(stalled);
  });
});
