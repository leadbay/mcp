import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../src/client.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

const meBody = (telemetry_enabled: boolean | undefined) => ({
  id: "u-1",
  email: "rep@acme.com",
  organization: { id: "org-1", name: "Acme" },
  ...(telemetry_enabled === undefined ? {} : { telemetry_enabled }),
});

describe("LeadbayClient telemetry review regressions", () => {
  it("demotes an old opt-in stamp even after a telemetry read-start bumps the state sequence", async () => {
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: meBody(true) }]);
    const client = newClient();
    client.setCachedTelemetryEnabled(true);
    const stampSeqAtMessageStart = client.telemetryStampSeq();

    const inFlight = client.fetchTelemetryEnabled();
    client.clearTelemetryStampOrigin(stampSeqAtMessageStart);
    await inFlight;

    expect(client.cachedTelemetryEnabled()).toBe(true);
    expect(client.cachedTelemetryStamped()).toBe(false);
  });

  it("preserves a same-message opt-in stamp while demoting with the message-start stamp sequence", () => {
    const client = newClient();
    const stampSeqAtMessageStart = client.telemetryStampSeq();

    client.setCachedTelemetryEnabled(true);
    client.clearTelemetryStampOrigin(stampSeqAtMessageStart);

    expect(client.cachedTelemetryStamped()).toBe(true);
  });

  it("fetchTelemetryEnabled does not write over tool metadata", async () => {
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: meBody(false) }]);
    const client = newClient();
    const toolMeta = {
      region: "us" as const,
      endpoint: "GET /leads",
      latency_ms: 7,
      retry_after: null,
    };
    (client as any)._lastMeta = toolMeta;

    const observed = await client.fetchTelemetryEnabled();

    expect(observed).toBe(false);
    expect(client.lastMeta).toBe(toolMeta);
  });
});
