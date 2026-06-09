/**
 * Audit: packages/mcp/server.json stays aligned with package.json.
 *
 * The release pipeline (.github/workflows/release.yml) refuses to publish to
 * the MCP Registry unless server.json.version === package.json.version and
 * server.json.name === package.json.mcpName. That guard only runs at release
 * time, so a drift (e.g. bumping package.json without server.json) ships to
 * npm + the GitHub .mcpb and only fails the registry step — silently, after
 * the fact. server.json sat at 0.17.2 across the 0.17.3 / 0.18.0 / 0.18.1
 * releases for exactly this reason. This test moves the check to PR time.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/mcp/test/audit -> packages/mcp
const MCP_DIR = join(__dirname, "..", "..");

const pkg = JSON.parse(readFileSync(join(MCP_DIR, "package.json"), "utf8"));
const srv = JSON.parse(readFileSync(join(MCP_DIR, "server.json"), "utf8"));

describe("audit: server.json aligns with package.json", () => {
  it("top-level server.json.version matches package.json.version", () => {
    expect(srv.version).toBe(pkg.version);
  });

  it("server.json.name matches package.json.mcpName", () => {
    expect(srv.name).toBe(pkg.mcpName);
  });

  it("every server.json packages[].version matches package.json.version", () => {
    const versions = (srv.packages ?? []).map((p: { version?: string }) => p.version);
    for (const v of versions) {
      expect(v).toBe(pkg.version);
    }
  });

  it("the npm package entry identifies @leadbay/mcp", () => {
    const npmPkg = (srv.packages ?? []).find(
      (p: { registryType?: string }) => p.registryType === "npm"
    );
    expect(npmPkg?.identifier).toBe(pkg.name);
  });
});
