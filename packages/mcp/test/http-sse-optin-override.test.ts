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

describe("SSE /messages refresh skips leadbay_set_telemetry messages (Codex P1 #582)", () => {
  // The /messages handler skips the cross-session refresh when the message is
  // itself a set-telemetry call, because resolveMe(true) would overwrite the
  // stamp execute() just wrote (a stale backend read racing the toggle). This
  // asserts the detection predicate the handler uses.
  const isTelemetryToggle = (body: any) =>
    body != null && body.method === "tools/call" && body.params?.name === "leadbay_set_telemetry";

  it("detects a set-telemetry tools/call (refresh would be skipped)", () => {
    expect(isTelemetryToggle({ method: "tools/call", params: { name: "leadbay_set_telemetry", arguments: { action: "disable" } } })).toBe(true);
  });

  it("does NOT skip refresh for other tool calls / non-calls", () => {
    expect(isTelemetryToggle({ method: "tools/call", params: { name: "leadbay_pull_leads" } })).toBe(false);
    expect(isTelemetryToggle({ method: "tools/list" })).toBe(false);
    expect(isTelemetryToggle(undefined)).toBe(false);
    expect(isTelemetryToggle({ params: { name: "leadbay_set_telemetry" } })).toBe(false); // no method
  });

  it("with the refresh skipped, the tool's stamp is the authoritative signal", () => {
    // A disable message stamps cache=false; because no refresh runs, nothing
    // overwrites it, and the live predicate suppresses the opt-out's own capture.
    mockHttp([]);
    const client = new LeadbayClient(BASE, "u.tok", "us");
    client.setCachedTelemetryEnabled(true); // opened enabled
    const session = { suppressed: false, forceClosed: false };

    client.setCachedTelemetryEnabled(false); // execute()'s stamp; no refresh clobbers it

    const { telemetry, events } = captureSpy();
    bindTelemetryIdentity(telemetry, IDENTITY, () =>
      suppressTelemetry(client.cachedTelemetryEnabled(), session.forceClosed, !session.suppressed)
    ).captureToolCall(TOOLCALL);
    expect(events).toHaveLength(0);
  });
});
