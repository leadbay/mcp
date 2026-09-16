// product#4157 — a TIMEOUT envelope reports the deadline the caller SET, not
// what was left of it once the socket opened.
//
// `request()` shrinks the budget before arming the socket timer: time already
// spent waiting for a concurrency slot is time the caller waited, so the socket
// must not get the full allowance a second time. That arming number then
// travelled all the way out to the user — `timeoutMs: 15` produced "Leadbay did
// not respond within 14ms", and a call that waited 60ms in the queue on a 300ms
// total reported 240ms in `_meta.timeout_ms` and `_meta.latency_ms`.
//
// Shrinking is right for the timer and wrong for the envelope. The caller can
// only recognise the bound it passed in.
//
// The shared harness always answers, so it cannot express a stall. This file
// ships a node:https double that hangs.

import { describe, it, expect } from "vitest";
import { vi } from "vitest";

// Accepts the request and then says nothing, for ever.
const h = vi.hoisted(() => ({
  request: () => ({
    on() {
      return this;
    },
    write() {},
    destroy() {},
    end() {},
  }),
}));

vi.mock("node:https", () => ({ default: { request: h.request }, request: h.request }));

import { LeadbayClient } from "../../src/client.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

describe("TIMEOUT envelope — the number is the caller's deadline", () => {
  it("a queue wait does not shrink the reported budget", async () => {
    const client = newClient();

    // MAX_CONCURRENT is 5. Fill every slot with a stall that clears after 60ms,
    // so the call under test spends ~60ms queued before its socket opens.
    const blockers = Array.from({ length: 5 }, (_, i) =>
      client.request("GET", `/campaigns?p=${i}`, undefined, { timeoutMs: 60 }).catch(() => undefined)
    );

    const err: any = await client
      .request("GET", "/users/me", undefined, { totalTimeoutMs: 300 })
      .catch((e) => e);
    await Promise.all(blockers);

    expect(err.code).toBe("TIMEOUT");
    expect(err._meta.timeout_ms).toBe(300);
    expect(err._meta.latency_ms).toBe(300);
    expect(err.message).toContain("300ms");
  });

  it("a runner slow enough to burn a millisecond still reports the whole budget", async () => {
    // The CI red this fixes: client-default-request-deadline.test.ts asserts
    // `timeoutMs: 15` says "15ms" and got "14ms" on run 35126260542. It passes
    // on a fast machine because the two Date.now() reads between arming the
    // budget and handing it to the socket land in the same millisecond. Advance
    // the clock one tick per read so the drift happens every time.
    const real = Date.now.bind(Date);
    let drift = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => real() + drift++);

    const err: any = await newClient()
      .request("GET", "/campaigns", undefined, { retryOn401: false, timeoutMs: 15 })
      .catch((e) => e);
    clock.mockRestore();

    expect(err._meta.timeout_ms).toBe(15);
    expect(err.message).toContain("15ms");
  });

  it("the narrower of the two bounds is the one reported", async () => {
    const err: any = await newClient()
      .request("GET", "/campaigns", undefined, { timeoutMs: 20, totalTimeoutMs: 500 })
      .catch((e) => e);

    expect(err._meta.timeout_ms).toBe(20);
  });
});
