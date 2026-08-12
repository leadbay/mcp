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

// The telemetry-stamp generation guard (product#3879, Codex P1): a
// leadbay_set_telemetry toggle that stamps the cache while a /users/me read is
// in flight must NOT be clobbered when that (now stale) read resolves. This is
// the source-of-truth fix for both the SSE fire-and-forget refresh and the
// streamable timed-out resolveMe still running in the background.
describe("LeadbayClient — telemetry stamp survives an in-flight /users/me read", () => {
  it("a disable stamp during a resolveMe(true) is preserved over the stale enabled read", async () => {
    // Backend still reports enabled (stale). We start the forced read, stamp
    // disabled while it's in flight, then let the read resolve. The durable
    // preference (what the suppression predicate reads) keeps the stamp.
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: meBody(true) }]);
    const client = newClient();

    const inFlight = client.resolveMe(true); // reads stale "true"
    client.setCachedTelemetryEnabled(false); // toggle lands mid-flight
    await inFlight;

    // The stale read did NOT overwrite the stamped preference.
    expect(client.cachedTelemetryEnabled()).toBe(false);
  });

  it("an enable stamp during a resolveMe(true) is preserved over a stale disabled read", async () => {
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: meBody(false) }]);
    const client = newClient();

    const inFlight = client.resolveMe(true);
    client.setCachedTelemetryEnabled(true);
    await inFlight;

    expect(client.cachedTelemetryEnabled()).toBe(true);
  });

  it("fetchTelemetryEnabled reads the preference without touching the /me cache (Codex P2)", async () => {
    // The SSE refresh uses this dedicated path so a background read can't clobber
    // mePayload (e.g. a stale last_requested_lens). It returns the observed value
    // and updates only the telemetry cache.
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: { ...meBody(false), last_requested_lens: 7 } }]);
    const client = newClient();
    const observed = await client.fetchTelemetryEnabled();
    expect(observed).toBe(false);
    expect(client.cachedTelemetryEnabled()).toBe(false);
    // mePayload was NOT populated by the lightweight fetch.
    expect((client as any).mePayload).toBeNull();
  });

  it("fetchTelemetryEnabled: a stamp beating it wins (in-flight guard)", async () => {
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: meBody(true) }]);
    const client = newClient();
    const inFlight = client.fetchTelemetryEnabled();
    client.setCachedTelemetryEnabled(false); // supersede the in-flight read
    const observed = await inFlight;
    expect(observed).toBe(true); // it still returns what it saw…
    expect(client.cachedTelemetryEnabled()).toBe(false); // …but the stamp wins the cache
  });

  it("fetchTelemetryEnabled: absent field → undefined, cache untouched (older backend)", async () => {
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: meBody(undefined) }]);
    const client = newClient();
    const observed = await client.fetchTelemetryEnabled();
    expect(observed).toBeUndefined();
    expect(client.cachedTelemetryEnabled()).toBeUndefined();
  });

  it("fetchTelemetryEnabled restores _lastMeta — the background read is invisible to lastMeta (Codex P2)", async () => {
    // A tool's real call sets lastMeta; a telemetry refresh must not overwrite it
    // (else e.g. pull-leads' _meta.latency_ms would describe GET /users/me).
    mockHttp([
      { method: "GET", path: "/1.6/leads", status: 200, body: { items: [] } },     // tool call
      { method: "GET", path: "/1.6/users/me", status: 200, body: meBody(true) },    // telemetry refresh
    ]);
    const client = newClient();
    await (client as any).request("GET", "/leads"); // tool's backend call sets lastMeta
    const metaAfterTool = client.lastMeta;
    expect(metaAfterTool?.endpoint).toContain("/leads");

    await client.fetchTelemetryEnabled(); // background refresh

    // lastMeta still describes the tool call, not /users/me.
    expect(client.lastMeta).toBe(metaAfterTool);
    expect(client.lastMeta?.endpoint).toContain("/leads");
  });

  it("clearTelemetryStampOrigin demotes a stamp without changing its value (Codex P2 request-scoped)", () => {
    const client = newClient();
    client.setCachedTelemetryEnabled(true);
    expect(client.cachedTelemetryStamped()).toBe(true);
    client.clearTelemetryStampOrigin();
    expect(client.cachedTelemetryStamped()).toBe(false);
    expect(client.cachedTelemetryEnabled()).toBe(true); // value preserved as fallback
  });

  it("clearTelemetryStampOrigin(seq) PRESERVES a stamp made after the reference seq (Codex P2 same-message opt-in)", () => {
    const client = newClient();
    const seqAtRefreshStart = client.telemetrySeq();
    client.setCachedTelemetryEnabled(true); // same-message enable — bumps seq past the snapshot
    // A fail-closed refresh tries to demote, but this stamp is newer → kept.
    client.clearTelemetryStampOrigin(seqAtRefreshStart);
    expect(client.cachedTelemetryStamped()).toBe(true); // preserved
  });

  it("clearTelemetryStampOrigin(seq) DEMOTES a stamp that predates the reference seq (earlier message)", () => {
    const client = newClient();
    client.setCachedTelemetryEnabled(true); // earlier-message enable
    const seqAtRefreshStart = client.telemetrySeq(); // reference captured AFTER the old stamp
    client.clearTelemetryStampOrigin(seqAtRefreshStart);
    expect(client.cachedTelemetryStamped()).toBe(false); // demoted — stale
    expect(client.cachedTelemetryEnabled()).toBe(true); // value kept as fallback
  });

  it("the stamped preference SURVIVES invalidateMe() — an opt-out isn't forgotten on /me churn (Codex P1)", async () => {
    // disable stamps the preference; a later tool invalidates the /me cache
    // (refine_prompt / my_lenses / set_active_lens all do). The telemetry
    // preference must persist so the hosted predicate still sees OFF.
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: meBody(true) }]);
    const client = newClient();
    await client.resolveMe(); // opened enabled
    client.setCachedTelemetryEnabled(false); // user disables

    client.invalidateMe(); // next tool churns the /me cache

    expect(client.cachedTelemetryEnabled()).toBe(false); // NOT undefined — opt-out held
  });

  it("no stamp during the read → the fresh backend value is used normally", async () => {
    // Baseline: without a concurrent toggle the read populates as usual.
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: meBody(false) }]);
    const client = newClient();
    const resolved = await client.resolveMe(true);
    expect(resolved.telemetry_enabled).toBe(false);
    expect(client.cachedTelemetryEnabled()).toBe(false);
  });

  it("the guard is per-read: a stamp then a LATER full read reflects the newer backend value", async () => {
    // First read stamped mid-flight → false preserved. A subsequent forced read
    // (no concurrent stamp) is free to adopt the backend's current value again.
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: meBody(true) },
      { method: "GET", path: "/1.6/users/me", status: 200, body: meBody(true) },
    ]);
    const client = newClient();

    const first = client.resolveMe(true);
    client.setCachedTelemetryEnabled(false);
    await first;
    expect(client.cachedTelemetryEnabled()).toBe(false); // stamp preserved

    await client.resolveMe(true); // clean read, no concurrent stamp
    expect(client.cachedTelemetryEnabled()).toBe(true); // adopts backend value
  });
});
