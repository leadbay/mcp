import { existsSync, realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

async function runBrowserFallback(args: string[]): Promise<void> {
  const { startInstallerGui, startUninstallerGui } = await import("./installer-gui.js");
  const opts = { openBrowser: !args.includes("--no-open") };
  if (args.includes("--uninstall")) {
    await startUninstallerGui(opts);
  } else {
    await startInstallerGui(opts);
  }
}

function hasDisplay(): boolean {
  if (process.platform !== "linux") return true;
  return !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mainPath = resolve(dirname(fileURLToPath(import.meta.url)), "../installer/electron-main.cjs");
  if (!existsSync(mainPath) || args.includes("--browser") || !hasDisplay()) {
    await runBrowserFallback(args);
    return;
  }

  let electronPath: string;
  try {
    const require = createRequire(import.meta.url);
    electronPath = require("electron");
  } catch {
    await runBrowserFallback(args);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const electronArgs = process.platform === "linux" && process.env.LEADBAY_INSTALLER_ELECTRON_SANDBOX !== "1"
      ? ["--no-sandbox", mainPath, ...args]
      : [mainPath, ...args];
    const child = spawn(electronPath, electronArgs, { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) process.exit(128 + (signal === "SIGINT" ? 2 : signal === "SIGTERM" ? 15 : 0));
      process.exit(code ?? 0);
    });
  });
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
