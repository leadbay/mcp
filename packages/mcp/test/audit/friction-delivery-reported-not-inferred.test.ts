import { describe, expect, it, vi } from "vitest";
import { httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { NOOP_TELEMETRY } from "../../src/telemetry.js";
import { bindTelemetryIdentity } from "../../src/http-server.js";

/**
 * Delivery must be REPORTED by the telemetry handle, never inferred from which
 * handle the server happens to hold (product#3943, Codex P2 round 3).
 *
 * Two ways the earlier `telemetry === NOOP_TELEMETRY` heuristic produced a false
 * "Shared with the Leadbay team" for a report that went nowhere:
 *
 *   1. A Sentry-only / PostHog-less process. `initTelemetry` returns a NON-NOOP
 *      handle when only Sentry is configured (or PostHog init failed), but
 *      `emit` short-circuits without a PostHog sink, so the friction event is
 *      dropped silently.
 *   2. The hosted HTTP path, where `bindTelemetryIdentity` returns a fresh
 *      object that never `===` NOOP_TELEMETRY.
 *
 * `captureFrictionReported` now returns a boolean describing what actually
 * happened, and the tool's confirmation follows that boolean.
 */
describe("audit: friction delivery is reported, not inferred", () => {
  it("NOOP telemetry reports no delivery", () => {
    expect(
      NOOP_TELEMETRY.captureFrictionReported({
        category: "silent_failure",
        message: "Nothing came back.",
      } as any)
    ).toBe(false);
  });

  it("a non-NOOP handle with no PostHog sink still reports no delivery", () => {
    // Models the Sentry-only process: a real handle, but nothing to emit into.
    const sentryOnly: any = {
      ...NOOP_TELEMETRY,
      // Everything else behaves like a live handle...
      captureToolCall: () => undefined,
      // ...but the friction sink is unavailable, so it must say so.
      captureFrictionReported: () => false,
    };
    const bound = bindTelemetryIdentity(sentryOnly, { region: "us" } as any);
    expect(
      bound.captureFrictionReported({
        category: "silent_failure",
        message: "Nothing came back.",
      } as any)
    ).toBe(false);
  });

  it("the hosted wrapper propagates a real delivery result", () => {
    // The wrapper is a fresh object — identity checks can never see through it,
    // so it must pass the base handle's answer straight back.
    const live: any = {
      ...NOOP_TELEMETRY,
      captureFrictionReported: () => true,
    };
    const bound = bindTelemetryIdentity(live, { region: "us" } as any);
    expect(
      bound.captureFrictionReported({
        category: "wrong_result",
        message: "Wrong region.",
      } as any)
    ).toBe(true);
    expect(bound).not.toBe(NOOP_TELEMETRY);
  });
});
