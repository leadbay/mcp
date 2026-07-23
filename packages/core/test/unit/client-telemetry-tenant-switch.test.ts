import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../src/client.js";

const US = "https://api-us.leadbay.app";
const FR = "https://api-eu.leadbay.app";

beforeEach(() => resetHttpMock());

// The cached telemetry preference is tenant-scoped (product#3879, Codex P2).
// setBaseUrl() switches tenant (leadbay_login does this before setToken) and
// clears every other tenant cache — it must clear this one too, or account A's
// opt-out could wrongly suppress account B (especially when B's backend omits
// telemetry_enabled and would otherwise default to enabled).
describe("LeadbayClient — telemetry cache is cleared on tenant switch", () => {
  it("setBaseUrl clears a previously cached opt-out", () => {
    const client = new LeadbayClient(US, "u.tokA", "us");
    client.setCachedTelemetryEnabled(false); // account A opted out
    expect(client.cachedTelemetryEnabled()).toBe(false);

    client.setBaseUrl(FR, "fr"); // switch to account B / region

    // Account A's opt-out must NOT carry over to B.
    expect(client.cachedTelemetryEnabled()).toBeUndefined();
  });

  it("a read still in flight from the OLD tenant cannot write the new tenant's cache", async () => {
    // Start a read against tenant A (returns opted-out), switch tenant mid-flight,
    // then let the stale read resolve. The sequence bump in setBaseUrl means the
    // stale A read must not populate B's telemetry cache.
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: {
      id: "ua", email: "a@x.test", organization: { id: "orgA", name: "A" }, telemetry_enabled: false,
    } }]);
    const client = new LeadbayClient(US, "u.tokA", "us");
    const inFlight = client.fetchTelemetryEnabled();
    client.setBaseUrl(FR, "fr"); // tenant switch bumps the sequence
    await inFlight;

    expect(client.cachedTelemetryEnabled()).toBeUndefined(); // stale A read discarded
  });
});
