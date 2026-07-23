import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../src/client.js";

const US = "https://api-us.leadbay.app";

beforeEach(() => resetHttpMock());

describe("LeadbayClient telemetry cache on token replacement", () => {
  it("setToken clears telemetry state for same-region account switches", () => {
    const client = new LeadbayClient(US, "u.tokA", "us");
    client.setCachedTelemetryEnabled(false); // account A opted out
    expect(client.cachedTelemetryEnabled()).toBe(false);

    client.setToken("u.tokB"); // account B in the same region

    expect(client.cachedTelemetryEnabled()).toBeUndefined();
    expect(client.cachedTelemetryStamped()).toBe(false);
  });

  it("a read still in flight from the OLD token cannot write the new token's cache", async () => {
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: {
      id: "ua", email: "a@x.test", organization: { id: "orgA", name: "A" }, telemetry_enabled: false,
    } }]);
    const client = new LeadbayClient(US, "u.tokA", "us");
    const inFlight = client.fetchTelemetryEnabled();
    client.setToken("u.tokB"); // same-region tenant switch bumps the sequence
    await inFlight;

    expect(client.cachedTelemetryEnabled()).toBeUndefined();
  });
});
