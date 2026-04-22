/**
 * Unit tests for detectClaudeDesktopMode.
 *
 * Regression guard for #3504: Claude Desktop 2026 ships DXT (Desktop Extension)
 * packaging. Writing to the legacy claude_desktop_config.json on those machines
 * is a silent no-op — Claude Desktop overwrites our mcpServers block on the
 * next prefs save. `install` needs to detect DXT and default-skip the legacy
 * write; the helper here is what drives that decision.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectClaudeDesktopMode } from "../../src/bin.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "leadbay-dxt-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("detectClaudeDesktopMode", () => {
  it("empty dir → not legacy, not dxt, no markers", () => {
    const m = detectClaudeDesktopMode(dir);
    expect(m).toEqual({ legacy: false, dxt: false, markers: [] });
  });

  it("legacy file only → legacy, not dxt", () => {
    writeFileSync(join(dir, "claude_desktop_config.json"), "{}", "utf8");
    const m = detectClaudeDesktopMode(dir);
    expect(m.legacy).toBe(true);
    expect(m.dxt).toBe(false);
    expect(m.markers).toEqual([]);
  });

  it("Claude Extensions/ dir → dxt detected", () => {
    mkdirSync(join(dir, "Claude Extensions"));
    const m = detectClaudeDesktopMode(dir);
    expect(m.dxt).toBe(true);
    expect(m.markers).toContain("Claude Extensions/");
  });

  it("extensions-installations.json → dxt detected", () => {
    writeFileSync(join(dir, "extensions-installations.json"), "[]", "utf8");
    const m = detectClaudeDesktopMode(dir);
    expect(m.dxt).toBe(true);
    expect(m.markers).toContain("extensions-installations.json");
  });

  it("config.json with dxt:* keys → dxt detected", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        "dxt:allowlistEnabled": true,
        "dxt:allowlistCache": {},
        other: "ignored",
      }),
      "utf8"
    );
    const m = detectClaudeDesktopMode(dir);
    expect(m.dxt).toBe(true);
    expect(m.markers).toContain("config.json (dxt:* keys)");
  });

  it("config.json without dxt:* keys → not dxt", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ preferences: { theme: "dark" } }),
      "utf8"
    );
    const m = detectClaudeDesktopMode(dir);
    expect(m.dxt).toBe(false);
    expect(m.markers).toEqual([]);
  });

  it("malformed config.json → silently ignored (no crash)", () => {
    writeFileSync(join(dir, "config.json"), "{not json", "utf8");
    const m = detectClaudeDesktopMode(dir);
    expect(m.dxt).toBe(false);
  });

  it("legacy file AND dxt markers (Ludo's actual Mac state) → both flagged", () => {
    writeFileSync(
      join(dir, "claude_desktop_config.json"),
      JSON.stringify({ preferences: { sidebarMode: "task" } }),
      "utf8"
    );
    mkdirSync(join(dir, "Claude Extensions"));
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ "dxt:allowlistEnabled": true }),
      "utf8"
    );
    const m = detectClaudeDesktopMode(dir);
    expect(m.legacy).toBe(true);
    expect(m.dxt).toBe(true);
    expect(m.markers.length).toBeGreaterThanOrEqual(2);
  });

  it("all three dxt markers → all listed", () => {
    mkdirSync(join(dir, "Claude Extensions"));
    writeFileSync(join(dir, "extensions-installations.json"), "[]", "utf8");
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ "dxt:allowlistEnabled": true }),
      "utf8"
    );
    const m = detectClaudeDesktopMode(dir);
    expect(m.markers).toContain("Claude Extensions/");
    expect(m.markers).toContain("extensions-installations.json");
    expect(m.markers).toContain("config.json (dxt:* keys)");
    expect(m.markers.length).toBe(3);
  });
});
