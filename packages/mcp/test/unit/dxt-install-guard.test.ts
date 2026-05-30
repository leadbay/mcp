/**
 * Unit tests for the DXT install guard in installInto().
 *
 * When detectClaudeDesktopMode() returns dxt=true, the installer must
 * skip writing to claude_desktop_config.json (Claude Desktop 2026
 * overwrites it on the next prefs save) and instead strip any stale
 * leadbay entry left over from a prior legacy install.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "leadbay-dxt-guard-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write a claude_desktop_config.json with a leadbay mcpServers entry. */
function writeLegacyConfig(dir: string): string {
  const path = join(dir, "claude_desktop_config.json");
  writeFileSync(
    path,
    JSON.stringify({
      mcpServers: {
        leadbay: {
          command: "npx",
          args: ["-y", "@leadbay/mcp@0.16"],
          env: { LEADBAY_TOKEN: "tok", LEADBAY_REGION: "fr" },
        },
      },
    }),
    "utf8"
  );
  return path;
}

/** Write a claude_desktop_config.json with NO leadbay entry. */
function writeLegacyConfigNoLeadbay(dir: string): string {
  const path = join(dir, "claude_desktop_config.json");
  writeFileSync(path, JSON.stringify({ mcpServers: { other: {} } }), "utf8");
  return path;
}

// ---------------------------------------------------------------------------
// Tests — these exercise stripJsonMcpEntry logic through uninstallFromJsonConfig
// which installInto calls when DXT is detected.
// ---------------------------------------------------------------------------

import { stripJsonMcpEntry } from "../../src/bin.js";

describe("DXT install guard — stripJsonMcpEntry (unit)", () => {
  it("removes leadbay entry when present", () => {
    const input = JSON.stringify({
      mcpServers: { leadbay: { command: "npx" }, other: {} },
    });
    const { content, changed } = stripJsonMcpEntry(input);
    expect(changed).toBe(true);
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers.leadbay).toBeUndefined();
    expect(parsed.mcpServers.other).toBeDefined();
  });

  it("returns changed=false when leadbay entry is absent", () => {
    const input = JSON.stringify({ mcpServers: { other: {} } });
    const { changed } = stripJsonMcpEntry(input);
    expect(changed).toBe(false);
  });

  it("returns changed=false for empty JSON object", () => {
    const { changed } = stripJsonMcpEntry("{}");
    expect(changed).toBe(false);
  });

  it("returns unchanged content on malformed JSON", () => {
    const bad = "{not valid json";
    const { content, changed } = stripJsonMcpEntry(bad);
    expect(changed).toBe(false);
    expect(content).toBe(bad);
  });
});

import { uninstallFromJsonConfig } from "../../src/bin.js";

describe("DXT install guard — uninstallFromJsonConfig (integration)", () => {
  it("removes leadbay entry from an existing config file", async () => {
    const configPath = writeLegacyConfig(tmpDir);
    const result = await uninstallFromJsonConfig(configPath);
    expect(result.ok).toBe(true);
    expect(result.message).toBe("removed");
  });

  it("no-ops when config file does not exist", async () => {
    const result = await uninstallFromJsonConfig(join(tmpDir, "nonexistent.json"));
    expect(result.ok).toBe(true);
  });

  it("reports leadbay entry not present when missing from existing file", async () => {
    const configPath = writeLegacyConfigNoLeadbay(tmpDir);
    const result = await uninstallFromJsonConfig(configPath);
    expect(result.ok).toBe(true);
    expect(result.message).toBe("leadbay entry not present");
  });
});
