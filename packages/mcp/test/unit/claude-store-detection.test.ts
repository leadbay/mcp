/**
 * Unit tests for isClaudeStorePackagePresent.
 *
 * Regression guard for #3802: Claude Desktop installed from the Microsoft Store
 * is an MSIX package living under `%LOCALAPPDATA%\Packages\Claude_<publisherhash>\`
 * (the issue screenshot shows `…\Packages\Claude_pzs8sxrjxfjjc`). The installer's
 * presence check only probed the traditional EXE paths, so Store users were
 * reported as "Claude not installed". This helper is the synchronous filesystem
 * signal that detects the MSIX package dir by its `Claude_` prefix — the
 * publisher hash must never be hardcoded.
 *
 * New file (existing dxt-detection.test.ts is left untouched).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isClaudeStorePackagePresent } from "../../installer/install-shared.js";

let local: string;

beforeEach(() => {
  // A fake %LOCALAPPDATA% root.
  local = mkdtempSync(join(tmpdir(), "leadbay-store-test-"));
});

afterEach(() => {
  rmSync(local, { recursive: true, force: true });
});

describe("isClaudeStorePackagePresent", () => {
  it("detects the exact Store package dir from the issue screenshot", () => {
    mkdirSync(join(local, "Packages", "Claude_pzs8sxrjxfjjc"), { recursive: true });
    expect(isClaudeStorePackagePresent(local)).toBe(true);
  });

  it("detects any Claude_<hash> dir (publisher hash is not hardcoded)", () => {
    mkdirSync(join(local, "Packages", "Claude_someotherhash123"), { recursive: true });
    expect(isClaudeStorePackagePresent(local)).toBe(true);
  });

  it("false when Packages/ exists but holds no Claude_ package", () => {
    mkdirSync(join(local, "Packages", "Microsoft.WindowsStore_8wekyb3d8bbwe"), { recursive: true });
    expect(isClaudeStorePackagePresent(local)).toBe(false);
  });

  it("false for a sibling that merely contains 'Claude' but lacks the Claude_ prefix", () => {
    mkdirSync(join(local, "Packages", "NotClaude_x"), { recursive: true });
    mkdirSync(join(local, "Packages", "SomeClaudeThing"), { recursive: true });
    expect(isClaudeStorePackagePresent(local)).toBe(false);
  });

  it("false when Packages/ is empty", () => {
    mkdirSync(join(local, "Packages"));
    expect(isClaudeStorePackagePresent(local)).toBe(false);
  });

  it("false when Packages/ is absent entirely", () => {
    expect(isClaudeStorePackagePresent(local)).toBe(false);
  });
});
