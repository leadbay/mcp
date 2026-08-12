import { describe, it, expect } from "vitest";

import { suppressTelemetry } from "../src/http-server.js";

describe("SSE telemetry refresh pending regression", () => {
  it("fails closed for telemetry while a cross-session refresh is pending", () => {
    // The SSE handler maps refreshPending into the shared forceClosed input. This
    // keeps tool dispatch non-blocking while preventing fast tools from emitting
    // telemetry before the current opt-out refresh settles.
    expect(
      suppressTelemetry({
        stamped: false,
        cached: true,
        forceClosed: true,
        sessionOptedOut: false,
        fallbackEnabled: true,
      })
    ).toBe(true);
  });

  it("still lets a same-message explicit opt-in stamp override the pending fail-closed signal", () => {
    expect(
      suppressTelemetry({
        stamped: true,
        cached: true,
        forceClosed: true,
        sessionOptedOut: true,
        fallbackEnabled: false,
      })
    ).toBe(false);
  });
});
