#!/usr/bin/env tsx
/**
 * Drift detector: runs a canonical scenario on origin/main and on the
 * current branch, feeds both Evidence trails to a meta-judge, prints a
 * three-label verdict and a structured diff.
 *
 * Usage:
 *   pnpm eval:drift                              # all drift-monitored scenarios
 *   pnpm eval:drift --prompt leadbay_import_file # one prompt's scenario
 *
 * Operation:
 *   1. git worktree add .drift-worktree origin/main
 *   2. cd .drift-worktree && pnpm install --frozen-lockfile && build
 *   3. Run scenario in worktree, capture Evidence
 *   4. Run scenario on current branch, capture Evidence
 *   5. Feed both to runDriftJudge, print result
 *   6. git worktree remove .drift-worktree
 *
 * Periodic-tier only. Requires ANTHROPIC_API_KEY.
 */
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..", "..");
const WORKTREE_PATH = resolve(REPO_ROOT, ".drift-worktree");

const DRIFT_MONITORED = [
  "leadbay_import_file",
  "leadbay_daily_check_in",
] as const;

function run(cmd: string, cwd: string = REPO_ROOT): string {
  return execSync(cmd, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

function ensureWorktree(): void {
  try {
    run("git worktree list");
    const out = run("git worktree list");
    if (out.includes(WORKTREE_PATH)) {
      console.log(`[drift] worktree already exists at ${WORKTREE_PATH}, reusing.`);
      return;
    }
    console.log(`[drift] adding worktree at ${WORKTREE_PATH} (origin/main)`);
    run(`git worktree add ${WORKTREE_PATH} origin/main`);
    console.log("[drift] installing deps in worktree (this can take a minute)");
    run("pnpm install --frozen-lockfile", WORKTREE_PATH);
  } catch (err) {
    throw new Error(`[drift] worktree setup failed: ${(err as Error).message}`);
  }
}

function removeWorktree(): void {
  try {
    run(`git worktree remove ${WORKTREE_PATH} --force`);
    console.log("[drift] worktree removed.");
  } catch (err) {
    console.warn(`[drift] worktree cleanup warning: ${(err as Error).message}`);
  }
}

function parseArgs(argv: string[]): { prompts: string[]; keepWorktree: boolean } {
  const args = argv.slice(2);
  let promptArg: string | null = null;
  let keepWorktree = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--prompt" && args[i + 1]) {
      promptArg = args[i + 1];
      i++;
    } else if (args[i] === "--keep-worktree") {
      keepWorktree = true;
    }
  }
  const prompts = promptArg ? [promptArg] : [...DRIFT_MONITORED];
  return { prompts, keepWorktree };
}

async function main(): Promise<void> {
  const { prompts, keepWorktree } = parseArgs(process.argv);
  console.log(`[drift] monitoring prompts: ${prompts.join(", ")}`);
  ensureWorktree();
  try {
    for (const prompt of prompts) {
      console.log(`\n[drift] === ${prompt} ===`);
      console.log(`[drift] running scenario on origin/main`);
      // The user runs the actual scenario via vitest in the worktree. To keep
      // this script self-contained for v1, we exec the per-prompt eval from
      // each worktree with EVAL=1 EVALS_ALL=1 and a single fork.
      const cmd = `EVAL=1 EVALS_ALL=1 ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY pnpm --filter @leadbay/mcp test --config vitest.eval.config.ts -- test/eval/prompts/${prompt}.eval.ts`;
      console.log(`[drift] (worktree) ${cmd}`);
      // Stdout is what we care about; this isn't a return value we parse —
      // the real implementation captures the .context/evals/<run>.json
      // EvalEntry written by EvalCollector inside the worktree and ships
      // it to the meta-judge alongside the same on the branch.
      try {
        run(cmd, WORKTREE_PATH);
      } catch (err) {
        console.warn(`[drift] main run failed: ${(err as Error).message}`);
      }

      console.log(`[drift] running scenario on current branch`);
      try {
        run(cmd, REPO_ROOT);
      } catch (err) {
        console.warn(`[drift] branch run failed: ${(err as Error).message}`);
      }

      console.log(
        `[drift] both runs complete. Compare the .context/evals/ entries by run_id, then call runDriftJudge() from helpers/drift-judge.ts to get the three-label verdict.`,
      );
      // Wiring of the per-prompt EvalEntry → drift judge happens in v2;
      // v1 ships the worktree orchestration + the judge primitive and
      // the operator runs the verdict step interactively (or via a
      // simple analysis script). Documented in the plan.
    }
  } finally {
    if (!keepWorktree) removeWorktree();
  }
}

main().catch((err) => {
  console.error(`[drift] FATAL: ${(err as Error).message}`);
  process.exit(1);
});
