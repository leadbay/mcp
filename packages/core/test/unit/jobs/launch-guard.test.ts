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
    expect(beginLaunch(FP).state).toBe("owned");
  });

  it("an in-flight claim reports itself AS in-flight, not as a launch", () => {
    // The whole finding: a claim and a settled launch are identical objects,
    // so the discriminator has to be carried and read. Reported as "settled"
    // here, the caller answers `running` with a null id — and on hosted the
    // returned ids are the only way back to the job.
    beginLaunch(FP);
    const second = beginLaunch(FP);
    expect(second.state).toBe("in_flight");
    expect(second).not.toHaveProperty("record");
  });

  it("a settled launch is handed back to a retry, with its backend id", () => {
    beginLaunch(FP);
    rememberLaunch(FP, "notif-1");
    const again = beginLaunch(FP);
    expect(again.state).toBe("settled");
    expect(again.state === "settled" && again.record.notification_id).toBe("notif-1");
  });

  it("a FAILED launch does not block the retry (product#4039)", () => {
    beginLaunch(FP);
    abandonLaunch(FP);
    expect(beginLaunch(FP).state).toBe("owned");
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
    expect(beginLaunch(launchFingerprint(["qualify", ["lead-b"], 42])).state).toBe("owned");
  });
});
