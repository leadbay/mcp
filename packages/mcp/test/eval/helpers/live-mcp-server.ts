/**
 * live-mcp-server.ts — real @leadbay/mcp server with real Leadbay API.
 *
 * Spawned by live-session-runner.ts with LEADBAY_TOKEN + LEADBAY_REGION env vars.
 * Unlike fixture-mcp-server.ts, this makes real HTTP calls — no mocking.
 *
 * stdout/stdin carry the MCP stdio protocol — the claude CLI connects to
 * this process as an MCP server.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../../../src/server.js";

const REGIONS: Record<string, string> = {
  us: "https://api-us.leadbay.app",
  fr: "https://api-fr.leadbay.app",
};

async function main(): Promise<void> {
  const token = process.env.LEADBAY_TOKEN;
  const region = process.env.LEADBAY_REGION ?? "us";
  if (!token) throw new Error("live-mcp-server: LEADBAY_TOKEN required");
  const baseUrl = REGIONS[region] ?? REGIONS.us;
  const client = new LeadbayClient(baseUrl, token);
  const server = buildServer(client, { includeWrite: true, includeAdvanced: false });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until the parent process closes stdin.
}

main().catch((err) => {
  process.stderr.write(`live-mcp-server fatal: ${err}\n`);
  process.exit(1);
});
