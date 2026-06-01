import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { startInstallerGui, startUninstallerGui } = await import("./installer-gui.js");
  const opts = { openBrowser: !args.includes("--no-open") };
  const handle = args.includes("--uninstall")
    ? await startUninstallerGui(opts)
    : await startInstallerGui(opts);

  // Exit when install completes or when the user hits Ctrl+C.
  let completed = false;
  await Promise.race([
    handle.done.then(() => { completed = true; }),
    new Promise<void>((resolve) => {
      process.once("SIGINT", () => resolve());
      process.once("SIGTERM", () => resolve());
    }),
  ]);
  await handle.close().catch(() => undefined);
  process.stderr.write(completed ? "\nInstallation complete. Exiting.\n" : "\nExiting.\n");
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
