import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, getHttpRequests, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { setTelemetry } from "../../../src/tools/set-telemetry.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

const meWith = (telemetry_enabled: boolean | undefined) => ({
  method: "GET" as const,
  path: "/1.6/users/me",
  status: 200,
  body: {
    id: "u-1",
    email: "rep@acme.com",
    organization: { id: "org-1", name: "Acme" },
    ...(telemetry_enabled === undefined ? {} : { telemetry_enabled }),
  },
});

describe("leadbay_set_telemetry", () => {
  it("status — reports enabled, changes nothing, no write call", async () => {
    mockHttp([meWith(true)]);
    const result: any = await setTelemetry.execute(newClient(), { action: "status" });
    expect(result.telemetry_enabled).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.action).toBe("status");
    // Only the /users/me read — no POST /users/telemetry.
    const writes = getHttpRequests().filter((r) => r.method === "POST");
    expect(writes).toHaveLength(0);
  });

  it("status — absent telemetry_enabled (older backend) reads as ON", async () => {
    mockHttp([meWith(undefined)]);
    const result: any = await setTelemetry.execute(newClient(), { action: "status" });
    expect(result.telemetry_enabled).toBe(true);
  });

  it("default action is status (bare call is a safe read)", async () => {
    mockHttp([meWith(false)]);
    const result: any = await setTelemetry.execute(newClient(), {});
    expect(result.action).toBe("status");
    expect(result.telemetry_enabled).toBe(false);
    expect(result.changed).toBe(false);
  });

  it("disable — currently ON → POSTs telemetry_enabled:false, changed:true", async () => {
    mockHttp([
      meWith(true),
      { method: "POST", path: "/1.6/users/telemetry", status: 204, body: {} },
      meWith(false), // post-write resolveMe(true) — cache now reflects disabled
    ]);
    const client = newClient();
    const result: any = await setTelemetry.execute(client, { action: "disable" });
    expect(result.telemetry_enabled).toBe(false);
    expect(result.changed).toBe(true);
    const post = getHttpRequests().find((r) => r.method === "POST" && r.path === "/1.6/users/telemetry");
    expect(post).toBeTruthy();
    expect(JSON.parse(post!.body ?? "{}")).toEqual({ telemetry_enabled: false });
    // After the write the cache reflects the NEW value (not null) — this is what
    // lets the hosted suppression predicate drop THIS request's own tracking so
    // the opt-out call doesn't track itself (Codex P2).
    expect(client.cachedTelemetryEnabled()).toBe(false);
  });

  it("disable — fail CLOSED when the post-write refresh errors: no throw, cache still says OFF [Codex P2]", async () => {
    // POST succeeds → account is now OFF. The forced /users/me refresh then 500s.
    // The tool must NOT throw (that would trip server.ts's error-telemetry path
    // for the opt-out request), and the cache must already read false so the
    // hosted suppression predicate drops this request's own capture.
    mockHttp([
      meWith(true),
      { method: "POST", path: "/1.6/users/telemetry", status: 204, body: {} },
      { method: "GET", path: "/1.6/users/me", status: 500, body: { error: true, code: "SERVER_ERROR", message: "transient" } },
    ]);
    const client = newClient();
    const result: any = await setTelemetry.execute(client, { action: "disable" });
    expect(result.error).toBeUndefined();   // did NOT throw / error-envelope
    expect(result.telemetry_enabled).toBe(false);
    expect(result.changed).toBe(true);
    // Cache was stamped BEFORE the failed refresh — suppression sees OFF.
    expect(client.cachedTelemetryEnabled()).toBe(false);
  });

  it("enable — currently OFF → POSTs telemetry_enabled:true, changed:true", async () => {
    mockHttp([
      meWith(false),
      { method: "POST", path: "/1.6/users/telemetry", status: 204, body: {} },
      meWith(true), // post-write resolveMe(true) — cache now reflects enabled
    ]);
    const result: any = await setTelemetry.execute(newClient(), { action: "enable" });
    expect(result.telemetry_enabled).toBe(true);
    expect(result.changed).toBe(true);
    const post = getHttpRequests().find((r) => r.method === "POST" && r.path === "/1.6/users/telemetry");
    expect(JSON.parse(post!.body ?? "{}")).toEqual({ telemetry_enabled: true });
  });

  it("disable — already OFF → idempotent no-op, changed:false, no write", async () => {
    mockHttp([meWith(false)]);
    const result: any = await setTelemetry.execute(newClient(), { action: "disable" });
    expect(result.telemetry_enabled).toBe(false);
    expect(result.changed).toBe(false);
    const writes = getHttpRequests().filter((r) => r.method === "POST");
    expect(writes).toHaveLength(0);
  });

  it("enable — already ON → idempotent no-op, changed:false, no write", async () => {
    mockHttp([meWith(true)]);
    const result: any = await setTelemetry.execute(newClient(), { action: "enable" });
    expect(result.telemetry_enabled).toBe(true);
    expect(result.changed).toBe(false);
    expect(getHttpRequests().filter((r) => r.method === "POST")).toHaveLength(0);
  });

  it("unknown action → rejected as BAD_ACTION, no read, no write (never silently disables) [Codex P2]", async () => {
    // The SDK doesn't validate the enum pre-dispatch, so a stray "check" must NOT
    // fall through to the disable path. It's rejected before touching the backend.
    mockHttp([]); // no scripts — any HTTP call would throw "no script matched"
    const result: any = await setTelemetry.execute(newClient(), { action: "check" });
    expect(result.error).toBe(true);
    expect(result.code).toBe("BAD_ACTION");
    expect(getHttpRequests()).toHaveLength(0); // no /users/me, no POST
  });

  it("reads FRESH /users/me via resolveMe(true) — a warmed cache does NOT serve the read [Codex P2]", async () => {
    // Prime the client cache with an ENABLED /users/me, then have the tool run
    // against a mock that now returns DISABLED. Because the tool force-refreshes,
    // it must hit the backend again and see the fresh (disabled) value — not the
    // cached enabled one. (Only one script here: a cached read would make zero
    // requests and return stale; a forced read consumes this script.)
    const client = newClient();
    mockHttp([meWith(true)]);
    await client.resolveMe(); // warm the 60s cache = enabled
    mockHttp([meWith(false)]); // backend now says disabled (e.g. flipped elsewhere)
    const result: any = await setTelemetry.execute(client, { action: "status" });
    expect(result.telemetry_enabled).toBe(false); // saw fresh value, not cached true
    // The forced read consumed the /users/me script (cache was bypassed).
    expect(getHttpRequests().filter((r) => r.path === "/1.6/users/me")).toHaveLength(1);
  });

  it("OFF hints carry the local-env caveat (no false 'events stopped' promise for stdio) [Codex P2]", async () => {
    mockHttp([meWith(false)]);
    const status: any = await setTelemetry.execute(newClient(), { action: "status" });
    expect(status.hint).toContain("LEADBAY_TELEMETRY_ENABLED=false");
    mockHttp([meWith(false)]);
    const noop: any = await setTelemetry.execute(newClient(), { action: "disable" });
    expect(noop.changed).toBe(false);
    expect(noop.hint).toContain("LEADBAY_TELEMETRY_ENABLED=false");
  });
});
