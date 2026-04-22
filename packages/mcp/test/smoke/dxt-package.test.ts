/**
 * Smoke test for the .dxt bundle built by @leadbay/dxt.
 *
 * Guards the published archive's shape so a broken manifest doesn't ship:
 *   - dxt_version / name / version wire-match
 *   - server entry_point file is actually in the archive
 *   - user_config.leadbay_token is marked sensitive
 *
 * Gated on the .dxt existing — `pnpm --filter @leadbay/dxt build` produces it;
 * if not built, this test is skipped (same pattern as npx-entrypoint.test.ts).
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DXT_DIST = path.resolve(__dirname, "..", "..", "..", "dxt", "dist");

function findDxt(): string | null {
  if (!existsSync(DXT_DIST)) return null;
  const entries = readdirSync(DXT_DIST).filter((f) => f.endsWith(".dxt"));
  if (entries.length === 0) return null;
  return path.join(DXT_DIST, entries[0]);
}

const dxtPath = findDxt();
if (!dxtPath) {
  console.log(`[smoke] SMOKE_SKIPPED: no .dxt found in ${DXT_DIST} — run 'pnpm --filter @leadbay/dxt build' first`);
}

describe.skipIf(!dxtPath)("@leadbay/dxt — .dxt bundle shape", () => {
  const mcpVersion = JSON.parse(
    readFileSync(path.resolve(__dirname, "..", "..", "package.json"), "utf8")
  ).version as string;

  it("archive filename includes the mcp package version", () => {
    expect(path.basename(dxtPath!)).toBe(`leadbay-${mcpVersion}.dxt`);
  });

  it("manifest.json has the expected DXT 0.2 shape", () => {
    const entries = listZip(dxtPath!);
    expect(entries).toContain("manifest.json");
    const manifest = JSON.parse(readFromZip(dxtPath!, "manifest.json"));
    expect(manifest.dxt_version).toBe("0.2");
    expect(manifest.name).toBe("leadbay");
    expect(manifest.version).toBe(mcpVersion);
    expect(manifest.server?.type).toBe("node");
    expect(manifest.server?.entry_point).toBe("server/index.js");
  });

  it("bundles the server entry point", () => {
    const entries = listZip(dxtPath!);
    expect(entries).toContain("server/index.js");
  });

  it("leadbay_token user_config is marked sensitive and required", () => {
    const manifest = JSON.parse(readFromZip(dxtPath!, "manifest.json"));
    expect(manifest.user_config.leadbay_token.sensitive).toBe(true);
    expect(manifest.user_config.leadbay_token.required).toBe(true);
  });

  it("leadbay_region is an enum of us|fr", () => {
    const manifest = JSON.parse(readFromZip(dxtPath!, "manifest.json"));
    expect(manifest.user_config.leadbay_region.enum).toEqual(["us", "fr"]);
  });
});

function listZip(p: string): string[] {
  // -Z1 = one filename per line, no other metadata.
  const out = execFileSync("unzip", ["-Z1", p], { encoding: "utf8" });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

function readFromZip(p: string, entry: string): string {
  // -p = pipe to stdout.
  return execFileSync("unzip", ["-p", p, entry], { encoding: "utf8" });
}
