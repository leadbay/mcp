/**
 * Diff-based eval selection. A test runs only if any file in its
 * `touch` list is modified vs the merge-base. GLOBAL_TOUCHFILES force
 * every test to run when touched (e.g. session-runner, evidence shape).
 *
 * Tier is per-scenario, declared inline next to the scenario fixture
 * (per eng-review T3 decision). This module collects what the suite
 * needs to run; it doesn't decide the tier itself.
 */
import { execSync } from "node:child_process";

export const EVAL_TOUCHFILES: Record<string, string[]> = {
  "leadbay_import_file": [
    "packages/mcp/src/prompts.ts",
    "packages/mcp/src/prompts.generated.ts",
    "packages/promptforge/prompts/leadbay_import_file.md.tmpl",
    "packages/promptforge/snippets/iron-laws/no-fabrication.md",
    "packages/promptforge/snippets/gates/column-preservation-plan.md",
    "packages/promptforge/snippets/gates/decision-log.md",
    "packages/promptforge/snippets/gates/phase-complete.md",
    "packages/promptforge/snippets/heuristics/consumer-email-domains.md",
    "packages/promptforge/snippets/heuristics/address-matching.md",
    "packages/promptforge/snippets/heuristics/crm-record-link.md",
    "packages/core/src/composite/resolve-import-rows.ts",
    "packages/core/src/composite/import-leads.ts",
    "packages/core/src/composite/import-and-qualify.ts",
    "packages/core/src/composite/import-status.ts",
    "packages/core/src/tools/list-mappable-fields.ts",
    "packages/core/src/tools/create-custom-field.ts",
    "packages/core/src/tools/add-note.ts",
    "packages/mcp/test/eval/prompts/leadbay_import_file.eval.ts",
    "packages/mcp/test/eval/scenarios/import-file/",
    "packages/mcp/test/eval/invariants/import-file.ts",
  ],
  "leadbay_daily_check_in": [
    "packages/mcp/src/prompts.ts",
    "packages/mcp/src/prompts.generated.ts",
    "packages/promptforge/prompts/leadbay_daily_check_in.md.tmpl",
    "packages/promptforge/snippets/gates/stop-and-wait.md",
    "packages/core/src/composite/account-status.ts",
    "packages/core/src/composite/pull-leads.ts",
    "packages/core/src/composite/research-lead.ts",
    "packages/mcp/test/eval/prompts/leadbay_daily_check_in.eval.ts",
    "packages/mcp/test/eval/scenarios/daily-check-in/",
    "packages/mcp/test/eval/invariants/daily-check-in.ts",
  ],
  "leadbay_followup_check_in": [
    "packages/mcp/src/prompts.ts",
    "packages/mcp/src/prompts.generated.ts",
    "packages/promptforge/prompts/leadbay_followup_check_in.md.tmpl",
    "packages/promptforge/snippets/gates/stop-and-wait.md",
    "packages/promptforge/snippets/gates/defer-to-tool-rendering.md",
    "packages/promptforge/snippets/rendering/pull-followups-table.md",
    "packages/core/src/composite/pull-followups.ts",
    "packages/core/src/composite/research-lead.ts",
    "packages/core/src/composite/prepare-outreach.ts",
    "packages/mcp/test/eval/prompts/leadbay_followup_check_in.eval.ts",
    "packages/mcp/test/eval/scenarios/followup-check-in/",
    "packages/mcp/test/eval/invariants/followup-check-in.ts",
  ],
  "leadbay_research_a_domain": [
    "packages/mcp/src/prompts.ts",
    "packages/mcp/src/prompts.generated.ts",
    "packages/promptforge/prompts/leadbay_research_a_domain.md.tmpl",
    "packages/core/src/composite/import-and-qualify.ts",
    "packages/core/src/composite/research-lead.ts",
    "packages/mcp/test/eval/prompts/leadbay_research_a_domain.eval.ts",
  ],
  "leadbay_refine_audience": [
    "packages/mcp/src/prompts.ts",
    "packages/mcp/src/prompts.generated.ts",
    "packages/promptforge/prompts/leadbay_refine_audience.md.tmpl",
    "packages/core/src/composite/refine-prompt.ts",
    "packages/core/src/composite/answer-clarification.ts",
    "packages/mcp/test/eval/prompts/leadbay_refine_audience.eval.ts",
  ],
  "leadbay_log_outreach": [
    "packages/mcp/src/prompts.ts",
    "packages/mcp/src/prompts.generated.ts",
    "packages/promptforge/prompts/leadbay_log_outreach.md.tmpl",
    "packages/promptforge/snippets/iron-laws/verification-required.md",
    "packages/core/src/composite/report-outreach.ts",
    "packages/mcp/test/eval/prompts/leadbay_log_outreach.eval.ts",
  ],
  "leadbay_qualify_top_n": [
    "packages/mcp/src/prompts.ts",
    "packages/mcp/src/prompts.generated.ts",
    "packages/promptforge/prompts/leadbay_qualify_top_n.md.tmpl",
    "packages/core/src/composite/bulk-qualify-leads.ts",
    "packages/mcp/test/eval/prompts/leadbay_qualify_top_n.eval.ts",
  ],
  "leadbay_work_campaign": [
    "packages/mcp/src/prompts.ts",
    "packages/mcp/src/prompts.generated.ts",
    "packages/promptforge/prompts/leadbay_work_campaign.md.tmpl",
    "packages/promptforge/tool-descriptions/composite/campaign-call-sheet.md.tmpl",
    "packages/core/src/composite/campaign-call-sheet.ts",
    "packages/core/src/composite/list-campaigns.ts",
    "packages/core/src/composite/report-outreach.ts",
    "packages/core/src/composite/enrich-titles.ts",
    "packages/mcp/test/eval/prompts/leadbay_work_campaign.eval.ts",
    "packages/mcp/test/eval/scenarios/work-campaign/",
    "packages/mcp/test/eval/invariants/work-campaign.ts",
  ],
  "tool-routing": [
    "packages/core/src/tools/",
    "packages/core/src/composite/",
    "packages/core/src/tool-descriptions.generated.ts",
    "packages/promptforge/tool-descriptions/",
    "packages/mcp/src/server.ts",
    "packages/mcp/test/eval/tool-descriptions/",
  ],
};

