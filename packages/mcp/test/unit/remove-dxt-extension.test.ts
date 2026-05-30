/**
 * Unit tests for removeDxtExtension.
 *
 * When DXT markers are present for Claude Desktop, the installer now removes
 * the Leadbay DXT extension (files + registry entry) and falls through to the
 * normal JSON config install. This tests the removal logic in isolation.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { removeDxtExtension } from "../../src/bin.js";

const EXT_ID = "local.dxt.leadbay.leadbay";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "leadbay-remove-dxt-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeFullDxtInstall(supportDir: string): { extDir: string; registryPath: string } {
  const extDir = join(supportDir, "Claude Extensions", EXT_ID);
  mkdirSync(extDir, { recursive: true });
  writeFileSync(join(extDir, "manifest.json"), JSON.stringify({ name: "leadbay" }), "utf8");

  const registry = {
    extensions: {
      [EXT_ID]: { id: EXT_ID, version: "0.16.0" },
      "other.ext": { id: "other.ext", version: "1.0.0" },
    },
  };
  const registryPath = join(supportDir, "extensions-installations.json");
  writeFileSync(registryPath, JSON.stringify(registry, null, 2), "utf8");
  return { extDir, registryPath };
}

describe("removeDxtExtension", () => {
  it("removes extension dir and registry entry when both exist", async () => {
    const { extDir, registryPath } = writeFullDxtInstall(dir);
    const result = await removeDxtExtension(dir);
    expect(result.ok).toBe(true);
    expect(result.removed).toBe(true);
    expect(existsSync(extDir)).toBe(false);
    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    expect(registry.extensions[EXT_ID]).toBeUndefined();
    expect(registry.extensions["other.ext"]).toBeDefined();
  });

  it("no-ops gracefully when neither file exists", async () => {
    const result = await removeDxtExtension(dir);
    expect(result.ok).toBe(true);
    expect(result.removed).toBe(false);
  });

  it("removes only the registry entry when extension dir is absent", async () => {
    const registry = { extensions: { [EXT_ID]: { id: EXT_ID } } };
    const registryPath = join(dir, "extensions-installations.json");
    writeFileSync(registryPath, JSON.stringify(registry), "utf8");
    const result = await removeDxtExtension(dir);
    expect(result.ok).toBe(true);
    expect(result.removed).toBe(true);
    const updated = JSON.parse(readFileSync(registryPath, "utf8"));
    expect(updated.extensions[EXT_ID]).toBeUndefined();
  });

  it("removes only extension dir when registry file is absent", async () => {
    const extDir = join(dir, "Claude Extensions", EXT_ID);
    mkdirSync(extDir, { recursive: true });
    writeFileSync(join(extDir, "manifest.json"), "{}", "utf8");
    const result = await removeDxtExtension(dir);
    expect(result.ok).toBe(true);
    expect(result.removed).toBe(true);
    expect(existsSync(extDir)).toBe(false);
  });

  it("no-ops when registry exists but has no leadbay entry", async () => {
    const registry = { extensions: { "other.ext": { id: "other.ext" } } };
    writeFileSync(join(dir, "extensions-installations.json"), JSON.stringify(registry), "utf8");
    const result = await removeDxtExtension(dir);
    expect(result.ok).toBe(true);
    expect(result.removed).toBe(false);
  });
});
