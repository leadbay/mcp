// product#4003 — one stalled tenant must not be able to destroy a tool's
// fleet-wide latency percentiles.
//
// While `leadbay_list_campaigns` was hanging for one customer, the whole
// fleet's numbers for that tool read p95 = 204,338,713 ms and mean =
// 30,254,159 ms. Every other user's median on the same tool was 5-24 ms. The
// dashboard was reporting a 57-hour tool, and nobody could see it was one
// account, because the events looked exactly like ordinary latency.
//
// The rule: over DURATION_PLAUSIBILITY_CEILING_MS the measurement stops
// arriving in `duration_ms` (the field the percentiles aggregate) and moves to
// `duration_ms_raw` alongside `duration_implausible: true`. Nothing is
// discarded — the stall gets louder in the data, not quieter.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const posthogState = vi.hoisted(() => ({
  capture: vi.fn(),
  identify: vi.fn(),
  shutdown: vi.fn(async () => {}),
}));

vi.mock("posthog-node", () => {
  class PostHog {
    capture(...args: any[]) {
      return posthogState.capture(...args);
    }
    identify(...args: any[]) {
      return posthogState.identify(...args);
    }
    shutdown(timeoutMs?: number) {
      return posthogState.shutdown(timeoutMs);
    }
  }
  return { PostHog };
});

vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  setUser: vi.fn(),
  captureException: vi.fn(),
  withScope: vi.fn((fn: (s: any) => void) => {
    fn({ setTag: vi.fn(), setExtra: vi.fn(), setFingerprint: vi.fn(), setUser: vi.fn() });
  }),
  close: vi.fn(async () => true),
}));

import { initTelemetry, withPlausibleDuration } from "../../src/telemetry.js";
import { DURATION_PLAUSIBILITY_CEILING_MS } from "../../src/telemetry-events.js";

const base = { tool: "leadbay_list_campaigns", ok: true, format: "json" as const, bytes: 12 };

describe("withPlausibleDuration", () => {
  it("passes an ordinary latency through untouched", () => {
    const out = withPlausibleDuration({ ...base, duration_ms: 24 });
    expect(out).toEqual({ ...base, duration_ms: 24 });
    expect(out).not.toHaveProperty("duration_implausible");
    expect(out).not.toHaveProperty("duration_ms_raw");
  });

  it("keeps zero and the ceiling itself — the boundary is inclusive", () => {
    expect(withPlausibleDuration({ ...base, duration_ms: 0 }).duration_ms).toBe(0);
    expect(
      withPlausibleDuration({ ...base, duration_ms: DURATION_PLAUSIBILITY_CEILING_MS })
        .duration_ms
    ).toBe(DURATION_PLAUSIBILITY_CEILING_MS);
  });

  it("moves the real incident durations out of duration_ms and flags them", () => {
    // Burst 2's worst call: 57.2 hours.
    const out = withPlausibleDuration({ ...base, ok: false, duration_ms: 206_030_913 });
    expect(out).not.toHaveProperty("duration_ms");
    expect(out.duration_ms_raw).toBe(206_030_913);
    expect(out.duration_implausible).toBe(true);
    // Everything else about the event survives — this is a relocation, not a drop.
    expect(out.tool).toBe("leadbay_list_campaigns");
    expect(out.ok).toBe(false);
    expect(out.bytes).toBe(12);
  });

  it("flags a negative duration too — a backwards clock is not a latency", () => {
    const out = withPlausibleDuration({ ...base, duration_ms: -5 });
    expect(out).not.toHaveProperty("duration_ms");
    expect(out.duration_ms_raw).toBe(-5);
    expect(out.duration_implausible).toBe(true);
  });

  it("flags a non-finite duration rather than emitting NaN into the field", () => {
    const out = withPlausibleDuration({ ...base, duration_ms: Number.NaN });
    expect(out).not.toHaveProperty("duration_ms");
    expect(out.duration_implausible).toBe(true);
  });

  it("the ceiling clears the longest budget any tool grants itself", () => {
    // import-leads' DEFAULT_TOTAL_BUDGET_MS is 300s; the ceiling is 2x that, so
    // a legitimately long run is never flagged.
    expect(DURATION_PLAUSIBILITY_CEILING_MS).toBeGreaterThanOrEqual(2 * 300_000);
  });
});

// The helper being correct proves nothing if it isn't on the emit path. These
// drive the real capture surface and read what PostHog would have received.
describe("the sanitizer is wired into the capture path, not just available", () => {
  let savedNodeEnv: string | undefined;

  beforeEach(() => {
    posthogState.capture.mockClear();
    savedNodeEnv = process.env.NODE_ENV;
    (process.env as any).NODE_ENV = "development";
    delete process.env.LEADBAY_TELEMETRY_ENABLED;
  });

  afterEach(() => {
    if (savedNodeEnv === undefined) delete (process.env as any).NODE_ENV;
    else (process.env as any).NODE_ENV = savedNodeEnv;
  });

  const propsOf = (event: string) =>
    posthogState.capture.mock.calls.find((c: any[]) => c[0]?.event === event)?.[0]?.properties;

  it("'mcp tool called' with a 57-hour duration emits no duration_ms", () => {
    const telemetry = initTelemetry({ version: "0.30.0" });
    telemetry.captureToolCall(
      {
        tool: "leadbay_list_campaigns",
        ok: false,
        duration_ms: 206_030_913,
        format: "error-envelope",
        bytes: 200,
        error_code: "API_ERROR",
      },
      { distinctId: "ludivine@groupeorionis.test" }
    );
    const props = propsOf("mcp tool called");
    expect(props).toBeDefined();
    expect(props).not.toHaveProperty("duration_ms");
    expect(props.duration_ms_raw).toBe(206_030_913);
    expect(props.duration_implausible).toBe(true);
    expect(props.error_code).toBe("API_ERROR");
  });

  it("'mcp composite call' is sanitized on the same rule", () => {
    const telemetry = initTelemetry({ version: "0.30.0" });
    telemetry.captureCompositeCall(
      {
        tool: "leadbay_list_campaigns",
        last_prompt: "tache planifiee quotidienne",
        ok: false,
        duration_ms: 162_054_929,
      },
      { distinctId: "ludivine@groupeorionis.test" }
    );
    const props = propsOf("mcp composite call");
    expect(props).not.toHaveProperty("duration_ms");
    expect(props.duration_ms_raw).toBe(162_054_929);
    expect(props.duration_implausible).toBe(true);
  });

  it("an ordinary call still ships duration_ms and no flag", () => {
    const telemetry = initTelemetry({ version: "0.30.0" });
    telemetry.captureToolCall(
      { tool: "leadbay_list_campaigns", ok: true, duration_ms: 21, format: "json", bytes: 12 },
      { distinctId: "someone@leadbay.test" }
    );
    const props = propsOf("mcp tool called");
    expect(props.duration_ms).toBe(21);
    expect(props).not.toHaveProperty("duration_implausible");
    expect(props).not.toHaveProperty("duration_ms_raw");
  });
});
