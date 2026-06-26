import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { printHostedMcpHelp } from "./install-shared.js";
import type { InstallerGuiHandle } from "./installer-gui.js";

// Startup grace period before any browser connects to the GUI. It is DISARMED
// the moment a browser actually reaches the GUI (handle.activity), so it only
// ever fires in the no-browser case (#3805) — beating the chat-agent host's own
// command timeout (Claude Cowork) with a clean, actionable message instead of a
// silent hang. An active install keeps the full OAuth window (5 min in oauth.ts).
export const WATCHDOG_MS = 120_000;

export interface InstallerLoopResult {
  /** "completed" = install finished, "signal" = SIGINT/SIGTERM, "timeout" = watchdog fired. */
  outcome: "completed" | "signal" | "timeout";
}

/**
 * Race the GUI's done signal against an interrupt and an optional STARTUP
 * watchdog. The watchdog is a grace period that only fires when NOTHING ever
 * connects to the GUI — the no-browser case (#3805) where the run would
 * otherwise dangle until the host (Claude Cowork) kills it.
 *
 * Crucially it is DISARMED the moment `handle.activity` resolves (a browser
 * actually loaded the GUI). After that the loop waits indefinitely for `done`
 * or an interrupt, so a slow-but-active OAuth/MFA install — the existing flow
 * already allows 5 minutes — is never cut off by this 2-minute ceiling.
 *
 * Pass `watchdogMs = null` to disable it entirely (the UNINSTALL flow has no
 * browser step and legitimately waits for the user to select clients).
 */
export async function runInstallerLoop(
  handle: InstallerGuiHandle,
  watchdogMs: number | null = WATCHDOG_MS
): Promise<InstallerLoopResult> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const racers: Array<Promise<InstallerLoopResult>> = [
      handle.done.then(() => ({ outcome: "completed" as const })),
      new Promise<InstallerLoopResult>((resolve) => {
        process.once("SIGINT", () => resolve({ outcome: "signal" }));
        process.once("SIGTERM", () => resolve({ outcome: "signal" }));
      }),
    ];
    if (watchdogMs !== null) {
      racers.push(
        new Promise<InstallerLoopResult>((resolve) => {
          timer = setTimeout(() => resolve({ outcome: "timeout" }), watchdogMs);
          // Disarm as soon as a browser reaches the GUI — from then on this is
          // an active install and must get the full OAuth window, not a 2-min cap.
          handle.activity.then(() => { if (timer) clearTimeout(timer); }).catch(() => undefined);
        })
      );
    }
    return await Promise.race<InstallerLoopResult>(racers);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Always try to launch the GUI + open the browser — the installer does the
  // whole job once a browser is up, and a chat-agent terminal (Claude Cowork)
  // can often open one. We do NOT guess "headless" and refuse to start: the
  // watchdog below is the safety net for the case where nothing ever opens.
  const { startInstallerGui, startUninstallerGui } = await import("./installer-gui.js");
  const opts = { openBrowser: !args.includes("--no-open") };
  const isUninstall = args.includes("--uninstall");
  const handle = isUninstall
    ? await startUninstallerGui(opts)
    : await startInstallerGui(opts);

  // The watchdog only guards the install flow (OAuth + browser can dangle when
  // no browser opens). Uninstall has no browser step and legitimately waits for
  // the user to review/select clients, so it stays open until done or Ctrl+C.
  const { outcome } = await runInstallerLoop(handle, isUninstall ? null : WATCHDOG_MS);
  await handle.close().catch(() => undefined);

  if (outcome === "timeout") {
    process.stderr.write("\nInstaller timed out waiting for the browser flow.\n");
    printHostedMcpHelp();
    process.exit(1);
  }
  const verb = isUninstall ? "Uninstall" : "Installation";
  process.stderr.write(outcome === "completed" ? `\n${verb} complete. Exiting.\n` : "\nExiting.\n");
}

const isEntrypoint = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  main().catch((err) => {
    process.stderr.write(`leadbay-mcp-installer: ${err?.message ?? err}\n`);
    process.exit(1);
  });
}
