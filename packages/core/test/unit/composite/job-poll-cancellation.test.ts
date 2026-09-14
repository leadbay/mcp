/**
 * The poll delay must observe cancellation, not outlive it.
 *
 * `buildProtocolPrimitivesParagraph` tells every client that on Cancel "the
 * polling loop exits within ≤2 seconds". The job poller slept on a bare
 * `setTimeout(MCP_JOB_POLL.intervalMs)` — 4000ms — and only re-checked
 * `ctx.signal.aborted` after the timer fired. A cancel landing just after a
 * poll therefore waited out the full interval: twice the advertised bound,
 * on a promise the server makes in its own instructions.
 */

import { describe, it, expect, vi } from "vitest";
import { sleepUnlessAborted } from "../../../src/composite/_mcp-job-helpers.js";

describe("sleepUnlessAborted", () => {
  it("resolves early when the signal aborts mid-sleep", async () => {
    const ac = new AbortController();
    const started = Date.now();
    const sleeping = sleepUnlessAborted(4000, ac.signal);
    setTimeout(() => ac.abort(), 20);
    await sleeping;
    // Generous bound — the point is "nowhere near 4000", not a tight timing
    // assertion that would flake on a loaded CI box.
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("returns immediately when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const started = Date.now();
    await sleepUnlessAborted(4000, ac.signal);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it("still sleeps the full duration with no signal", async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      const sleeping = sleepUnlessAborted(4000).then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(3999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await sleeping;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes its abort listener so a long poll loop cannot leak them", async () => {
    // waitForJob calls this once per poll against ONE signal. Leaving the
    // listener attached would accumulate one per iteration for the life of the
    // request, and Node warns at 11.
    const ac = new AbortController();
    const added: string[] = [];
    const removed: string[] = [];
    const realAdd = ac.signal.addEventListener.bind(ac.signal);
    const realRemove = ac.signal.removeEventListener.bind(ac.signal);
    ac.signal.addEventListener = ((t: string, ...rest: unknown[]) => {
      added.push(t);
      return (realAdd as never as (...a: unknown[]) => void)(t, ...rest);
    }) as typeof ac.signal.addEventListener;
    ac.signal.removeEventListener = ((t: string, ...rest: unknown[]) => {
      removed.push(t);
      return (realRemove as never as (...a: unknown[]) => void)(t, ...rest);
    }) as typeof ac.signal.removeEventListener;

    for (let i = 0; i < 5; i++) await sleepUnlessAborted(1, ac.signal);
    expect(added.filter((t) => t === "abort")).toHaveLength(5);
    expect(removed.filter((t) => t === "abort")).toHaveLength(5);
  });
});
