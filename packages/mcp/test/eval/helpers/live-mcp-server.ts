/**
 * live-mcp-server.ts — real @leadbay/mcp server with real Leadbay API.
 *
 * Spawned by live-session-runner.ts with LEADBAY_TOKEN + LEADBAY_REGION env vars.
 * Makes real HTTP calls to the Leadbay API — no mocking.
 *
 * stdout/stdin carry the MCP stdio protocol — the claude CLI connects to
 * this process as an MCP server.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LeadbayClient, LocalBulkStore, NotificationsInbox } from "@leadbay/core";
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
  //
  // Store selection is a PER-EVAL-SESSION file, not process memory and not the
  // shared default (~/.leadbay/bulks.json):
  //   - In-memory would be lost between turns — the live runner spawns a fresh
  //     server process per user turn, so a multi-turn flow (WF34: turn 2 launches
  //     enrich_titles, turn 3 polls bulk_enrich_status) would see BULK_NOT_FOUND.
  //   - The shared default would let the 5-min idempotency window reuse a prior
  //     record across separate eval sessions, skipping the backend launch.
  // A path unique per eval session (set by the harness via LEADBAY_BULK_STORE_PATH)
  // survives across that session's turns while staying isolated from other runs.
  // Fallback: a per-process file so a single-turn run still works when the harness
  // didn't set the env var.
  const bulkStorePath =
    process.env.LEADBAY_BULK_STORE_PATH ||
    join(homedir(), ".leadbay", `bulks.eval.${process.pid}.json`);
  const bulkTracker = new LocalBulkStore({ backend: "file", path: bulkStorePath });
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
