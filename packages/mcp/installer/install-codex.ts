function shellQuote(value: string): string {
  return '"' + value.replace(/([\"\\$`])/g, "\\$1") + '"';
}

export function buildCodexConfigBlock(
  includeWrite: boolean,
  telemetryEnabled: boolean,
  version = "latest"
): string {
  const envVars = ["LEADBAY_TOKEN", "LEADBAY_REGION", "LEADBAY_TELEMETRY_ENABLED"];
  if (!includeWrite) envVars.push("LEADBAY_MCP_WRITE");
  const envVarsToml = envVars.map((v) => `"${v}"`).join(", ");
  return (
    `[mcp_servers.leadbay]\n` +
    `command = "npx"\n` +
    `args = ["-y", "@leadbay/mcp@${version}"]\n` +
    `env_vars = [${envVarsToml}]\n`
  );
}

export function buildShellExportBlock(
  token: string,
  region: "us" | "fr",
  includeWrite: boolean,
  telemetryEnabled: boolean
): string {
  const lines = [
    "",
    "# Added by leadbay-mcp install",
    `export LEADBAY_TOKEN=${shellQuote(token)}`,
    `export LEADBAY_REGION=${shellQuote(region)}`,
    `export LEADBAY_TELEMETRY_ENABLED=${shellQuote(telemetryEnabled ? "true" : "false")}`,
  ];
  if (!includeWrite) {
    lines.push(`export LEADBAY_MCP_WRITE=${shellQuote("0")}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function mergeCodexConfig(existing: string, block: string): string {
  const withoutLeadbay = existing.replace(
    /(^|\r?\n)\[mcp_servers\.leadbay\]\r?\n[\s\S]*?(?=\r?\n\[|$)/g,
    (match, prefix: string) => prefix && match.startsWith(prefix) ? prefix : ""
  );
  const trimmed = withoutLeadbay.trimEnd();
  return `${trimmed ? `${trimmed}\n\n` : ""}${block.trimEnd()}\n`;
}

export function mergeShellExportBlock(existing: string, block: string): { content: string; changed: boolean } {
  const managedBlock = /(^|\r?\n)# Added by leadbay-mcp install\r?\nexport LEADBAY_TOKEN=.*\r?\nexport LEADBAY_REGION=.*\r?\nexport LEADBAY_TELEMETRY_ENABLED=.*\r?\n(?:export LEADBAY_MCP_WRITE=.*\r?\n)?/g;
  const stripped = existing.replace(managedBlock, (match, prefix: string) => prefix || "");
  if (stripped === existing && existing.includes("LEADBAY_TOKEN=")) {
    return { content: existing, changed: false };
  }
  const trimmed = stripped.trimEnd();
  return {
    content: `${trimmed ? `${trimmed}\n` : ""}${block}`,
    changed: true,
  };
}

export function stripCodexBlock(existing: string): { content: string; changed: boolean } {
  const stripped = existing.replace(
    /(^|\r?\n)\[mcp_servers\.leadbay\]\r?\n[\s\S]*?(?=\r?\n\[|$)/g,
    (match, prefix: string) => (prefix && match.startsWith(prefix) ? prefix : "")
  );
  if (stripped === existing) return { content: existing, changed: false };
  const trimmed = stripped.trimEnd();
  return { content: trimmed ? trimmed + "\n" : "", changed: true };
}

export function stripShellExportBlock(existing: string): { content: string; changed: boolean } {
  const managedBlock = /(^|\r?\n)# Added by leadbay-mcp install\r?\nexport LEADBAY_TOKEN=.*\r?\nexport LEADBAY_REGION=.*\r?\nexport LEADBAY_TELEMETRY_ENABLED=.*\r?\n(?:export LEADBAY_MCP_WRITE=.*\r?\n)?/g;
  const stripped = existing.replace(managedBlock, (match, prefix: string) => prefix || "");
  if (stripped === existing) return { content: existing, changed: false };
  return { content: stripped.trimEnd() + (stripped.trimEnd() ? "\n" : ""), changed: true };
}

export async function installInCodexConfig(
  configPath: string,
  includeWrite: boolean,
  telemetryEnabled: boolean
): Promise<{ ok: boolean; message: string }> {
  try {
    const { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, renameSync, chmodSync } = await import("node:fs");
    const { dirname } = await import("node:path");

    let existing = "";
    const existed = existsSync(configPath);
    if (existed) {
      existing = readFileSync(configPath, "utf8");
    } else {
      mkdirSync(dirname(configPath), { recursive: true });
    }
    const hadLeadbayConfig = /(^|\r?\n)\[mcp_servers\.leadbay\]\r?\n/.test(existing);

    const next = mergeCodexConfig(
      existing,
      buildCodexConfigBlock(includeWrite, telemetryEnabled)
    );
    const tmp = `${configPath}.tmp`;
    writeFileSync(tmp, next, "utf8");
    renameSync(tmp, configPath);
    try {
      const st = statSync(configPath);
      if (!existed || (st.mode & 0o777) > 0o600) {
        chmodSync(configPath, 0o600);
      }
    } catch { /* best-effort */ }

    return { ok: true, message: hadLeadbayConfig ? "updated" : "registered" };
  } catch (err: any) {
    return { ok: false, message: err?.message ?? String(err) };
  }
}

export async function appendShellExports(
  token: string,
  region: "us" | "fr",
  includeWrite: boolean,
  telemetryEnabled: boolean
): Promise<{ ok: boolean; message: string }> {
  try {
    const cp = await import("node:child_process");
    if (process.platform === "win32") {
      const values: Record<string, string> = {
        LEADBAY_TOKEN: token,
        LEADBAY_REGION: region,
        LEADBAY_TELEMETRY_ENABLED: telemetryEnabled ? "true" : "false",
      };
      if (!includeWrite) values.LEADBAY_MCP_WRITE = "0";
      for (const [key, value] of Object.entries(values)) {
        const ok = await new Promise<boolean>((resolve) => {
          const child = cp.spawn("setx", [key, value], { stdio: "ignore" });
          child.on("close", (code) => resolve(code === 0));
          child.on("error", () => resolve(false));
        });
        if (!ok) return { ok: false, message: `failed to set ${key} with setx` };
      }
      return { ok: true, message: "env exported with setx; restart Codex/terminal" };
    }

    const { existsSync, readFileSync, writeFileSync, renameSync } = await import("node:fs");
    const os = await import("node:os");
    const home = os.homedir();
    const preferred = [`${home}/.zshrc`, `${home}/.bashrc`].filter((path) => existsSync(path));
    const paths = preferred.length ? preferred : [`${home}/.profile`];
    const block = buildShellExportBlock(token, region, includeWrite, telemetryEnabled);
    const updated: string[] = [];

    for (const path of paths) {
      const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
      const merged = mergeShellExportBlock(existing, block);
      if (!merged.changed) continue;
      const tmp = `${path}.leadbay.tmp`;
      writeFileSync(tmp, merged.content, "utf8");
      renameSync(tmp, path);
      updated.push(path);
    }

    return {
      ok: true,
      message: updated.length
        ? `env exported to ${updated.join(", ")}; restart Codex/terminal or source the file`
        : "env exports already present",
    };
  } catch (err: any) {
    return { ok: false, message: err?.message ?? String(err) };
  }
}

export async function uninstallFromCodexConfig(configPath: string): Promise<{ ok: boolean; message: string }> {
  try {
    const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
    if (!existsSync(configPath)) return { ok: true, message: "config not found — nothing to do" };
    const existing = readFileSync(configPath, "utf8");
    const { content, changed } = stripCodexBlock(existing);
    if (!changed) return { ok: true, message: "leadbay block not present" };
    writeFileSync(configPath, content, "utf8");
    return { ok: true, message: "removed from TOML" };
  } catch (err: any) {
    return { ok: false, message: err?.message ?? String(err) };
  }
}

export async function uninstallShellExports(): Promise<{ ok: boolean; message: string }> {
  try {
    const { existsSync, readFileSync, writeFileSync, renameSync } = await import("node:fs");
    const os = await import("node:os");
    const home = os.homedir();
    const candidates = [`${home}/.zshrc`, `${home}/.bashrc`, `${home}/.profile`].filter((p) =>
      existsSync(p)
    );
    const updated: string[] = [];
    for (const p of candidates) {
      const existing = readFileSync(p, "utf8");
      const { content, changed } = stripShellExportBlock(existing);
      if (!changed) continue;
      const tmp = `${p}.leadbay.tmp`;
      writeFileSync(tmp, content, "utf8");
      renameSync(tmp, p);
      updated.push(p);
    }
    return {
      ok: true,
      message: updated.length
        ? `removed from ${updated.join(", ")}; restart terminal or source the file`
        : "managed export block not found in shell files",
    };
  } catch (err: any) {
    return { ok: false, message: err?.message ?? String(err) };
  }
}
