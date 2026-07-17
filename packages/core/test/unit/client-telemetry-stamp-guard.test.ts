import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../src/client.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

const meBody = (telemetry_enabled: boolean) => ({
  id: "u-1",
  email: "rep@acme.com",
  organization: { id: "org-1", name: "Acme" },
  telemetry_enabled,
});

// The telemetry-stamp generation guard (product#3879, Codex P1): a
// leadbay_set_telemetry toggle that stamps the cache while a /users/me read is
// in flight must NOT be clobbered when that (now stale) read resolves. This is
// the source-of-truth fix for both the SSE fire-and-forget refresh and the
// streamable timed-out resolveMe still running in the background.
describe("LeadbayClient — telemetry stamp survives an in-flight /users/me read", () => {
  it("a disable stamp during a resolveMe(true) is preserved over the stale enabled read", async () => {
    // Backend still reports enabled (stale). We start the forced read, stamp
    // disabled while it's in flight, then let the read resolve. The stamp wins.
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: meBody(true) }]);
    const client = newClient();

    const inFlight = client.resolveMe(true); // reads stale "true"
    client.setCachedTelemetryEnabled(false); // toggle lands mid-flight
    const resolved = await inFlight;

    // The read did NOT overwrite the stamped preference.
    expect(client.cachedTelemetryEnabled()).toBe(false);
    expect(resolved.telemetry_enabled).toBe(false);
  });

  it("an enable stamp during a resolveMe(true) is preserved over a stale disabled read", async () => {
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: meBody(false) }]);
    const client = newClient();

    const inFlight = client.resolveMe(true);
    client.setCachedTelemetryEnabled(true);
    const resolved = await inFlight;

    expect(client.cachedTelemetryEnabled()).toBe(true);
    expect(resolved.telemetry_enabled).toBe(true);
  });

  it("no stamp during the read → the fresh backend value is used normally", async () => {
    // Baseline: without a concurrent toggle the read populates as usual.
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: meBody(false) }]);
    const client = newClient();
    const resolved = await client.resolveMe(true);
    expect(resolved.telemetry_enabled).toBe(false);
    expect(client.cachedTelemetryEnabled()).toBe(false);
  });

  it("the guard is per-read: a stamp then a LATER full read reflects the newer backend value", async () => {
    // First read stamped mid-flight → false preserved. A subsequent forced read
    // (no concurrent stamp) is free to adopt the backend's current value again.
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: meBody(true) },
      { method: "GET", path: "/1.6/users/me", status: 200, body: meBody(true) },
    ]);
    const client = newClient();

    const first = client.resolveMe(true);
    client.setCachedTelemetryEnabled(false);
    await first;
    expect(client.cachedTelemetryEnabled()).toBe(false); // stamp preserved

    await client.resolveMe(true); // clean read, no concurrent stamp
    expect(client.cachedTelemetryEnabled()).toBe(true); // adopts backend value
  });
});
