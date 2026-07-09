import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const HOSTED_MCP_URL = "https://mcp.leadbay.app/mcp";

/**
 * Print the actionable fallback block. The guided installer ALWAYS tries to
 * open a browser; this is only printed by the entrypoint watchdog (#3805) when
 * nothing ever opened, so the user isn't left staring at a hang. It covers the
 * two no-local-browser paths to Leadbay's hosted HTTP MCP (Claude does OAuth
 * in-app — no localhost callback):
 *   - Claude web / Cowork web: add it as a custom Connector in the UI.
 *   - A terminal with the `claude` CLI: one `claude mcp add` command.
 */
export function printHostedMcpHelp(write: (s: string) => void = (s) => process.stderr.write(s)): void {
  write(
    "\nThe guided installer couldn't complete (no browser opened in time).\n" +
      "You can add Leadbay's hosted MCP directly — Claude signs in in-app,\n" +
      "no localhost callback needed:\n\n" +
      "  • Claude web / Cowork web:\n" +
      "      Customize → Connectors → \"+\" → Add custom connector\n" +
      `      Name: Leadbay   URL: ${HOSTED_MCP_URL}\n\n` +
      "  • A terminal with the Claude Code CLI:\n" +
      `      claude mcp add --transport http leadbay ${HOSTED_MCP_URL}\n\n` +
      "  • Or re-run the terminal install flow:\n" +
      "      npx -y @leadbay/mcp@latest install --oauth\n\n"
  );
}

export interface DesktopMode {
  legacy: boolean;
  dxt: boolean;
  markers: string[];
}

export interface DetectedClient {
  id: "claude-code" | "claude-desktop" | "cursor" | "codex" | "chatgpt-desktop";
  label: string;
  /** Human-readable display string shown in the UI. May contain spaces or annotations like "(will be created)". */
  detail: string;
  /** Absolute path to the config file to read/write. Always set for file-based clients; absent for chatgpt-desktop. */
  configPath?: string;
  mode?: DesktopMode;
  /** Platform support dir for Claude Desktop (e.g. ~/.config/Claude). Only set for claude-desktop. */
  supportDir?: string;
}

export function formatInstallOsLabel(
  platform = process.platform,
  arch = process.arch
): string {
  const name = platform === "darwin"
    ? "macOS"
    : platform === "win32"
    ? "Windows"
    : platform === "linux"
    ? "Linux"
    : platform;
  return `${name} (${arch})`;
}

export function detectClaudeDesktopMode(claudeSupportDir: string): DesktopMode {
  const markers: string[] = [];
  const legacy = existsSync(join(claudeSupportDir, "claude_desktop_config.json"));
  if (existsSync(join(claudeSupportDir, "Claude Extensions"))) {
    markers.push("Claude Extensions/");
  }
  if (existsSync(join(claudeSupportDir, "extensions-installations.json"))) {
    markers.push("extensions-installations.json");
  }
  const cfgPath = join(claudeSupportDir, "config.json");
  if (existsSync(cfgPath)) {
    try {
      const raw = readFileSync(cfgPath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const hasDxtKey = Object.keys(parsed).some((key) => key.startsWith("dxt:"));
        if (hasDxtKey) markers.push("config.json (dxt:* keys)");
      }
    } catch {
      // Malformed app prefs should not block install detection.
    }
  }
  return { legacy, dxt: markers.length > 0, markers };
}

async function findOnPath(bin: string): Promise<string | null> {
  return await new Promise<string | null>((resolve) => {
    const cmd = process.platform === "win32" ? "where" : "which";
    const child = spawn(cmd, [bin], { stdio: ["ignore", "pipe", "ignore"] });
    let buf = "";
    child.stdout.on("data", (chunk: Buffer) => (buf += chunk.toString()));
    child.on("close", (code: number) => resolve(code === 0 ? buf.split(/\r?\n/)[0] : null));
    child.on("error", () => resolve(null));
  });
}

