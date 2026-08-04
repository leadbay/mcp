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

// Why this file exists: these two regressions were written during PR #164's
// review rounds and did not travel to main when PR #167 rebuilt the telemetry
// opt-out at granular paths. They pin the reason `clearTelemetryStampOrigin`
// guards on telemetryStampSeq() and NOT telemetrySeq() (product#3879).
//
// The distinction is load-bearing: telemetryStateSeq is bumped by both stamps
// AND telemetry read-starts, while telemetryStampStateSeq moves only on an
// explicit user stamp. Guarding on the wrong one fails in opposite directions —
// a read-start would masquerade as a same-message opt-in (stale stamp survives,
// session keeps emitting), or a genuine same-message opt-in would be demoted.
describe("LeadbayClient — clearTelemetryStampOrigin guards on the STAMP sequence", () => {
  it("demotes an old opt-in stamp even after a telemetry read-start bumps the state sequence", async () => {
    // A read-start bumps telemetryStateSeq but must NOT bump telemetryStampSeq.
    // If the guard read telemetrySeq(), the in-flight read would look like a
    // same-message stamp and this stale opt-in would wrongly survive.
    mockHttp([{ method: "GET", path: "/1.6/users/me", status: 200, body: meBody(true) }]);
    const client = newClient();
    client.setCachedTelemetryEnabled(true);
    const stampSeqAtMessageStart = client.telemetryStampSeq();

    const inFlight = client.fetchTelemetryEnabled();
    // Sanity-check the premise: the read-start moved the state sequence past the
    // snapshot while leaving the stamp sequence untouched. This is exactly the
    // divergence the guard must not be fooled by.
    expect(client.telemetrySeq()).toBeGreaterThan(stampSeqAtMessageStart);
    expect(client.telemetryStampSeq()).toBe(stampSeqAtMessageStart);

    client.clearTelemetryStampOrigin(stampSeqAtMessageStart);

    // Assert BEFORE awaiting the read. The resolving read also clears the stamp
    // flag, so awaiting first would mask a guard that wrongly skipped the
    // demotion — the assertion would pass for the wrong reason.
    expect(client.cachedTelemetryStamped()).toBe(false);

    await inFlight;

    // Value is unchanged; only its authority is demoted from stamp to read.
    expect(client.cachedTelemetryEnabled()).toBe(true);
    expect(client.cachedTelemetryStamped()).toBe(false);
  });

  it("preserves a same-message opt-in stamp while demoting with the message-start stamp sequence", () => {
    // The mirror case: a stamp that lands AFTER the reference point is a fresh
    // same-message opt-in and must outrank the later fail-closed verdict.
    const client = newClient();
    const stampSeqAtMessageStart = client.telemetryStampSeq();

    client.setCachedTelemetryEnabled(true);
    client.clearTelemetryStampOrigin(stampSeqAtMessageStart);

    expect(client.cachedTelemetryStamped()).toBe(true);
  });
});
