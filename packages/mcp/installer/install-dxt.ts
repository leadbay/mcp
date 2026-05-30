const DXT_EXTENSION_ID = "local.dxt.leadbay.leadbay";

/**
 * Remove the Leadbay DXT extension from Claude Desktop's extension registry
 * and delete its files. After this, `claude_desktop_config.json` is the
 * authoritative config source again.
 */
export async function removeDxtExtension(claudeSupportDir: string): Promise<{ ok: boolean; removed: boolean; message: string }> {
  try {
    const { existsSync, readFileSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");

    const extensionDir = join(claudeSupportDir, "Claude Extensions", DXT_EXTENSION_ID);
    const registryPath = join(claudeSupportDir, "extensions-installations.json");

    let removedDir = false;
    let removedEntry = false;

    if (existsSync(extensionDir)) {
      rmSync(extensionDir, { recursive: true, force: true });
      removedDir = true;
    }

    if (existsSync(registryPath)) {
      try {
        const raw = readFileSync(registryPath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed?.extensions?.[DXT_EXTENSION_ID]) {
          delete parsed.extensions[DXT_EXTENSION_ID];
          const tmp = registryPath + ".tmp";
          writeFileSync(tmp, JSON.stringify(parsed, null, 2) + "\n", "utf8");
          const { renameSync } = await import("node:fs");
          renameSync(tmp, registryPath);
          removedEntry = true;
        }
      } catch {
        // Malformed registry — leave it alone, don't block install.
      }
    }

    const removed = removedDir || removedEntry;
    return {
      ok: true,
      removed,
      message: removed ? "DXT extension removed" : "DXT extension not installed",
    };
  } catch (err: any) {
    return { ok: false, removed: false, message: err?.message ?? String(err) };
  }
}
