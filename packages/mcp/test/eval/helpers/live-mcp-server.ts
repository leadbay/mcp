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

/**
 * Endpoints that COST the account real credits. Only the launch does — the
 * job_titles / preview calls behind `mode:"discover"` are free, and the guard
 * must leave them working or the free half of a consent scenario can't run.
 */
const PAID_ENDPOINTS = [/\/leads\/selection\/enrichment\/launch/];

/**
 * Hard interlock for consent / no-spend scenarios (`EVAL_NO_SPEND=1`).
 *
 * These evals exist to prove the agent does NOT spend without an explicit
 * confirm — so the failure they are written to catch is precisely the one that
 * bills the account. They used to lean on a missing backend fixture to make a
 * paid launch fail, but this runner hits the REAL Leadbay API and ignores
 * fixtures entirely: the guard would have been paid for in credits.
 *
 * So the launch is blocked here, before the network, and surfaces as an error
 * envelope — which the session runner records as a FAILED call, so the run
 * fails loudly on the regression instead of quietly buying contacts.
 */
function withSpendGuard(client: LeadbayClient): LeadbayClient {
  if (process.env.EVAL_NO_SPEND !== "1") return client;
  const blocked = (path: string) => PAID_ENDPOINTS.some((re) => re.test(path));
  const refuse = (method: string, path: string): never => {
    process.stderr.write(
      `live-mcp-server: BLOCKED paid call ${method} ${path} (EVAL_NO_SPEND=1)\n`,
    );
    throw Object.assign(
      new Error(
        `EVAL_NO_SPEND: refused paid call ${method} ${path}. This scenario asserts ` +
          `the agent never spends without an explicit confirm — reaching this ` +
          `endpoint IS the regression.`,
      ),
      { code: "EVAL_SPEND_BLOCKED", error: true },
    );
  };

  for (const m of ["request", "requestVoid", "requestRawBinary"] as const) {
    const original = client[m].bind(client) as (...a: unknown[]) => unknown;
    (client as unknown as Record<string, unknown>)[m] = (...args: unknown[]) => {
      const [method, path] = args as [string, string];
      if (typeof path === "string" && blocked(path)) refuse(method, path);
      return original(...args);
    };
  }
  return client;
}

async function main(): Promise<void> {
  const token = process.env.LEADBAY_TOKEN;
  const region = process.env.LEADBAY_REGION ?? "us";
  if (!token) throw new Error("live-mcp-server: LEADBAY_TOKEN required");
  const baseUrl = REGIONS[region] ?? REGIONS.us;
  const client = withSpendGuard(new LeadbayClient(baseUrl, token));
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
