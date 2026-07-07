/**
 * live-mcp-server.ts — real @leadbay/mcp server with real Leadbay API.
 *
 * Spawned by live-session-runner.ts with LEADBAY_TOKEN + LEADBAY_REGION env vars.
 * Makes real HTTP calls to the Leadbay API — no mocking.
 *
 * stdout/stdin carry the MCP stdio protocol — the claude CLI connects to
 * this process as an MCP server.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LeadbayClient, createDefaultBulkStore, NotificationsInbox } from "@leadbay/core";
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
  // Wire a bulk tracker + notifications inbox so the async-enrichment path is
  // fully exercised: leadbay_enrich_titles mints a bulk_id and
  // leadbay_bulk_enrich_status can poll it (Workflow 43 / product#3866). Without
  // these, bulk_enrich_status errors "No BulkTracker configured" and the
  // stay-active poll-to-completion behavior is untestable end-to-end.
  const bulkTracker = await createDefaultBulkStore({});
  const notificationsInbox = new NotificationsInbox();
  const server = buildServer(client, {
    includeWrite: true,
    includeAdvanced: false,
    bulkTracker,
    notificationsInbox,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until the parent process closes stdin.
}

main().catch((err) => {
  process.stderr.write(`live-mcp-server fatal: ${err}\n`);
  process.exit(1);
});
