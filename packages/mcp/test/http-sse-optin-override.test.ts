/**
 * Telemetry suppression precedence — the shared suppressTelemetry() helper that
 * BOTH the streamable /mcp handle and the SSE session predicate use (Codex
 * P1/P2). Encodes three ordered rules:
 *
 *   1. forceClosed (error / unreadable preference) ALWAYS suppresses — even over
 *      a stale cached `true` from session open. An unreadable cross-session
 *      opt-out must never keep emitting.
 *   2. else the client cache decides when DEFINED — freshest per-request/session
 *      value, incl. a synchronous stamp from leadbay_set_telemetry.execute().
 *      false → suppress, true → emit (same-request/session opt-IN takes effect).
 *   3. cache undefined → fall back to the transport's fail-closed signal.
 *
 * We also drive it through bindTelemetryIdentity() (base = NOOP spread with a
 * captureToolCall spy — same boundary the existing http-telemetry suite spies
 * at) to prove the predicate actually gates capture end-to-end.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { NOOP_TELEMETRY, type TelemetryHandle } from "../src/telemetry.js";
import type { ToolCallProps } from "../src/telemetry-events.js";
import { bindTelemetryIdentity, suppressTelemetry } from "../src/http-server.js";
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

// The exact SSE predicate wiring the handler uses.
const ssePred = (client: LeadbayClient, s: { suppressed: boolean; forceClosed: boolean }) => () =>
  suppressTelemetry({
    stamped: client.cachedTelemetryStamped(),
    cached: client.cachedTelemetryEnabled(),
    forceClosed: s.forceClosed,
    sessionOptedOut: s.suppressed,
    fallbackEnabled: !s.suppressed,
  });

describe("suppressTelemetry() precedence (Codex P1/P2)", () => {
  const P = (o: Partial<Parameters<typeof suppressTelemetry>[0]>) =>
    suppressTelemetry({ stamped: false, cached: undefined, forceClosed: false, sessionOptedOut: false, fallbackEnabled: true, ...o });

  it("an explicit stamp wins over everything — including forceClosed (Codex P2 opt-in)", () => {
    expect(P({ stamped: true, cached: true, forceClosed: true, sessionOptedOut: true })).toBe(false); // enable beats all
    expect(P({ stamped: true, cached: false, forceClosed: false })).toBe(true); // disable stamp suppresses
  });

  it("any opt-out signal suppresses among non-stamp signals", () => {
    expect(P({ forceClosed: true })).toBe(true);
    expect(P({ cached: false })).toBe(true);
    expect(P({ sessionOptedOut: true, cached: true })).toBe(true); // refresh observed off beats stale cached true
  });

  it("no opt-out signal + cache true → emit; cache undefined → fallback", () => {
    expect(P({ cached: true })).toBe(false);
    expect(P({ cached: undefined, fallbackEnabled: true })).toBe(false); // older-backend absent field
    expect(P({ cached: undefined, fallbackEnabled: false })).toBe(true); // unreadable verdict
  });
});

describe("SSE bound handle — precedence end-to-end (Codex P1/P2)", () => {
  beforeEach(() => resetHttpMock());

  it("opt-IN mid-session: opened suppressed, enable stamps cache=true → NOT suppressed", () => {
    mockHttp([]);
    const client = new LeadbayClient(BASE, "u.tok", "us");
    const session = { suppressed: true, forceClosed: false };
    const { telemetry, events } = captureSpy();
    const handle = bindTelemetryIdentity(telemetry, IDENTITY, ssePred(client, session));

    client.setCachedTelemetryEnabled(true); // enable's synchronous stamp
    handle.captureToolCall(TOOLCALL);

    expect(events).toHaveLength(1);
    expect(events[0].identity).toEqual(IDENTITY);
  });

  it("opt-IN stamp overrides a stale forceClosed (Codex P2 #6642921)", () => {
    // A prior refresh timed out → forceClosed. Then a same-message enable stamps
    // cache=true. The explicit opt-in must take effect despite forceClosed.
    mockHttp([]);
    const client = new LeadbayClient(BASE, "u.tok", "us");
    const session = { suppressed: true, forceClosed: true };
    const { telemetry, events } = captureSpy();
    const handle = bindTelemetryIdentity(telemetry, IDENTITY, ssePred(client, session));

    client.setCachedTelemetryEnabled(true);
    handle.captureToolCall(TOOLCALL);
    expect(events).toHaveLength(1); // stamp beats forceClosed
  });

  it("opt-OUT mid-session still fails closed: disable stamps cache=false → suppressed", () => {
    mockHttp([]);
    const client = new LeadbayClient(BASE, "u.tok", "us");
    const session = { suppressed: false, forceClosed: false };
    const { telemetry, events } = captureSpy();
    const handle = bindTelemetryIdentity(telemetry, IDENTITY, ssePred(client, session));

    client.setCachedTelemetryEnabled(false);
    handle.captureToolCall(TOOLCALL);
    expect(events).toHaveLength(0);
  });

  it("refresh OBSERVED off wins over a stale cached true (Codex P1 #6642926)", () => {
    // A concurrent tool read left the shared cache at a stale `true` (a read, not
    // a stamp), but this cycle's refresh observed the opt-out → session.suppressed.
    // The opt-out must win.
    mockHttp([]);
    const client = new LeadbayClient(BASE, "u.tok", "us");
    (client as any).telemetryEnabledCache = true; // stale read value (not a stamp)
    const session = { suppressed: true, forceClosed: false }; // refresh saw false
    const { telemetry, events } = captureSpy();
    bindTelemetryIdentity(telemetry, IDENTITY, ssePred(client, session)).captureToolCall(TOOLCALL);
    expect(events).toHaveLength(0); // sessionOptedOut beats stale cached true
  });

  it("a PRIOR message's opt-in stamp does NOT survive a later fail-closed refresh (Codex P2 request-scoped)", () => {
    // Message 1: enable stamps cache=true (stamp wins). Message 2's refresh times
    // out → the handler demotes the stamp (clearTelemetryStampOrigin) and sets
    // forceClosed. The stale enable must no longer force emit.
    mockHttp([]);
    const client = new LeadbayClient(BASE, "u.tok", "us");
    client.setCachedTelemetryEnabled(true); // message 1 opt-in
    expect(client.cachedTelemetryStamped()).toBe(true);

    // message 2 fail-closed refresh outcome, as the handler applies it:
    const session = { suppressed: true, forceClosed: true };
    client.clearTelemetryStampOrigin();

    const { telemetry, events } = captureSpy();
    bindTelemetryIdentity(telemetry, IDENTITY, ssePred(client, session)).captureToolCall(TOOLCALL);
    expect(events).toHaveLength(0); // forceClosed now governs — stamp demoted
  });

  it("refresh ERROR fails closed even when cache is stale-true from session open", () => {
    mockHttp([]);
    const client = new LeadbayClient(BASE, "u.tok", "us");
    client.setCachedTelemetryEnabled(true);
    // But a read overwrites the stamp origin — model a stale read value:
    (client as any).telemetryEnabledFromStamp = false;
    const session = { suppressed: true, forceClosed: true };
    const { telemetry, events } = captureSpy();
    bindTelemetryIdentity(telemetry, IDENTITY, ssePred(client, session)).captureToolCall(TOOLCALL);
    expect(events).toHaveLength(0); // forceClosed beats stale cached true
  });
});

describe("SSE opt-out survives /me invalidation between messages (Codex P1 #928)", () => {
  beforeEach(() => resetHttpMock());

  it("disable stamp persists through invalidateMe() → later capture stays suppressed", () => {
    mockHttp([]);
    const client = new LeadbayClient(BASE, "u.tok", "us");
    client.setCachedTelemetryEnabled(true); // session opened enabled
    const session = { suppressed: false, forceClosed: false }; // stale-enabled flag

    client.setCachedTelemetryEnabled(false); // user disabled this session
    client.invalidateMe();                    // next tool churns /me

    expect(client.cachedTelemetryEnabled()).toBe(false); // opt-out held, not undefined
    const { telemetry, events } = captureSpy();
    bindTelemetryIdentity(telemetry, IDENTITY, ssePred(client, session)).captureToolCall(TOOLCALL);
    expect(events).toHaveLength(0); // still suppressed despite stale session flag
  });
});
