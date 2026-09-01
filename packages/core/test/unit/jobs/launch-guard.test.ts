/**
 * The in-process double-launch guard (leadbay/product#4039, and Codex's
 * concurrent-reservation finding on leadbay/mcp#187).
 *
 * This is all that survives of the old bulk store, and it is not a store: the
 * backend owns job identity, retention and tenancy. The only thing it cannot
 * tell us is whether we fired this exact request seconds ago.
 *
 * Two failure modes, one mechanism. Recording only AFTER a successful launch
 * leaves a window where two concurrent callers both launch. Recording BEFORE
 * leaves a failed launch poisoning the window, so a retry is told it already
 * ran when nothing did. A claim that is settled or abandoned closes both.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  beginLaunch,
  abandonLaunch,
  rememberLaunch,
  recallLaunch,
  launchFingerprint,
  resetLaunchGuard,
} from "../../../src/jobs/launch-guard.js";

const FP = launchFingerprint(["qualify", ["lead-a"], 42]);

beforeEach(() => resetLaunchGuard());

describe("launch guard", () => {
  it("the first caller owns the claim", () => {
    expect(beginLaunch(FP)).toBeUndefined();
  });

  it("a concurrent identical caller sees the claim and does NOT launch", () => {
    beginLaunch(FP);
    expect(beginLaunch(FP)).toBeDefined();
  });

  it("a settled launch is handed back to a retry, with its backend id", () => {
    beginLaunch(FP);
    rememberLaunch(FP, "notif-1");
    const again = beginLaunch(FP);
    expect(again?.notification_id).toBe("notif-1");
  });

  it("a FAILED launch does not block the retry (product#4039)", () => {
    beginLaunch(FP);
    abandonLaunch(FP);
    expect(beginLaunch(FP)).toBeUndefined();
  });

  it("abandon does not erase an already-settled launch", () => {
    beginLaunch(FP);
    rememberLaunch(FP, "notif-1");
    abandonLaunch(FP);
    expect(recallLaunch(FP)?.notification_id).toBe("notif-1");
  });

  it("the window expires, so the guard never becomes a store", () => {
    const t0 = 1_000_000_000_000;
    rememberLaunch(FP, "notif-1", t0);
    expect(recallLaunch(FP, t0 + 4 * 60 * 1000)).toBeDefined();
    expect(recallLaunch(FP, t0 + 5 * 60 * 1000 + 1)).toBeUndefined();
  });

  it("different inputs are different launches", () => {
    beginLaunch(FP);
    expect(beginLaunch(launchFingerprint(["qualify", ["lead-b"], 42]))).toBeUndefined();
  });
});