async function windowsStoreAppInstalled(packageName: string, appName: string): Promise<boolean> {
  if (process.platform !== "win32") return false;
  return await new Promise<boolean>((resolve) => {
    const script = [
      `$pkg = Get-AppxPackage -Name '${packageName}' -ErrorAction SilentlyContinue`,
      `$app = Get-StartApps | Where-Object { $_.AppID -like '${packageName}_*!${appName}' } | Select-Object -First 1`,
      "if ($pkg -or $app) { exit 0 } else { exit 1 }",
    ].join("; ");
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("close", (code: number | null) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

/**
 * A Microsoft Store (MSIX) install of Claude Desktop lives under
 * `%LOCALAPPDATA%\Packages\Claude_<publisherhash>\…` — never at any of the
 * traditional EXE paths, so the install-presence check missed Store users
 * entirely (#3802). Glob the `Claude_` prefix: the publisher hash
 * (e.g. `pzs8sxrjxfjjc`) is per-publisher and must not be hardcoded. Synchronous
 * and PowerShell-free, so it's unit-testable against a temp dir.
 */
export function isClaudeStorePackagePresent(localAppData: string): boolean {
  const packagesDir = join(localAppData, "Packages");
  if (!existsSync(packagesDir)) return false;
  try {
    return readdirSync(packagesDir).some((name) => /^Claude_/i.test(name));
  } catch {
    return false;
  }
}

async function isClaudeDesktopInstalled(home: string): Promise<boolean> {
  if (process.platform === "darwin") {
    return existsSync("/Applications/Claude.app") || existsSync(home + "/Applications/Claude.app");
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? home + "/AppData/Local";
    const programFiles = process.env.ProgramFiles;
    const programFilesX86 = process.env["ProgramFiles(x86)"];
    const exeInstalled = [
      local + "/Programs/Claude/Claude.exe",
      local + "/Claude/Claude.exe",
      programFiles ? programFiles + "/Claude/Claude.exe" : null,
      programFilesX86 ? programFilesX86 + "/Claude/Claude.exe" : null,
    ].some((candidate) => candidate !== null && existsSync(candidate));
    if (exeInstalled) return true;
    // Microsoft Store install: MSIX package dir under %LOCALAPPDATA%\Packages.
    if (isClaudeStorePackagePresent(local)) return true;
    // Backstop when the package dir is unreadable: ask the Appx registry.
    return await windowsStoreAppInstalled("AnthropicPBC.Claude", "Claude");
  }

  const desktopBin = await findOnPath("claude-desktop");
  if (desktopBin) return true;
  return (
    existsSync(home + "/.local/share/applications/claude-desktop.desktop") ||
    existsSync("/usr/share/applications/claude-desktop.desktop") ||
    existsSync("/opt/Claude/Claude") ||
    existsSync("/opt/Claude/claude") ||
    existsSync("/opt/claude/claude")
  );
}

async function isChatGptDesktopInstalled(home: string): Promise<boolean> {
  if (process.platform === "darwin") {
    return existsSync("/Applications/ChatGPT.app") || existsSync(home + "/Applications/ChatGPT.app");
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? home + "/AppData/Local";
    const programFiles = process.env.ProgramFiles;
    const programFilesX86 = process.env["ProgramFiles(x86)"];
    const exeInstalled = [
      local + "/Programs/ChatGPT/ChatGPT.exe",
      local + "/ChatGPT/ChatGPT.exe",
      programFiles ? programFiles + "/OpenAI/ChatGPT/ChatGPT.exe" : null,
      programFiles ? programFiles + "/ChatGPT/ChatGPT.exe" : null,
      programFilesX86 ? programFilesX86 + "/OpenAI/ChatGPT/ChatGPT.exe" : null,
      programFilesX86 ? programFilesX86 + "/ChatGPT/ChatGPT.exe" : null,
    ].some((candidate) => candidate !== null && existsSync(candidate));
    return exeInstalled || await windowsStoreAppInstalled("OpenAI.ChatGPT-Desktop", "ChatGPT");
  }
  return false;
}

async function isCursorInstalled(home: string): Promise<boolean> {
  const cursorBin = await findOnPath("cursor");
  if (cursorBin) return true;
  if (process.platform === "darwin") return existsSync("/Applications/Cursor.app");
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? `${home}\\AppData\\Local`;
    return existsSync(`${local}\\Programs\\Cursor\\Cursor.exe`);
  }
  return existsSync("/usr/share/applications/cursor.desktop") || existsSync("/opt/Cursor/cursor");
}

export async function detectClients(): Promise<DetectedClient[]> {
  const out: DetectedClient[] = [];
  const home = homedir();

  const claudeBin = await findOnPath("claude");
  if (claudeBin) {
    out.push({ id: "claude-code", label: "Claude Code", detail: `${claudeBin} mcp add ...` });
  }

  const claudeSupportDir =
    process.platform === "win32"
      ? `${process.env.APPDATA ?? `${home}\\AppData\\Roaming`}\\Claude`
      : process.platform === "darwin"
      ? `${home}/Library/Application Support/Claude`
      : `${home}/.config/Claude`;
  const claudeDesktopPath =
    process.platform === "win32"
      ? `${claudeSupportDir}\\claude_desktop_config.json`
      : `${claudeSupportDir}/claude_desktop_config.json`;
  const mode = detectClaudeDesktopMode(claudeSupportDir);
  if (await isClaudeDesktopInstalled(home)) {
    out.push({ id: "claude-desktop", label: "Claude Desktop", detail: claudeDesktopPath, configPath: claudeDesktopPath, mode, supportDir: claudeSupportDir });
  }

  if (await isChatGptDesktopInstalled(home)) {
    out.push({ id: "chatgpt-desktop", label: "ChatGPT Desktop", detail: HOSTED_MCP_URL });
  }

  const cursorPath = process.platform === "win32" ? `${home}\\.cursor\\mcp.json` : `${home}/.cursor/mcp.json`;
  if (await isCursorInstalled(home)) {
    out.push({
      id: "cursor",
      label: "Cursor",
      detail: existsSync(cursorPath) ? cursorPath : `${cursorPath} (will be created)`,
      configPath: cursorPath,
    });
  }

  const codexBin = await findOnPath("codex");
  const codexDir = process.platform === "win32" ? `${process.env.USERPROFILE ?? home}\\.codex` : `${home}/.codex`;
  if (codexBin) {
    const codexConfigPath = process.platform === "win32" ? `${codexDir}\\config.toml` : `${codexDir}/config.toml`;
    out.push({ id: "codex", label: "Codex", detail: codexConfigPath, configPath: codexConfigPath });
  }

  return out;
}
