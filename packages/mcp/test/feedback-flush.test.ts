/**
 * captureFeedback must FLUSH before returning, so `sent:true` means the
 * feedback envelope actually left for Sentry — not just "queued". Short-lived
 * MCP invocations (one-shot CLI, host disconnects right after the call) would
 * otherwise drop the buffered envelope when shutdown's Sentry.close(2000)
 * races the 10s flush interval. This proves the flush is awaited and that its
 * result drives the boolean return.
 *
 * initTelemetry() short-circuits to NOOP under NODE_ENV=test, so we exercise
 * the real handle by clearing NODE_ENV for the duration of init.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Minimal @sentry/node mock with captureFeedback + a controllable flush.
const sentry = vi.hoisted(() => ({
  __flushResult: true,
  init: vi.fn(),
  setUser: vi.fn(),
  captureException: vi.fn(),
  captureFeedback: vi.fn(),
  withScope: vi.fn((fn: (s: any) => void) => fn({ setTag() {}, setExtra() {}, setUser() {}, setFingerprint() {} })),
  flush: vi.fn(async () => sentry.__flushResult),
  close: vi.fn(async () => true),
  httpIntegration: vi.fn(() => ({ name: "Http" })),
}));
vi.mock("@sentry/node", () => sentry);
vi.mock("posthog-node", () => ({ PostHog: class { capture() {} identify() {} groupIdentify() {} async shutdown() {} } }));

import { initTelemetry } from "../src/telemetry.js";

const origEnv = process.env.NODE_ENV;
function realHandle() {
  // Un-gate: initTelemetry returns NOOP under NODE_ENV=test.
  process.env.NODE_ENV = "production";
  process.env.LEADBAY_SENTRY_DSN =
    "https://abc@o1.ingest.us.sentry.io/2";
  const h = initTelemetry({ version: "0.0.0-test" });
  process.env.NODE_ENV = origEnv;
  return h;
}

beforeEach(() => {
  sentry.__flushResult = true;
  sentry.captureFeedback.mockClear();
  sentry.flush.mockClear();
});
afterEach(() => {
  process.env.NODE_ENV = origEnv;
  delete process.env.LEADBAY_SENTRY_DSN;
});

describe("captureFeedback flushes before returning", () => {
  it("calls Sentry.captureFeedback then awaits flush; returns true when flush succeeds", async () => {
    const h = realHandle();
    const sent = await h.captureFeedback("hello team");
    expect(sentry.captureFeedback).toHaveBeenCalledTimes(1);
    expect(sentry.captureFeedback.mock.calls[0][0].message).toBe("hello team");
    expect(sentry.flush).toHaveBeenCalled();
    expect(sent).toBe(true);
  });

  it("returns false when the flush times out (envelope not confirmed delivered)", async () => {
    const h = realHandle();
    sentry.__flushResult = false; // simulate flush timeout
    const sent = await h.captureFeedback("hello team");
    expect(sentry.captureFeedback).toHaveBeenCalledTimes(1);
    expect(sent).toBe(false);
  });

  it("empty message → no Sentry call, returns false", async () => {
    const h = realHandle();
    const sent = await h.captureFeedback("   ");
    expect(sentry.captureFeedback).not.toHaveBeenCalled();
    expect(sent).toBe(false);
  });
});
