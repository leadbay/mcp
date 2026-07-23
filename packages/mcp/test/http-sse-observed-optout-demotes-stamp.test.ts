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

const ssePred = (client: LeadbayClient, session: { suppressed: boolean; forceClosed: boolean }) => () =>
  suppressTelemetry({
    stamped: client.cachedTelemetryStamped(),
    cached: client.cachedTelemetryEnabled(),
    forceClosed: session.forceClosed,
    sessionOptedOut: session.suppressed,
    fallbackEnabled: !session.suppressed,
  });

describe("legacy SSE observed opt-out demotes stale opt-in stamps", () => {
  it("suppresses when a later refresh observes telemetry_enabled:false", () => {
    resetHttpMock();
    mockHttp([]);
    const client = new LeadbayClient(BASE, "u.tok", "us");
    client.setCachedTelemetryEnabled(true); // earlier message explicitly opted in
    const stampSeqAtMessageStart = client.telemetryStampSeq();

    const session = { suppressed: false, forceClosed: false };
    client.clearTelemetryStampOrigin(stampSeqAtMessageStart);
    session.suppressed = true; // refresh observed false from another connector
    session.forceClosed = false;

    const { telemetry, events } = captureSpy();
    bindTelemetryIdentity(telemetry, IDENTITY, ssePred(client, session)).captureToolCall(TOOLCALL);

    expect(client.cachedTelemetryStamped()).toBe(false);
    expect(events).toHaveLength(0);
  });

  it("preserves a same-message opt-in stamp over an observed opt-out", () => {
    resetHttpMock();
    mockHttp([]);
    const client = new LeadbayClient(BASE, "u.tok", "us");
    const stampSeqAtMessageStart = client.telemetryStampSeq();

    const session = { suppressed: false, forceClosed: false };
    client.setCachedTelemetryEnabled(true); // same message explicitly opted in
    client.clearTelemetryStampOrigin(stampSeqAtMessageStart);
    session.suppressed = true; // slower refresh observed an older false
    session.forceClosed = false;

    const { telemetry, events } = captureSpy();
    bindTelemetryIdentity(telemetry, IDENTITY, ssePred(client, session)).captureToolCall(TOOLCALL);

    expect(client.cachedTelemetryStamped()).toBe(true);
    expect(events).toHaveLength(1);
  });
});
