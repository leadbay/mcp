import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { printHostedMcpHelp } from "./install-shared.js";
import type { InstallerGuiHandle } from "./installer-gui.js";

// Overall ceiling on a guided GUI run. Long enough for a human to finish OAuth
// + client selection once the browser opened; short enough to beat a chat-agent
// host's own command timeout (Claude Cowork) with a clean, actionable message
// instead of a silent hang (#3805).
export const WATCHDOG_MS = 120_000;

export interface InstallerLoopResult {
  /** "completed" = install finished, "signal" = SIGINT/SIGTERM, "timeout" = watchdog fired. */
  outcome: "completed" | "signal" | "timeout";
}

/**
 * Race the GUI's done signal against an interrupt and an overall watchdog.
 * Without the watchdog, a headless run whose GUI nobody can reach dangles
 * forever until the host kills it ("timeout" in Claude). The watchdog turns
 * that into a clean exit with the hosted-MCP fallback guidance.
 */
export async function runInstallerLoop(
  handle: InstallerGuiHandle,
  watchdogMs: number = WATCHDOG_MS
): Promise<InstallerLoopResult> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race<InstallerLoopResult>([
      handle.done.then(() => ({ outcome: "completed" as const })),
      new Promise<InstallerLoopResult>((resolve) => {
        process.once("SIGINT", () => resolve({ outcome: "signal" }));
        process.once("SIGTERM", () => resolve({ outcome: "signal" }));
      }),
      new Promise<InstallerLoopResult>((resolve) => {
        timer = setTimeout(() => resolve({ outcome: "timeout" }), watchdogMs);
      }),
    ]);
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
  const handle = args.includes("--uninstall")
    ? await startUninstallerGui(opts)
    : await startInstallerGui(opts);

  // Exit when install completes, on Ctrl+C, or when the watchdog fires.
  const { outcome } = await runInstallerLoop(handle);
  await handle.close().catch(() => undefined);

  if (outcome === "timeout") {
    process.stderr.write("\nInstaller timed out waiting for the browser flow.\n");
    printHostedMcpHelp();
    process.exit(1);
  }
  process.stderr.write(outcome === "completed" ? "\nInstallation complete. Exiting.\n" : "\nExiting.\n");
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
