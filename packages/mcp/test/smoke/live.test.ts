/**
 * LIVE smoke test for @leadbay/mcp — spawns the built stdio server as a
 * subprocess and drives it via the MCP SDK client.
 *
 * Opt-in: set LEADBAY_TEST_TOKEN. Skipped otherwise.
 * Requires: packages/mcp/dist/bin.js (run `pnpm --filter @leadbay/mcp build` first).
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const TOKEN = process.env.LEADBAY_TEST_TOKEN;
const REGION = process.env.LEADBAY_TEST_REGION ?? "us";
const BASE_URL = process.env.LEADBAY_TEST_BASE_URL;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, "..", "..", "dist", "bin.js");

const hasToken = !!TOKEN;
const hasBuild = existsSync(BIN);
const runLive = hasToken && hasBuild;

if (!hasToken) {
  console.log("[smoke] SMOKE_SKIPPED: set LEADBAY_TEST_TOKEN to run live smoke tests");
} else if (!hasBuild) {
  console.log(`[smoke] SMOKE_SKIPPED: missing built bin at ${BIN} — run pnpm build first`);
}

describe.skipIf(!runLive)("@leadbay/mcp — live stdio round-trip", () => {
  it("initialize + tools/list + tools/call leadbay_find_prospects", async () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      LEADBAY_TOKEN: TOKEN!,
      LEADBAY_REGION: REGION,
    };
    if (BASE_URL) env.LEADBAY_BASE_URL = BASE_URL;

    const transport = new StdioClientTransport({
      command: "node",
      args: [BIN],
      env: env as Record<string, string>,
    });

    const client = new Client({ name: "smoke", version: "0.0.1" }, {});
    await client.connect(transport);

    try {
      const listed = await client.listTools();
      const names = listed.tools.map((t) => t.name);
      expect(names).toContain("leadbay_find_prospects");
      expect(names).not.toContain("leadbay_login");

      const result = await client.callTool({
        name: "leadbay_find_prospects",
        arguments: { count: 1 },
      });
      expect(result.isError).toBeFalsy();
      const content = result.content as any[];
      const text = content[0].text;
      const parsed = JSON.parse(text);
      expect(parsed).toHaveProperty("leads");
      expect(Array.isArray(parsed.leads)).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("doctor subcommand exits 0 with account info", async () => {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("node", [BIN, "doctor"], {
        env: {
          ...process.env,
          LEADBAY_TOKEN: TOKEN!,
          LEADBAY_REGION: REGION,
        },
      });
      let stdout = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.on("exit", (code) => {
        try {
          expect(code).toBe(0);
          expect(stdout).toMatch(/Leadbay connection OK/);
          expect(stdout).toMatch(/Organization:/);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  });
});
