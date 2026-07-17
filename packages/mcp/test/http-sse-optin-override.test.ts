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

describe("suppressTelemetry() precedence (Codex P1/P2)", () => {
  it("forceClosed wins over everything (unreadable cross-session opt-out never emits)", () => {
    expect(suppressTelemetry(true, true, true)).toBe(true);
    expect(suppressTelemetry(false, true, true)).toBe(true);
    expect(suppressTelemetry(undefined, true, true)).toBe(true);
  });

  it("cache governs when defined and not force-closed", () => {
    expect(suppressTelemetry(true, false, false)).toBe(false); // opted in → emit even if fallback says off
    expect(suppressTelemetry(false, false, true)).toBe(true); // opted out → suppress even if fallback says on
  });

  it("cache undefined → defers to fallbackEnabled (absent-field read still emits)", () => {
    expect(suppressTelemetry(undefined, false, true)).toBe(false); // older-backend absent field → enabled
    expect(suppressTelemetry(undefined, false, false)).toBe(true); // timeout/error verdict → suppress
  });
});

describe("SSE bound handle — stamped cache overrides stale session flags (Codex P2)", () => {
  // Mirror the SSE predicate: suppressTelemetry(cache, session.forceClosed, !session.suppressed)
  const ssePred = (client: LeadbayClient, s: { suppressed: boolean; forceClosed: boolean }) => () =>
    suppressTelemetry(client.cachedTelemetryEnabled(), s.forceClosed, !s.suppressed);

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

  it("opt-OUT mid-session still fails closed: enabled open, disable stamps cache=false → suppressed", () => {
    mockHttp([]);
    const client = new LeadbayClient(BASE, "u.tok", "us");
    const session = { suppressed: false, forceClosed: false };
    const { telemetry, events } = captureSpy();
    const handle = bindTelemetryIdentity(telemetry, IDENTITY, ssePred(client, session));

    client.setCachedTelemetryEnabled(false);
    handle.captureToolCall(TOOLCALL);

    expect(events).toHaveLength(0);
  });

  it("refresh ERROR fails closed even when cache is stale-true from session open (Codex P1 #530)", () => {
    mockHttp([]);
    const client = new LeadbayClient(BASE, "u.tok", "us");
    client.setCachedTelemetryEnabled(true); // session opened enabled → cache true
    // A later /messages refresh could not read the preference → forceClosed.
    const session = { suppressed: true, forceClosed: true };
    const { telemetry, events } = captureSpy();
    const handle = bindTelemetryIdentity(telemetry, IDENTITY, ssePred(client, session));

    handle.captureToolCall(TOOLCALL);
    expect(events).toHaveLength(0); // forceClosed beats stale cached true
  });

  it("no set-telemetry this session (cache undefined) → falls back to session.suppressed", () => {
    mockHttp([]);
    const client = new LeadbayClient(BASE, "u.tok", "us"); // never stamped

    const s1 = captureSpy();
    bindTelemetryIdentity(s1.telemetry, IDENTITY, ssePred(client, { suppressed: true, forceClosed: false })).captureToolCall(TOOLCALL);
    expect(s1.events).toHaveLength(0);

    const s2 = captureSpy();
    bindTelemetryIdentity(s2.telemetry, IDENTITY, ssePred(client, { suppressed: false, forceClosed: false })).captureToolCall(TOOLCALL);
    expect(s2.events).toHaveLength(1);
  });
});

describe("SSE opt-out survives /me invalidation between messages (Codex P1 #928)", () => {
  beforeEach(() => resetHttpMock());

  // The durable telemetry-preference field on LeadbayClient means a stamped
  // opt-out is NOT lost when a later same-session tool calls invalidateMe()
  // (refine_prompt, my_lenses, set_active_lens, …). The SSE predicate reads
  // cachedTelemetryEnabled(), which stays false across the invalidation, so a
  // post-invalidation capture is still suppressed even while session.suppressed
  // is stale-false (the /messages refresh hadn't run yet).
  const ssePred = (client: LeadbayClient, s: { suppressed: boolean; forceClosed: boolean }) => () =>
    suppressTelemetry(client.cachedTelemetryEnabled(), s.forceClosed, !s.suppressed);

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
