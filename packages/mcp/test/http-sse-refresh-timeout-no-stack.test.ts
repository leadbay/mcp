import { afterEach, describe, expect, it, vi } from "vitest";
import { httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { scheduleSseTelemetryRefresh } from "../src/http-server.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("legacy SSE telemetry refresh timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fails closed on timeout without stacking orphaned /users/me reads", async () => {
    vi.useFakeTimers();
    const firstRead = deferred<boolean | undefined>();
    const fetchTelemetryEnabled = vi
      .fn<[], Promise<boolean | undefined>>()
      .mockImplementationOnce(() => firstRead.promise)
      .mockResolvedValueOnce(false);
    const clearTelemetryStampOrigin = vi.fn();
    const session = {
      client: { fetchTelemetryEnabled, clearTelemetryStampOrigin },
      suppressed: false,
      forceClosed: false,
      refreshPending: false,
      refreshing: false,
      refreshEpoch: 0,
    };

    scheduleSseTelemetryRefresh(session as any, 0, 10);
    expect(fetchTelemetryEnabled).toHaveBeenCalledTimes(1);
    expect(session.refreshing).toBe(true);
    expect(session.refreshPending).toBe(true);

    await vi.advanceTimersByTimeAsync(10);
    expect(session.suppressed).toBe(true);
    expect(session.forceClosed).toBe(true);
    expect(session.refreshPending).toBe(false);
    expect(session.refreshing).toBe(true);
    expect(clearTelemetryStampOrigin).toHaveBeenCalledTimes(1);

    scheduleSseTelemetryRefresh(session as any, 0, 10);
    expect(fetchTelemetryEnabled).toHaveBeenCalledTimes(1);

    firstRead.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(session.refreshing).toBe(false);
    expect(session.suppressed).toBe(true);
    expect(session.forceClosed).toBe(true);

    scheduleSseTelemetryRefresh(session as any, 0, 10);
    expect(fetchTelemetryEnabled).toHaveBeenCalledTimes(2);
    vi.clearAllTimers();
  });
});
