/**
 * Audit: the optional WORKFLOWS.md contract fields are well-formed.
 *
 * Complements workflows.test.ts (which checks backtick'd identifiers and
 * table shape). This one validates the machine-read contract blocks that
 * `/eval` parses — specifically the optional fields added for output
 * formatting and multi-turn coverage (product#3685):
 *
 *   - `scenario.prompt` and `turns:` are mutually exclusive — a contract
 *     declares one or the other, never both, never neither.
 *   - every tool named in a `turns[].expect_calls` / `forbid_calls` list
 *     resolves to a registered tool (catches renames/typos in per-turn
 *     invariants, mirroring the backtick check for required_calls).
 *   - each `render_checks` entry is either a plain string criterion or a
 *     `{must_match}` / `{must_not_match}` regex object (and the regex
 *     actually compiles).
 *
 * The parser here is deliberately small and tolerant: the blocks are flat
 * YAML-ish (keys, `- list` items, and one nesting level under `turns:`).
 * It mirrors the hand-parse the eval skill does so the test and the skill
 * agree on the contract shape.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  compositeReadTools,
  compositeWriteTools,
  granularReadTools,
  granularWriteTools,
} from "@leadbay/core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const WORKFLOWS_MD = resolve(REPO_ROOT, "WORKFLOWS.md");
const SOURCE = readFileSync(WORKFLOWS_MD, "utf8");

const KNOWN_TOOLS = new Set(
  [
    ...compositeReadTools,
    ...compositeWriteTools,
    ...granularReadTools,
    ...granularWriteTools,
  ].map((t) => t.name),
);

interface ParsedTurn {
  prompt?: string;
  expect_calls: string[];
  forbid_calls: string[];
  carry_over: string[];
}

interface ParsedContract {
  workflow_name: string;
  hasScenarioPrompt: boolean;
  turns: ParsedTurn[];
  render_checks: Array<string | { must_match?: string; must_not_match?: string }>;
}

/** Pull every fenced ```yaml expected / ```yaml scenario block, in order. */
function extractBlocks(src: string): Array<{ kind: "expected" | "scenario"; body: string }> {
  const out: Array<{ kind: "expected" | "scenario"; body: string }> = [];
  const re = /```yaml (expected|scenario)\n([\s\S]*?)```/g;
  for (const m of src.matchAll(re)) {
    out.push({ kind: m[1] as "expected" | "scenario", body: m[2] });
  }
  return out;
}

/** Indentation depth in spaces. */
const indent = (line: string) => line.length - line.trimStart().length;

/**
 * Parse one `yaml expected` body into the fields the audit cares about.
 * Tolerant line parser: top-level `key:` / `key: value`, `- item` lists, and
 * one nesting level under `turns:` (each `- prompt:` starts a turn, with
 * `expect_calls:` / `forbid_calls:` / `carry_over:` sublists).
 */
function parseExpected(body: string): ParsedContract {
  const lines = body.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
  const contract: ParsedContract = {
    workflow_name: "",
    hasScenarioPrompt: false,
    turns: [],
    render_checks: [],
  };

  let section: "render_checks" | "turns" | null = null;
  let turnSub: "expect_calls" | "forbid_calls" | "carry_over" | null = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const trimmed = line.trim();
    const depth = indent(line);

    if (depth === 0) {
      section = null;
      turnSub = null;
      const nameM = trimmed.match(/^workflow_name:\s*(.+)$/);
      if (nameM) contract.workflow_name = nameM[1].trim();
      if (trimmed === "render_checks:") section = "render_checks";
      else if (trimmed === "turns:") section = "turns";
      continue;
    }

    if (section === "render_checks") {
      // `- "criterion"` | `- must_match: "..."` | `- must_not_match: "..."`
      const item = trimmed.replace(/^-\s*/, "");
      const mm = item.match(/^must_match:\s*(.+)$/);
      const mn = item.match(/^must_not_match:\s*(.+)$/);
      if (mm) contract.render_checks.push({ must_match: stripQuotes(mm[1]) });
      else if (mn) contract.render_checks.push({ must_not_match: stripQuotes(mn[1]) });
      else contract.render_checks.push(stripQuotes(item));
      continue;
    }

    if (section === "turns") {
      // A new turn starts at `- prompt:`.
      const promptM = trimmed.match(/^-\s*prompt:\s*(.+)$/);
      if (promptM) {
        contract.turns.push({ prompt: stripQuotes(promptM[1]), expect_calls: [], forbid_calls: [], carry_over: [] });
        turnSub = null;
        continue;
      }
      const cur = contract.turns[contract.turns.length - 1];
      if (!cur) continue;
      if (trimmed === "expect_calls:") { turnSub = "expect_calls"; continue; }
      if (trimmed === "forbid_calls:") { turnSub = "forbid_calls"; continue; }
      if (trimmed === "carry_over:") { turnSub = "carry_over"; continue; }
      if (trimmed.startsWith("- ") && turnSub) {
        cur[turnSub].push(stripQuotes(trimmed.replace(/^-\s*/, "")));
      }
      continue;
    }
  }
  return contract;
}

