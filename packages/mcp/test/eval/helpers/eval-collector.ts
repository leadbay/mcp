/**
 * Eval collector: atomic partial saves of EvalEntry to .context/evals/
 * across the suite, schema-versioned, with auto-comparison to the prior
 * run.
 *
 * Atomic writes use the standard write-to-.tmp + rename idiom so
 * `pnpm eval:watch` can tail the run directory without seeing partial
 * JSON.
 *
 * Auto-comparison: at suite end, the collector loads the most recent
 * prior run (same branch preferred, falls back to any) and reports
 * improvements / regressions / unchanged. Budget regression is enforced
 * via the >2× rule with a sane floor.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type { EvalEntry } from "./evidence.js";
import { BUDGET_REGRESSION_FACTOR, BUDGET_REGRESSION_MIN_FLOOR } from "./budget-thresholds.js";

const SCHEMA_VERSION = 1 as const;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EVALS_ROOT = resolve(__dirname, "..", "..", "..", "..", "..", ".context", "evals");

export interface EvalRunFile {
  schema_version: typeof SCHEMA_VERSION;
  run_id: string;
  branch: string;
  git_sha: string;
  started_at: string;
  ended_at?: string;
  entries: EvalEntry[];
}

function gitBranch(): string {
  try {
    // Lazy import — only used by tests in CI / local runs.
    const cp = require("node:child_process") as typeof import("node:child_process");
    return cp.execSync("git branch --show-current", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "detached";
  } catch {
    return "unknown";
  }
}

function gitSha(): string {
  try {
    const cp = require("node:child_process") as typeof import("node:child_process");
    return cp.execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

export class EvalCollector {
  private readonly path: string;
  private readonly tmpPath: string;
  private state: EvalRunFile;

  constructor(runId?: string) {
    const id = runId ?? `${new Date().toISOString().replace(/[:.]/g, "-")}_${process.pid}`;
    mkdirSync(EVALS_ROOT, { recursive: true });
    this.path = join(EVALS_ROOT, `${id}.json`);
    this.tmpPath = this.path + ".tmp";
    this.state = {
      schema_version: SCHEMA_VERSION,
      run_id: id,
      branch: gitBranch(),
      git_sha: gitSha(),
      started_at: new Date().toISOString(),
      entries: [],
    };
    this.flush();
  }

  add(entry: EvalEntry): void {
    this.state.entries.push(entry);
    this.flush();
  }

  finalize(): EvalRunFile {
    this.state.ended_at = new Date().toISOString();
    this.flush();
    return this.state;
  }

  private flush(): void {
    writeFileSync(this.tmpPath, JSON.stringify(this.state, null, 2), "utf8");
    renameSync(this.tmpPath, this.path);
  }

  get filePath(): string {
    return this.path;
  }
}

export function loadPriorRun(branch: string): EvalRunFile | null {
  if (!existsSync(EVALS_ROOT)) return null;
  // Newest first; same-branch preferred; otherwise any.
  const files = readdirSync(EVALS_ROOT)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"))
    .map((f) => ({ f, m: statSync(join(EVALS_ROOT, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  let sameBranch: EvalRunFile | null = null;
  let any: EvalRunFile | null = null;
  for (const { f } of files) {
    try {
      const parsed: EvalRunFile = JSON.parse(readFileSync(join(EVALS_ROOT, f), "utf8"));
      if (parsed.schema_version !== SCHEMA_VERSION) continue;
      if (!any) any = parsed;
      if (parsed.branch === branch && !sameBranch) {
        sameBranch = parsed;
        break;
      }
    } catch {
      /* ignore corrupt files */
    }
  }
  return sameBranch ?? any;
}

export interface BudgetRegression {
  name: string;
  axis: "turns_used" | "tool_call_count" | "cost_usd_session" | "cost_usd_judges";
  prior: number;
  current: number;
  factor: number;
}

export function findBudgetRegressions(
  prior: EvalRunFile,
  current: EvalRunFile,
): BudgetRegression[] {
  const priorByName = new Map(prior.entries.map((e) => [e.name, e]));
  const regressions: BudgetRegression[] = [];
  for (const cur of current.entries) {
    const old = priorByName.get(cur.name);
    if (!old) continue;
    const axes: BudgetRegression["axis"][] = [
      "turns_used",
      "tool_call_count",
      "cost_usd_session",
      "cost_usd_judges",
    ];
    for (const axis of axes) {
      const oldVal = old[axis] as number;
      const newVal = cur[axis] as number;
      if (oldVal < BUDGET_REGRESSION_MIN_FLOOR && newVal < BUDGET_REGRESSION_MIN_FLOOR) continue;
      if (oldVal === 0) continue;
      const factor = newVal / oldVal;
      if (factor > BUDGET_REGRESSION_FACTOR) {
        regressions.push({ name: cur.name, axis, prior: oldVal, current: newVal, factor });
      }
    }
  }
  return regressions;
}

export interface CompareSummary {
  improved: string[];
  regressed: string[];
  unchanged: string[];
  budget_regressions: BudgetRegression[];
}

export function compareRuns(prior: EvalRunFile, current: EvalRunFile): CompareSummary {
  const priorByName = new Map(prior.entries.map((e) => [e.name, e]));
  const improved: string[] = [];
  const regressed: string[] = [];
  const unchanged: string[] = [];
  for (const cur of current.entries) {
    const old = priorByName.get(cur.name);
    if (!old) {
      improved.push(`${cur.name} (new)`);
      continue;
    }
    if (old.passed && !cur.passed) regressed.push(cur.name);
    else if (!old.passed && cur.passed) improved.push(cur.name);
    else unchanged.push(cur.name);
  }
  return {
    improved,
    regressed,
    unchanged,
    budget_regressions: findBudgetRegressions(prior, current),
  };
}
