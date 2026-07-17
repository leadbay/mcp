/**
 * SSE suppression precedence — a same-session opt-IN must un-suppress
 * immediately, even while the session's stale `suppressed` flag is still true
 * (Codex P2). The hosted SSE handler binds its telemetry handle with a LIVE
 * predicate that mirrors handleSse():
 *
 *   () => { const c = client.cachedTelemetryEnabled();
 *           return c === undefined ? session.suppressed : c === false; }
 *
 * i.e. the client cache (stamped synchronously by leadbay_set_telemetry inside
 * execute()) is the freshest per-session signal and WINS when defined;
 * session.suppressed (refreshed only on the NEXT /messages) is the fallback for
 * cross-session changes. This drives that predicate directly through
 * bindTelemetryIdentity() so the opt-in-overrides-stale-suppression behavior
 * can't silently regress.
 *
 * Base handle is a NOOP spread with a captureToolCall spy (same boundary the
 * existing http-telemetry suite spies at) — no posthog mock needed; we assert on
 * whether the bound handle's suppression predicate let the capture through.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { NOOP_TELEMETRY, type TelemetryHandle } from "../src/telemetry.js";
import type { ToolCallProps } from "../src/telemetry-events.js";
import { bindTelemetryIdentity } from "../src/http-server.js";
import { LeadbayClient } from "@leadbay/core";

const BASE = "https://api-us.leadbay.app";
const IDENTITY = { distinctId: "sse@leadbay.test", region: "us" };
const TOOLCALL = { tool: "leadbay_set_telemetry", ok: true, duration_ms: 5, format: "json", bytes: 10 } as ToolCallProps;

function captureSpy() {
  const events: Array<{ props: ToolCallProps; identity: unknown }> = [];
  const telemetry: TelemetryHandle = {
    ...NOOP_TELEMETRY,
    captureToolCall: (props, identity) => events.push({ props, identity }),
  };
  return { telemetry, events };
}

// The exact predicate handleSse() binds: cache wins when defined, else the
// stale per-session flag.
const ssePredicate = (client: LeadbayClient, session: { suppressed: boolean }) => () => {
  const cached = client.cachedTelemetryEnabled();
  return cached === undefined ? session.suppressed : cached === false;
};

beforeEach(() => resetHttpMock());

describe("SSE suppression precedence — stamped cache overrides stale session.suppressed (Codex P2)", () => {
  it("opt-IN mid-session: session opened suppressed, enable stamps cache=true → capture is NOT suppressed", () => {
    // Session was opened while the user was opted OUT (suppressed=true), and it
    // stays true until the next /messages refresh. The user then calls
    // set_telemetry enable, which stamps the client cache to true inside
    // execute(). The post-execute capture for THIS request must go through.
    mockHttp([]);
    const client = new LeadbayClient(BASE, "u.tok", "us");
    const session = { suppressed: true };
    const { telemetry, events } = captureSpy();
    const handle = bindTelemetryIdentity(telemetry, IDENTITY, ssePredicate(client, session));

    client.setCachedTelemetryEnabled(true); // enable's synchronous stamp
    handle.captureToolCall(TOOLCALL);

    expect(events).toHaveLength(1);
    expect(events[0].identity).toEqual(IDENTITY);
  });

  it("opt-OUT mid-session still fails closed: session opened enabled, disable stamps cache=false → suppressed", () => {
    mockHttp([]);
    const client = new LeadbayClient(BASE, "u.tok", "us");
    const session = { suppressed: false };
    const { telemetry, events } = captureSpy();
    const handle = bindTelemetryIdentity(telemetry, IDENTITY, ssePredicate(client, session));

    client.setCachedTelemetryEnabled(false); // disable's synchronous stamp
    handle.captureToolCall(TOOLCALL);

    expect(events).toHaveLength(0);
  });

  it("no set-telemetry this session (cache undefined) → falls back to session.suppressed", () => {
    mockHttp([]);
    const client = new LeadbayClient(BASE, "u.tok", "us"); // cache never stamped

    const suppressed = captureSpy();
    const suppressedHandle = bindTelemetryIdentity(suppressed.telemetry, IDENTITY, ssePredicate(client, { suppressed: true }));
    suppressedHandle.captureToolCall(TOOLCALL);
    expect(suppressed.events).toHaveLength(0); // fallback: suppressed

    const open = captureSpy();
    const openHandle = bindTelemetryIdentity(open.telemetry, IDENTITY, ssePredicate(client, { suppressed: false }));
    openHandle.captureToolCall(TOOLCALL);
    expect(open.events).toHaveLength(1); // fallback: open
  });
});