function parseScenarioPrompt(body: string): boolean {
  return /^\s*prompt:\s*\S/m.test(body);
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * Pair each `expected` block with the `scenario` block that immediately
 * follows it (if any). A block with `turns:` has no following scenario.
 */
function pairContracts(): Array<{ contract: ParsedContract; hasScenario: boolean }> {
  const blocks = extractBlocks(SOURCE);
  const pairs: Array<{ contract: ParsedContract; hasScenario: boolean }> = [];
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].kind !== "expected") continue;
    const contract = parseExpected(blocks[i].body);
    const next = blocks[i + 1];
    const hasScenario = !!(next && next.kind === "scenario" && parseScenarioPrompt(next.body));
    pairs.push({ contract, hasScenario });
  }
  return pairs;
}

describe("audit: WORKFLOWS.md optional contract fields are well-formed", () => {
  const pairs = pairContracts();

  it("parses at least the 24 baseline contracts", () => {
    expect(pairs.length).toBeGreaterThanOrEqual(24);
  });

  it("each contract has either a scenario prompt OR turns: — never both, never neither", () => {
    const offenders: string[] = [];
    for (const { contract, hasScenario } of pairs) {
      const hasTurns = contract.turns.length > 0;
      if (hasScenario && hasTurns) {
        offenders.push(`${contract.workflow_name}: declares BOTH a scenario prompt and turns:`);
      }
      if (!hasScenario && !hasTurns) {
        offenders.push(`${contract.workflow_name}: declares NEITHER a scenario prompt nor turns:`);
      }
    }
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });

  it("every per-turn expect_calls / forbid_calls names a registered tool", () => {
    const offenders: string[] = [];
    for (const { contract } of pairs) {
      contract.turns.forEach((turn, idx) => {
        for (const name of [...turn.expect_calls, ...turn.forbid_calls]) {
          if (!KNOWN_TOOLS.has(name)) {
            offenders.push(`${contract.workflow_name} turn ${idx + 1}: unknown tool "${name}"`);
          }
        }
      });
    }
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });

  it("each turn has a non-empty prompt", () => {
    const offenders: string[] = [];
    for (const { contract } of pairs) {
      contract.turns.forEach((turn, idx) => {
        if (!turn.prompt || !turn.prompt.trim()) {
          offenders.push(`${contract.workflow_name} turn ${idx + 1}: empty prompt`);
        }
      });
    }
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });

  it("every render_checks entry is a string criterion or a compilable must_match/must_not_match regex", () => {
    const offenders: string[] = [];
    for (const { contract } of pairs) {
      for (const entry of contract.render_checks) {
        if (typeof entry === "string") {
          if (!entry.trim()) offenders.push(`${contract.workflow_name}: empty render_checks string`);
          continue;
        }
        const pattern = entry.must_match ?? entry.must_not_match;
        if (!pattern) {
          offenders.push(`${contract.workflow_name}: render_checks object with neither must_match nor must_not_match`);
          continue;
        }
        try {
          // eslint-disable-next-line no-new
          new RegExp(pattern);
        } catch {
          offenders.push(`${contract.workflow_name}: render_checks regex does not compile: /${pattern}/`);
        }
      }
    }
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });
});
