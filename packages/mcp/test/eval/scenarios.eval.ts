/**
 * scenarios.eval.ts — the eval runner.
 *
 * Restores the entry point that #71 removed. That commit landed the live
 * framework's parts (live-session-runner, live-mcp-server, mission-match-judge,
 * eval-collector) and deleted the old fixture-based entry points, but never
 * shipped a replacement: `vitest.eval.config.ts` and `test/eval/scripts/` went
 * with it. The four `package.json` eval scripts have pointed at missing files
 * ever since, so `pnpm test:gate` failed at startup and no eval has run on any
 * PR since. The helpers were orphans — nothing imported them but each other.
 *
 * ONE runner over every `*.scenario.ts`, rather than one `.eval.ts` per prompt
 * as before. 13 scenarios would mean 13 near-identical files, and the previous
 * shape is exactly what rotted: the boilerplate drifted from the helpers and
 * was deleted wholesale. A single loop has one place to keep correct.
 *
 * Each scenario runs the real chain — `claude` CLI → real @leadbay/mcp server →
 * real Leadbay API → LLM judge. Nothing is mocked. `backendFixtures` on the
 * scenario objects is vestigial from the fixture era (2115b11, "live API runner
 * is the only path") and is deliberately ignored.
 *
 * Run:
 *   pnpm test:gate                      # EVAL_TIER=gate (all 13 today)
 *   pnpm test:eval                      # every tier
 *   EVAL=1 EVAL_ONLY=getting-started pnpm test:eval    # one folder
 *
 * Requires: `claude` on PATH and logged in, plus LEADBAY_TOKEN (+ optional
 * LEADBAY_REGION). Without EVAL=1 the whole file skips, so it can never fire
 * during `pnpm -r test`.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readdirSync, mkdtempSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";

import { runSessionLive } from "./helpers/live-session-runner.js";
import {
  runMissionMatchJudge,
  type MissionMatchScenario,
} from "./helpers/mission-match-judge.js";
import { hasCLI } from "./helpers/llm-judge-shared.js";
import {
  MISSION_MATCH_FLOOR,
  INSTRUCTION_ADHERENCE_FLOOR,
  NO_FABRICATION_FLOOR,
  TOOL_SELECTION_FIT_FLOOR,
} from "./helpers/budget-thresholds.js";
import { getPrompt } from "../../src/prompts.js";
import { buildServerInstructions } from "../../src/server.js";
import { compositeReadTools, compositeWriteTools, agentMemoryTools } from "@leadbay/core";

const SCENARIOS_DIR = resolve(__dirname, "scenarios");
const PROMPTFORGE_ROOT = resolve(__dirname, "../../../promptforge");

/** The shape a `*.scenario.ts` exports. Wider than MissionMatchScenario. */
interface ScenarioFile {
  name: string;
  /** MCP prompt name — the tour/workflow under test. */
  prompt: string;
  tier?: string;
  args?: Record<string, string | undefined>;
  /** Vestigial: the live runner hits the real API. Ignored. */
  backendFixtures?: unknown[];
  mission: {
    user_intent: string;
    success_criteria: string[];
    required_calls?: string[];
    /** Not part of MissionMatchScenario — asserted mechanically below. */
    required_order?: string[];
    /** Not part of MissionMatchScenario — asserted mechanically below. */
    allowed_calls?: string[];
    required_byproducts?: string[];
    forbidden_calls?: string[];
    render_checks?: Array<string | { must_match?: string; must_not_match?: string }>;
    turns?: Array<{
      prompt: string;
      expect_calls?: string[];
      forbid_calls?: string[];
      carry_over?: string[];
    }>;
  };
}

