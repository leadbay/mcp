/**
 * Smoke test for the .dxt bundle built by @leadbay/dxt.
 *
 * Guards the published archive's shape so a broken manifest doesn't ship:
 *   - manifest_version / name / version wire-match
 *   - server entry_point file is actually in the archive
 *   - user_config.leadbay_token is marked sensitive
 *
 * Gated on the .dxt existing — `pnpm --filter @leadbay/dxt build` produces it;
 * if not built, this test is skipped (same pattern as npx-entrypoint.test.ts).
 */
import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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

  it("manifest.json has the expected MCPB 0.3 shape", () => {
    const entries = listZip(dxtPath!);
    expect(entries).toContain("manifest.json");
    const manifest = JSON.parse(readFromZip(dxtPath!, "manifest.json"));
    expect(manifest.manifest_version).toBe("0.3");
    expect(manifest.dxt_version).toBeUndefined();
    expect(manifest.name).toBe("leadbay");
    expect(manifest.version).toBe(mcpVersion);
    expect(manifest.server?.type).toBe("node");
    expect(manifest.server?.entry_point).toBe("server/index.js");
  });

  it("bundles the server entry point", () => {
    const entries = listZip(dxtPath!);
    expect(entries).toContain("server/index.js");
  });

  it("packaged server completes an MCP initialize handshake", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "leadbay-dxt-smoke-"));
    try {
      execFileSync("unzip", ["-q", dxtPath!, "-d", tmp]);
      const serverEntry = path.join(tmp, "server", "index.js");
      const baseEnv = Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      );
      const transport = new StdioClientTransport({
        command: "node",
        args: [serverEntry],
        env: {
          ...baseEnv,
          HOME: tmp,
          LEADBAY_TOKEN: "smoke-token",
          LEADBAY_REGION: "us",
          LEADBAY_UPDATE_CHECK_DISABLED: "1",
          LEADBAY_TELEMETRY_ENABLED: "false",
          LEADBAY_BULK_STORE_ALLOW_MEMORY: "1",
        },
      });
      const client = new Client({ name: "dxt-smoke", version: "0.0.1" }, {});
      try {
        await client.connect(transport);
        const listed = await client.listTools();
        expect(listed.tools.map((t) => t.name)).toContain("leadbay_account_status");
      } finally {
        await client.close();
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("leadbay_token user_config is marked sensitive and required", () => {
    const manifest = JSON.parse(readFromZip(dxtPath!, "manifest.json"));
    expect(manifest.user_config.leadbay_token.sensitive).toBe(true);
    expect(manifest.user_config.leadbay_token.required).toBe(true);
  });

  it("leadbay_region defaults to fr without unsupported enum keys", () => {
    const manifest = JSON.parse(readFromZip(dxtPath!, "manifest.json"));
    expect(manifest.user_config.leadbay_region.default).toBe("fr");
    expect(manifest.user_config.leadbay_region.enum).toBeUndefined();
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
