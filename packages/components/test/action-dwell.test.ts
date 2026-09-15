import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { lb, configure } from "../src/runtime.js";

// A success state dwells, then settles back to "ready" — and a control that
// has been unbound is no longer touched by that timer.

beforeEach(() => {
  vi.useFakeTimers();
  configure({ call: async () => ({ structuredContent: { ok: true } }) });
});
afterEach(() => vi.useRealTimers());

async function succeed(el: HTMLButtonElement) {
  const a = lb.action({ tool: "leadbay_like_lead", args: { lead_id: "L1" } });
  const unbind = lb.bindAction(el, a);
  el.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(el.getAttribute("data-lb-state")).toBe("success");
  return unbind;
}

describe("bindAction success dwell", () => {
  it("settles a success back to ready after the dwell", async () => {
    const el = document.createElement("button");
    await succeed(el);
    await vi.advanceTimersByTimeAsync(1600);
    expect(el.getAttribute("data-lb-state")).toBe("ready");
  });

  it("unbinding clears the pending dwell timer", async () => {
    const el = document.createElement("button");
    const unbind = await succeed(el);
    unbind();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1600);
    expect(el.getAttribute("data-lb-state")).toBe("success");
  });
});
