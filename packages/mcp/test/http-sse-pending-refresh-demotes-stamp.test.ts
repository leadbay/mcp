import { describe, expect, it, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { bindTelemetryIdentity, suppressTelemetry } from "../src/http-server.js";
import { NOOP_TELEMETRY, type TelemetryHandle } from "../src/telemetry.js";
import type { ToolCallProps } from "../src/telemetry-events.js";

const BASE = "https://api-us.leadbay.app";
const IDENTITY = { distinctId: "sse@leadbay.test", region: "us" };
const TOOLCALL = {
  tool: "leadbay_pull_leads",
  ok: true,
  duration_ms: 5,
  format: "json",
  bytes: 10,
} as ToolCallProps;

function captureSpy() {
  const events: Array<{ props: ToolCallProps; identity: unknown }> = [];
  const telemetry: TelemetryHandle = {
    ...NOOP_TELEMETRY,
    captureToolCall: (props, identity) => events.push({ props, identity }),
  };
  return { telemetry, events };
}

const ssePred = (client: LeadbayClient, session: { suppressed: boolean; forceClosed: boolean; refreshPending: boolean }) => () =>
  suppressTelemetry({
    stamped: client.cachedTelemetryStamped(),
    cached: client.cachedTelemetryEnabled(),
    forceClosed: session.forceClosed || session.refreshPending,
    sessionOptedOut: session.suppressed,
    fallbackEnabled: !session.suppressed,
  });

describe("legacy SSE pending refresh demotes prior-message opt-in stamps", () => {
  it("suppresses fast captures while the next message's refresh is pending", () => {
    resetHttpMock();
    mockHttp([]);
    const client = new LeadbayClient(BASE, "u.tok", "us");
    client.setCachedTelemetryEnabled(true); // previous message explicitly opted in
    const stampSeqAtMessageStart = client.telemetryStampSeq();

    client.clearTelemetryStampOrigin(stampSeqAtMessageStart); // start of next /messages
    const session = { suppressed: false, forceClosed: false, refreshPending: true };

    const { telemetry, events } = captureSpy();
    bindTelemetryIdentity(telemetry, IDENTITY, ssePred(client, session)).captureToolCall(TOOLCALL);

    expect(client.cachedTelemetryStamped()).toBe(false);
    expect(events).toHaveLength(0);
  });

  it("still lets a same-message explicit opt-in stamp emit during pending refresh", () => {
    resetHttpMock();
    mockHttp([]);
    const client = new LeadbayClient(BASE, "u.tok", "us");
    const stampSeqAtMessageStart = client.telemetryStampSeq();

    client.clearTelemetryStampOrigin(stampSeqAtMessageStart); // start of /messages
    client.setCachedTelemetryEnabled(true); // same message leadbay_set_telemetry enable
    const session = { suppressed: false, forceClosed: false, refreshPending: true };

    const { telemetry, events } = captureSpy();
    bindTelemetryIdentity(telemetry, IDENTITY, ssePred(client, session)).captureToolCall(TOOLCALL);

    expect(client.cachedTelemetryStamped()).toBe(true);
    expect(events).toHaveLength(1);
  });
});
