interface MCPConfigShape {
  mcpServers?: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}

export async function installInJsonConfig(
  configPath: string,
  token: string,
  region: "us" | "fr",
  includeWrite: boolean,
  telemetryEnabled: boolean,
  /** Absolute path to a local dist/bin.js for dev testing. Uses npx when unset. */
  localBinPath?: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } = await import("node:fs");
    const { dirname } = await import("node:path");

    let parsed: MCPConfigShape = {};
    let preserved: any = {};
    const existed = existsSync(configPath);
    if (existed) {
      const raw = readFileSync(configPath, "utf8");
      try {
        preserved = JSON.parse(raw);
        parsed = preserved;
      } catch {
        return { ok: false, message: `existing ${configPath} is not valid JSON; refusing to overwrite` };
      }
    } else {
      mkdirSync(dirname(configPath), { recursive: true });
    }

    parsed.mcpServers = parsed.mcpServers ?? {};
    const env: Record<string, string> = {
      LEADBAY_TOKEN: token,
      LEADBAY_REGION: region,
      // Always written so MCP-client config UIs can render it as a toggle.
      LEADBAY_TELEMETRY_ENABLED: telemetryEnabled ? "true" : "false",
    };
    // Default in 0.3.0 is writes-on; only set the env when explicitly disabled.
    if (!includeWrite) env.LEADBAY_MCP_WRITE = "0";

    parsed.mcpServers.leadbay = localBinPath
      ? { command: "node", args: [localBinPath], env }
      : { command: "npx", args: ["-y", "-p", "@leadbay/mcp@latest", "leadbay-mcp"], env };

    // Atomic-ish write: write to .tmp then rename, restore mode if pre-existed.
    const tmp = configPath + ".tmp";
    writeFileSync(tmp, JSON.stringify(parsed, null, 2) + "\n", "utf8");
    const { renameSync, chmodSync } = await import("node:fs");
    renameSync(tmp, configPath);
    // Tighten perms: existing config may already be 0644; leave it. But for
    // newly-created configs (didn't exist before), enforce 0600.
    try {
      const st = statSync(configPath);
      if ((st.mode & 0o777) > 0o600 && Object.keys(preserved).length === 0) {
        chmodSync(configPath, 0o600);
      }
    } catch { /* best-effort */ }

    return { ok: true, message: existed ? "updated" : "registered" };
  } catch (err: any) {
    return { ok: false, message: err?.message ?? String(err) };
  }
}

export function stripJsonMcpEntry(existing: string): { content: string; changed: boolean } {
  let parsed: any;
  try {
    parsed = JSON.parse(existing);
  } catch {
    return { content: existing, changed: false };
  }
  if (!parsed?.mcpServers?.leadbay) return { content: existing, changed: false };
  delete parsed.mcpServers.leadbay;
  return { content: JSON.stringify(parsed, null, 2) + "\n", changed: true };
}

export async function uninstallFromJsonConfig(configPath: string): Promise<{ ok: boolean; message: string }> {
  try {
    const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
    if (!existsSync(configPath)) return { ok: true, message: "config not found — nothing to do" };
    const existing = readFileSync(configPath, "utf8");
    const { content, changed } = stripJsonMcpEntry(existing);
    if (!changed) return { ok: true, message: "leadbay entry not present" };
    writeFileSync(configPath, content, "utf8");
    return { ok: true, message: "removed" };
  } catch (err: any) {
    return { ok: false, message: err?.message ?? String(err) };
  }
}
