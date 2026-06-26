/**
 * Tests for the installer entrypoint watchdog (#3805). Without an overall
 * timeout, a headless run whose GUI nobody can reach dangles forever until the
 * host (Claude Cowork) kills the command — the user sees "running…" then a
 * timeout. runInstallerLoop turns that into a bounded, clean exit.
 *
 * Pins:
 *   - When NOTHING ever connects to the GUI (no `activity`) and `done` never
 *     resolves, the watchdog wins with outcome "timeout" — the headless case.
 *   - When `done` resolves first, outcome is "completed" (happy path unaffected).
 *   - When a browser reaches the GUI (`activity` resolves), the watchdog is
 *     DISARMED: a slow-but-active install past the watchdog window still
 *     completes and is never cut off — guards the OAuth/MFA regression.
 *   - With `watchdogMs = null` (the UNINSTALL flow), NO timeout racer exists, so
 *     a slow user is never cut off and never sees install guidance.
 *
 * New file (existing installer tests are left untouched).
 */
import { describe, it, expect } from "vitest";
import { runInstallerLoop } from "../../installer/installer-electron.js";
import type { InstallerGuiHandle } from "../../installer/installer-gui.js";

function fakeHandle(
  done: Promise<void>,
  activity: Promise<void> = new Promise<void>(() => undefined) // never, by default
): InstallerGuiHandle {
  return { url: "http://127.0.0.1:0/", done, activity, close: async () => undefined };
}

describe("runInstallerLoop — watchdog", () => {
  it("fires with outcome 'timeout' when nothing ever connects and the GUI never completes", async () => {
    // No activity + a done that never resolves — the headless dangle the bug is about.
    const neverDone = new Promise<void>(() => undefined);
    const result = await runInstallerLoop(fakeHandle(neverDone), 30);
    expect(result.outcome).toBe("timeout");
  });

  it("returns 'completed' when the install finishes before the watchdog", async () => {
    const result = await runInstallerLoop(fakeHandle(Promise.resolve()), 5_000);
    expect(result.outcome).toBe("completed");
  });

  it("does NOT time out an active install that runs past the watchdog window", async () => {
    // A browser reached the GUI early (activity resolves at ~10ms), then the
    // user takes longer than the 30ms watchdog to finish OAuth (done at ~80ms).
    // Because activity disarmed the watchdog, the run still completes — it is
    // never cut off (the OAuth/MFA regression this guards against).
    const activity = new Promise<void>((resolve) => setTimeout(resolve, 10));
    const slowDone = new Promise<void>((resolve) => setTimeout(resolve, 80));
    const result = await runInstallerLoop(fakeHandle(slowDone, activity), 30);
    expect(result.outcome).toBe("completed");
  });

  it("never times out the uninstall flow (watchdogMs = null)", async () => {
    // The uninstaller has no browser step and waits for the user to pick
    // clients. With the watchdog disabled, a `done` that takes a while still
    // resolves as "completed" — there is no timeout racer to cut it off.
    const slowDone = new Promise<void>((resolve) => setTimeout(resolve, 40));
    const result = await runInstallerLoop(fakeHandle(slowDone), null);
    expect(result.outcome).toBe("completed");
  });
});
