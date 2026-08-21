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
import {
  LeadbayClient,
  LocalBulkStore,
  NotificationsInbox,
  agentMemoryTools,
  compositeReadTools,
  compositeWriteTools,
  granularReadTools,
  granularWriteTools,
} from "@leadbay/core";
import { buildServer } from "../../../src/server.js";

const REGIONS: Record<string, string> = {
  us: "https://api-us.leadbay.app",
  fr: "https://api-fr.leadbay.app",
};

async function main(): Promise<void> {
  const token = process.env.LEADBAY_TOKEN;
  if (!token) throw new Error("live-mcp-server: LEADBAY_TOKEN required");

  // LEADBAY_BASE_URL lets a run target staging. When LEADBAY_REGION is given,
  // it is passed through, and that pin is load-bearing rather than cosmetic:
  // without it the client derives "custom" from an unrecognised staging host,
  // and the single-country guard classifies every country as
  // `country_indeterminate` instead of home vs foreign (product#3951) — so the
  // run would silently exercise a different branch than the one under test.
  //
  // What it must NOT do is invent one. A base URL with no region used to
  // default to "us" and pass that explicitly, so the guard asserted "this
  // workspace holds United States companies only" about a tenant nobody had
  // identified, and the eval reported `_meta.region: "us"` for it. That is the
  // same confidently-wrong-answer failure the scenarios exist to catch, coming
  // from the harness itself. Undefined lets the client derive: a known regional
  // URL still resolves to us/fr, anything else becomes "custom", which is the
  // honest answer when nobody pinned one (mirrors client.ts:103-106).
  const pinnedRegion = process.env.LEADBAY_REGION as "us" | "fr" | undefined;
  const baseUrl =
    process.env.LEADBAY_BASE_URL || (pinnedRegion && REGIONS[pinnedRegion]) || REGIONS.us;
  const client = new LeadbayClient(baseUrl, token, pinnedRegion);
  const region = client.region;

  // NO-SPEND KILL SWITCH. Set by the runner for scenarios declaring
  // `no_paid_calls`. The previous guard inspected tool inputs AFTER the session
  // finished — by which point a regression had already called
  // enrich_titles({titles, confirm:true, email:true}) against the real API and
  // charged the account. An overdeliver eval must not be able to spend the
  // quota it exists to prove is safe, so the block lives at the HTTP boundary:
  // it holds no matter which tool, argument shape, or future code path reaches
  // for it.
  if (process.env.LEADBAY_EVAL_NO_PAID_CALLS === "1") {
    // Every route that actually reveals a contact, not just the bulk one. The
    // first version matched only /leads/selection/enrichment/launch, which left
    // a real hole: leadbay_prepare_outreach({enrich:true}) delegates to
    // leadbay_enrich_contacts, whose paid requests go to the per-lead contact
    // paths below and would have sailed straight past the guard to the real API.
    //
    // Deliberately matched on the ENRICH segment rather than an exact path, so
    // a future endpoint rename doesn't silently reopen the hole. Read-only
    // discovery paths (job_titles, preview, status) are explicitly not here —
    // the tour depends on them and they cost nothing.
    const PAID_PATHS = [
      /\/enrichment\/launch/,                    // bulk reveal (enrich_titles)
      /\/contacts\/[^\/]+\/enrich(\?|$)/,          // per-contact reveal, both
      /\/enrich\/contacts\/[^\/]+\/enrich(\?|$)/,  // the paid + fallback routes
    ];
    const deny = (method: string, path: string): void => {
      if (PAID_PATHS.some((re) => re.test(path))) {
        throw new Error(
          `EVAL_NO_PAID_CALLS: refused ${method} ${path} — this scenario must never spend. ` +
            `The call was blocked before reaching the API, so the eval fails on the assertion, not on your quota.`,
        );
      }
    };
    for (const m of ["request", "requestVoid", "requestRawBinary"] as const) {
      const orig = (client as unknown as Record<string, Function>)[m].bind(client);
      (client as unknown as Record<string, Function>)[m] = (
        method: string,
        path: string,
        ...rest: unknown[]
      ) => {
        deny(method, path);
        return orig(method, path, ...rest);
      };
    }
  }
  // FORBIDDEN-CALL KILL SWITCH. Set by the runner from the scenario's
  // `mission.forbidden_calls`. Same lesson as the no-spend switch above, which
  // was itself moved here after a post-hoc check let a real charge through:
  // scenarios.eval.ts iterates the recorded calls only AFTER runSessionLive
  // returns, so a regression that called leadbay_new_lens or
  // leadbay_update_lens_filter had already written to the real tenant by the
  // time the assertion failed. A scenario asserting "this must mutate nothing"
  // cannot be the thing that mutates it.
  //
  // The tool stays LISTED and keeps its description — removing it would make
  // the assertion vacuous, since an agent cannot call a tool it cannot see.
  // What changes is that invoking it throws before any HTTP happens, so the
  // call is still recorded in the transcript and the scenario still fails on
  // the assertion it was written for.
  const forbidden = new Set(
    (process.env.LEADBAY_EVAL_FORBIDDEN_TOOLS ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );
  if (forbidden.size > 0) {
    // Armed against the catalog this server actually EXPOSES, which is what
    // buildServer is called with below: write tools yes, advanced/granular no.
    // Arming against the full catalog looked stricter and was the opposite —
    // a granular name like leadbay_update_lens_filter is never listed to the
    // agent, so marking it "armed" satisfied the unmatched check while the
    // forbidden_calls assertion for it stayed vacuous. The agent could not have
    // called it either way, so the scenario claimed a protection it never
    // exercised.
    const exposedCatalog = [...agentMemoryTools, ...compositeReadTools, ...compositeWriteTools];
    const unexposedCatalog = [...granularReadTools, ...granularWriteTools];
    const armed = new Set<string>();
    for (const tool of exposedCatalog) {
      if (!forbidden.has(tool.name)) continue;
      armed.add(tool.name);
      tool.execute = async () => {
        throw new Error(
          `EVAL_FORBIDDEN_CALL: ${tool.name} is on this scenario's forbidden_calls list. ` +
            `The call was blocked before reaching the API, so the tenant is unchanged and the ` +
            `eval fails on the assertion rather than on a real mutation.`,
        );
      };
    }

    const unmatched = [...forbidden].filter((name) => !armed.has(name));
    if (unmatched.length > 0) {
      const unexposed = new Set(unexposedCatalog.map((tool) => tool.name));
      // Two different author errors, and the fix differs, so they are named
      // separately rather than lumped into "unknown tool".
      const notExposed = unmatched.filter((name) => unexposed.has(name));
      const unknown = unmatched.filter((name) => !unexposed.has(name));
      const problems = [
        unknown.length > 0
          ? `unknown tools: ${unknown.join(", ")} (a name that matches nothing protects nothing)`
          : undefined,
        notExposed.length > 0
          ? `tools this server does not expose: ${notExposed.join(", ")} — buildServer runs with includeAdvanced:false, so the agent is never offered them and forbidding them asserts nothing. Drop them from forbidden_calls, or expose the advanced surface for this scenario if the path is meant to be covered`
          : undefined,
      ].filter(Boolean);
      throw new Error(`live-mcp-server: forbidden_calls names ${problems.join("; ")}.`);
    }
  }

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
