import { describe, it, expect } from "vitest";
import { formatInstallOsLabel, parseInstallSelection, updateInstallWizardState } from "../../src/bin.js";

describe("parseInstallSelection", () => {
  it("defaults empty input to all detected clients", () => {
    expect(parseInstallSelection("", 3)).toEqual([0, 1, 2]);
  });

  it("accepts all/a aliases", () => {
    expect(parseInstallSelection("all", 2)).toEqual([0, 1]);
    expect(parseInstallSelection("a", 2)).toEqual([0, 1]);
  });

  it("accepts comma or space separated numbers", () => {
    expect(parseInstallSelection("1,3", 4)).toEqual([0, 2]);
    expect(parseInstallSelection("2 1", 4)).toEqual([0, 1]);
  });

  it("deduplicates selected numbers", () => {
    expect(parseInstallSelection("2,2,1", 3)).toEqual([0, 1]);
  });

  it("returns an empty selection for none/quit aliases", () => {
    expect(parseInstallSelection("none", 3)).toEqual([]);
    expect(parseInstallSelection("q", 3)).toEqual([]);
  });

  it("rejects invalid selections", () => {
    expect(parseInstallSelection("0", 3)).toBeNull();
    expect(parseInstallSelection("4", 3)).toBeNull();
    expect(parseInstallSelection("codex", 3)).toBeNull();
  });
});

describe("formatInstallOsLabel", () => {
  it("renders friendly platform names", () => {
    expect(formatInstallOsLabel("darwin", "arm64")).toBe("macOS (arm64)");
    expect(formatInstallOsLabel("win32", "x64")).toBe("Windows (x64)");
    expect(formatInstallOsLabel("linux", "x64")).toBe("Linux (x64)");
  });
});


describe("updateInstallWizardState", () => {
  it("moves with arrow keys", () => {
    const state = updateInstallWizardState("\x1B[B", 0, [true, true, true]);
    expect(state.cursor).toBe(1);
    expect(updateInstallWizardState("\x1B[A", 0, [true, true]).cursor).toBe(1);
  });

  it("toggles the active item with space", () => {
    const state = updateInstallWizardState(" ", 1, [true, true, true]);
    expect(state.selected).toEqual([true, false, true]);
  });

  it("confirms with enter and cancels with q", () => {
    expect(updateInstallWizardState("\r", 0, [true]).done).toBe(true);
    expect(updateInstallWizardState("q", 0, [true]).cancel).toBe(true);
  });

  it("supports select all / none shortcuts", () => {
    expect(updateInstallWizardState("n", 0, [true, true]).selected).toEqual([false, false]);
    expect(updateInstallWizardState("a", 0, [false, false]).selected).toEqual([true, true]);
  });
});
