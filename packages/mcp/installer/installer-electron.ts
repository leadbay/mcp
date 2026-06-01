import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { startInstallerGui, startUninstallerGui } = await import("./installer-gui.js");
  const opts = { openBrowser: !args.includes("--no-open") };
  if (args.includes("--uninstall")) {
    await startUninstallerGui(opts);
  } else {
    await startInstallerGui(opts);
  }
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