export const GLOBAL_TOUCHFILES = [
  "packages/mcp/test/eval/helpers/session-runner.ts",
  "packages/mcp/test/eval/helpers/evidence.ts",
  "packages/mcp/test/eval/helpers/eval-collector.ts",
  "packages/mcp/test/eval/helpers/touchfiles.ts",
  "packages/mcp/test/eval/helpers/mission-match-judge.ts",
  "packages/mcp/test/eval/helpers/llm-judge-shared.ts",
  "packages/mcp/test/eval/helpers/backend-recorder.ts",
  "packages/promptforge/src/",
  "packages/mcp/src/server.ts",
];

function changedFiles(baseRef: string): Set<string> {
  try {
    const out = execSync(`git diff --name-only ${baseRef}...HEAD`, {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    return new Set(out.split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * Compute the set of touchfile keys that should run, given a base ref
 * (default origin/main). If GLOBAL touchfiles are touched, all keys
 * run. If EVALS_ALL=1 is set, all keys run regardless of diff.
 */
export function selectTouchedKeys(
  baseRef: string = process.env.EVAL_BASE_REF ?? "origin/main",
): Set<string> {
  if (process.env.EVALS_ALL === "1") {
    return new Set(Object.keys(EVAL_TOUCHFILES));
  }
  const changed = changedFiles(baseRef);
  // GLOBAL hit → run all
  for (const g of GLOBAL_TOUCHFILES) {
    for (const c of changed) {
      if (c === g || c.startsWith(g)) {
        return new Set(Object.keys(EVAL_TOUCHFILES));
      }
    }
  }
  const touched = new Set<string>();
  for (const [key, paths] of Object.entries(EVAL_TOUCHFILES)) {
    for (const p of paths) {
      for (const c of changed) {
        if (c === p || c.startsWith(p)) {
          touched.add(key);
          break;
        }
      }
    }
  }
  return touched;
}

/**
 * Skip-or-run helper for individual eval tests:
 *
 *   describeIfSelected("plan-compose cold first-touch", "leadbay_plan_compose", () => { ... })
 */
export function describeIfSelected(
  testKey: string,
  selected: Set<string> = selectTouchedKeys(),
): "run" | "skip" {
  if (process.env.EVAL !== "1") return "skip";
  return selected.has(testKey) ? "run" : "skip";
}
