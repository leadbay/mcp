/**
 * product#4131 — a local install saves the full company list where the user
 * finds files: Downloads when it exists, the home folder otherwise.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveToDownloads } from "../../src/local-files.js";

const homes: string[] = [];
const fakeHome = () => {
  const h = mkdtempSync(join(tmpdir(), "lb-home-"));
  homes.push(h);
  return h;
};

afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

describe("saveToDownloads", () => {
  it("writes into Downloads when the folder exists", async () => {
    const home = fakeHome();
    mkdirSync(join(home, "Downloads"));
    const path = await saveToDownloads("leadbay-companies-3f57d723.csv", "a,b\n", home);
    expect(path).toBe(join(home, "Downloads", "leadbay-companies-3f57d723.csv"));
    expect(readFileSync(path, "utf8")).toBe("a,b\n");
  });

  it("falls back to the home folder when there is no Downloads", async () => {
    const home = fakeHome();
    const path = await saveToDownloads("list.csv", "x\n", home);
    expect(path).toBe(join(home, "list.csv"));
  });

  it("keeps only the last segment of the name", async () => {
    const home = fakeHome();
    const path = await saveToDownloads("../../escape.csv", "x\n", home);
    expect(path).toBe(join(home, "escape.csv"));
    expect(existsSync(join(home, "..", "escape.csv"))).toBe(false);
  });
});
