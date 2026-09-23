/**
 * Audit for the launched-job rule (product#4178).
 *
 * A Leadbay job that outlives the call that started it comes back as a receipt:
 * ids, and none of what the user asked for. On 2026-09-16 a user asked
 * "Qualifier ces 15 leads", `leadbay_qualify_leads` returned still running after
 * its 45 s wait, and the agent ended its turn on that result. She got no
 * verdicts and did not come back. The rule that would have kept the agent
 * checking lived in `gates/notifications-inbox`, included only by
 * `leadbay_account_status`, and the qualify_leads NEXT STEPS table listed
 * "Check on it in ~1 min" as a choice to hand the user.
 *
 * Two halves:
 *   1. every tool that starts background work, and every tool that checks it,
 *      carries `gates/launched-job`, and each launcher names its check tool;
 *   2. no tool description or prompt still tells the agent to hand the wait to
 *      the user instead of checking.
 *
 * Deterministic source-side audit — it does not exercise the LLM.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as Generated from "@leadbay/core/dist/tool-descriptions.generated.js";
import { withRenderBlocks } from "./_agent-text.js";
import * as Prompts from "../../src/prompts.generated.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const RULE = readFileSync(
  resolve(REPO_ROOT, "packages/promptforge/snippets/gates/launched-job.md"),
  "utf8"
);

/** Snippets are hard-wrapped; compare on collapsed whitespace. */
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

// Description PLUS the render block, which is where `{{render}}` moved the
// NEXT STEPS menus this audit reads.
const descriptions = withRenderBlocks(Generated as unknown as Record<string, string>);
const describeTool = (name: string) => descriptions[name] as string | undefined;

/**
 * Every tool whose result can be a receipt, and the tool that checks it. Add a
 * row when a tool starts to return `still_running`, a `running` status,
 * `mode: "launched"`, `computing_*: true` or a `next_poll`.
 */
const LAUNCHERS: Record<string, string> = {
  leadbay_find_new_leads: "leadbay_lead_job_status",
  leadbay_qualify_leads: "leadbay_lead_job_status",
  leadbay_bulk_qualify_leads: "leadbay_qualify_status",
  leadbay_import_leads: "leadbay_import_status",
  leadbay_import_and_qualify: "leadbay_import_status",
  leadbay_enrich_titles: "leadbay_bulk_enrich_status",
  leadbay_enrich_contacts: "leadbay_research_lead_by_id",
  leadbay_prepare_outreach: "leadbay_prepare_outreach",
  leadbay_new_lens: "leadbay_pull_leads",
  leadbay_extend_lens: "leadbay_pull_leads",
  leadbay_refine_lead_targeting: "leadbay_account_status",
  leadbay_answer_clarification: "leadbay_account_status",
};

const CHECKERS = [
  "leadbay_lead_job_status",
  "leadbay_qualify_status",
  "leadbay_import_status",
  "leadbay_bulk_enrich_status",
  "leadbay_account_status",
] as const;

/** Phrasings that hand the wait to the user. Each one shipped before this fix. */
const HAND_OFFS: RegExp[] = [
  /check on it in ~1 min/i,
  /keep waiting \(~1 min\) or leave it/i,
  /offer to check again/i,
  /I'll refresh (when|once)/i,
  /I'll check back/i,
  /I'll pick it up/i,
  /check back in ~/i,
  /check again in N minutes/i,
  /don't force a long polling loop/i,
];

describe("launched-job rule (product#4178)", () => {
  it.each(Object.entries(LAUNCHERS))(
    "%s carries the rule and names %s as its check",
    (launcher, checker) => {
      const desc = describeTool(launcher);
      expect(desc, `${launcher} is missing from the generated descriptions`).toBeTruthy();
      expect(
        collapse(desc!),
        `${launcher} has lost the launched-job rule; re-add {{include:gates/launched-job}} to its template`
      ).toContain(collapse(RULE));
      expect(desc, `${launcher} must name the tool that checks its job`).toContain(checker);
      expect(describeTool(checker), `${checker} is not a registered tool`).toBeTruthy();
    }
  );

  it.each(CHECKERS)("%s carries the rule", (checker) => {
    const desc = describeTool(checker);
    expect(desc, `${checker} is missing from the generated descriptions`).toBeTruthy();
    expect(
      collapse(desc!),
      `${checker} has lost the launched-job rule; re-add {{include:gates/launched-job}}`
    ).toContain(collapse(RULE));
  });

  it("the rule tells the agent to say how long, check in the same turn, and answer from the finished result", () => {
    const rule = collapse(RULE);
    expect(rule).toMatch(/how long it takes, so the wait does not look broken/);
    expect(rule).toMatch(/In this same turn, check it/);
    expect(rule).toMatch(/A `stop_reason` or an early flat count is not finished/);
    expect(rule).toMatch(/Answer from the finished result/);
    expect(rule).toMatch(/Stop early only if the user said not to wait/);
  });

  it("no tool description hands the wait to the user", () => {
    const found: string[] = [];
    for (const [name, value] of Object.entries(descriptions)) {
      if (!name.startsWith("leadbay_") || typeof value !== "string") continue;
      const text = collapse(value);
      for (const p of HAND_OFFS) if (p.test(text)) found.push(`${name}: ${p}`);
    }
    expect(found).toEqual([]);
  });

  it("no prompt hands the wait to the user", () => {
    const found: string[] = [];
    for (const [name, value] of Object.entries(Prompts as Record<string, unknown>)) {
      if (typeof value !== "string") continue;
      const text = collapse(value);
      for (const p of HAND_OFFS) if (p.test(text)) found.push(`${name}: ${p}`);
    }
    expect(found).toEqual([]);
  });
});