/** Walk scenarios/<workflow>/<name>.scenario.ts. */
function discover(): Array<{ file: string; folder: string }> {
  if (!existsSync(SCENARIOS_DIR)) return [];
  const out: Array<{ file: string; folder: string }> = [];
  for (const folder of readdirSync(SCENARIOS_DIR, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    for (const f of readdirSync(join(SCENARIOS_DIR, folder.name))) {
      if (f.endsWith(".scenario.ts")) {
        out.push({ file: join(SCENARIOS_DIR, folder.name, f), folder: folder.name });
      }
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * The system prompt a real user's client would hold: the MCP prompt body plus
 * the server instructions. `--system-prompt` bypasses the MCP protocol's
 * `instructions` field, so it has to be merged in by hand — same order and
 * same exposed tool set as helpers/get-system-prompt.mts, which exists for the
 * shell path.
 */
function buildSystemPrompt(promptName: string): string {
  const exposed = new Set<string>();
  for (const t of [...agentMemoryTools, ...compositeReadTools, ...compositeWriteTools]) {
    exposed.add(t.name);
  }
  const rendered = getPrompt(promptName, {});
  const block = rendered.messages[0]?.content;
  const body = block?.type === "text" ? block.text : "";
  if (!body || body.length < 50) {
    throw new Error(`eval: prompt "${promptName}" rendered ${body.length} chars — too short`);
  }
  return `${body}\n\n${buildServerInstructions(exposed)}`;
}

const EVAL_ON = process.env.EVAL === "1";
const TIER = process.env.EVAL_TIER;
const ONLY = process.env.EVAL_ONLY;
const TOKEN = process.env.LEADBAY_TOKEN;

const discovered = discover().filter(
  (s) => !ONLY || s.folder.includes(ONLY) || basename(s.file).includes(ONLY),
);

// The gate: a live eval needs the CLI, a token, and an explicit opt-in. Any
// missing → skip loudly rather than fail, so `pnpm -r test` stays green and
// nobody is tempted to "fix" it by weakening the unit suite.
const missing: string[] = [];
if (!EVAL_ON) missing.push("EVAL=1");
if (EVAL_ON && !TOKEN) missing.push("LEADBAY_TOKEN");
if (EVAL_ON && !hasCLI()) missing.push("`claude` CLI on PATH");

describe.skipIf(missing.length > 0)("eval: live scenarios", () => {
  beforeAll(() => {
    if (discovered.length === 0) throw new Error(`eval: no scenarios under ${SCENARIOS_DIR}`);
  });

  for (const { file, folder } of discovered) {
    it(`${folder} › ${basename(file, ".scenario.ts")}`, async () => {
      const mod = (await import(file)) as { SCENARIO?: ScenarioFile };
      const s = mod.SCENARIO;
      expect(s, `${file} must export SCENARIO`).toBeDefined();
      if (TIER && s!.tier !== TIER) return; // tier filter — not this run's job

      const sc = s!;
      const transcript_dir = mkdtempSync(join(tmpdir(), `leadbay-eval-${sc.name}-`));

      // 1 — drive the real agent against the real server and API.
      const live = await runSessionLive({
        prompt: { name: sc.prompt, body: sc.mission.user_intent, args: sc.args ?? {} },
        systemPrompt: buildSystemPrompt(sc.prompt),
        turns: sc.mission.turns?.map((t) => t.prompt),
        transcript_dir,
        token: TOKEN,
        region: process.env.LEADBAY_REGION ?? "us",
      });
      const called = live.evidence.tool_calls.map((c) => c.name);

      // 2 — mechanical invariants the judge doesn't cover. These are cheap and
      // deterministic, so they run first: a wrong call sequence is a failure
      // regardless of how well the prose reads.
      for (const name of sc.mission.required_calls ?? []) {
        expect(called, `required call ${name} never fired (called: ${called.join(", ")})`).toContain(
          name,
        );
      }
      for (const name of sc.mission.forbidden_calls ?? []) {
        expect(called, `forbidden call ${name} fired`).not.toContain(name);
      }
      if (sc.mission.required_order?.length) {
        // Subsequence, not equality: extra calls between the pinned ones are
        // fine, but their relative order is the contract.
        const order = sc.mission.required_order;
        let cursor = 0;
        for (const name of called) if (name === order[cursor]) cursor++;
        expect(
          cursor,
          `required_order not satisfied: wanted ${order.join(" → ")}, saw ${called.join(" → ")}`,
        ).toBe(order.length);
      }

      // 3 — the judge scores mission match, adherence, fabrication, tool fit.
      const verdict = await runMissionMatchJudge({
        promptforgeRoot: PROMPTFORGE_ROOT,
        scenario: {
          prompt_name: sc.prompt,
          scenario_name: sc.name,
          user_intent: sc.mission.user_intent,
          success_criteria: sc.mission.success_criteria,
          required_calls: sc.mission.required_calls ?? [],
          required_byproducts: sc.mission.required_byproducts ?? [],
          forbidden_calls: sc.mission.forbidden_calls,
          render_checks: sc.mission.render_checks,
          turns: sc.mission.turns,
        } satisfies MissionMatchScenario,
        evidence: live.evidence,
      });

      // JudgeOutcome is a discriminated union: {ok:true, value} | {ok:false, error}.
      // The scores live under .value — reading them off the envelope silently
      // yields undefined and every floor comparison fails on a passing run.
      if (!verdict.ok) {
        throw new Error(
          `judge failed for ${sc.name}: ${verdict.error} — ${verdict.message}`,
        );
      }
      const { scores, per_criterion, reasoning } = verdict.value;

      // Name every criterion the judge failed. A bare "3 < 4" tells you the
      // eval regressed but not what the agent actually did wrong.
      const failed = (per_criterion ?? []).filter((c) => !c.pass);
      const detail = failed.length
        ? `\nFailed criteria:\n${failed.map((c) => `  ✗ ${c.criterion}\n    ${c.reasoning}`).join("\n")}`
        : "";
      const scoreLine =
        `MM ${scores.mission_match} / IA ${scores.instruction_adherence} / ` +
        `NF ${scores.no_fabrication} / TSF ${scores.tool_selection_fit}`;
      // Printed on pass too — the four numbers are what goes in a PR body.
      console.log(`\n[eval] ${sc.name}: ${scoreLine}\n  transcript: ${transcript_dir}`);

      expect(scores.mission_match, `mission_match — ${scoreLine}${detail}\n${reasoning}`)
        .toBeGreaterThanOrEqual(MISSION_MATCH_FLOOR);
      expect(scores.instruction_adherence, `instruction_adherence — ${scoreLine}${detail}`)
        .toBeGreaterThanOrEqual(INSTRUCTION_ADHERENCE_FLOOR);
      expect(scores.no_fabrication, `no_fabrication — ${scoreLine}${detail}`)
        .toBeGreaterThanOrEqual(NO_FABRICATION_FLOOR);
      expect(scores.tool_selection_fit, `tool_selection_fit — ${scoreLine}${detail}`)
        .toBeGreaterThanOrEqual(TOOL_SELECTION_FIT_FLOOR);
    });
  }
});

if (missing.length > 0) {
  console.log(`[eval] skipped — missing: ${missing.join(", ")}`);
}
