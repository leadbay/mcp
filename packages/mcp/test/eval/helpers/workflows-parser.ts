/**
 * workflows-parser: reads WORKFLOWS.md and extracts the ```yaml expected
 * blocks that live immediately after each Supported workflow row.
 *
 * These blocks are the single source of truth for what each eval expects:
 * required_calls, forbidden_calls, required_order, required_byproducts,
 * and success_criteria. The eval runner derives all invariants and the
 * judge mission from here — no per-workflow TypeScript files needed.
 *
 * Uses a zero-dependency line-by-line parser (the YAML subset used in
 * these blocks is flat string arrays only — no nesting, no anchors).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
const WORKFLOWS_MD = resolve(REPO_ROOT, "WORKFLOWS.md");

export interface WorkflowExpected {
  workflow_id: number;
  required_calls: string[];
  forbidden_calls: string[];
  required_order: string[];
  required_byproducts: string[];
  success_criteria: string[];
}

export interface WorkflowScenario {
  workflow_id: number;
  prompt: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let _cache: Map<number, WorkflowExpected> | null = null;
let _scenarioCache: Map<number, WorkflowScenario> | null = null;

export function getWorkflowExpected(workflow_id: number): WorkflowExpected {
  if (!_cache) _cache = parseWorkflowsFile();
  const entry = _cache.get(workflow_id);
  if (!entry) {
    throw new Error(
      `workflows-parser: no 'expected' block found for workflow #${workflow_id} in WORKFLOWS.md. ` +
        "Add a ```yaml expected block immediately after the row.",
    );
  }
  return entry;
}

export function getAllWorkflowExpected(): Map<number, WorkflowExpected> {
  if (!_cache) _cache = parseWorkflowsFile();
  return _cache;
}

export function getWorkflowScenario(workflow_id: number): WorkflowScenario {
  if (!_scenarioCache) _scenarioCache = parseScenarioBlocks();
  const entry = _scenarioCache.get(workflow_id);
  if (!entry) {
    throw new Error(
      `workflows-parser: no 'scenario' block found for workflow #${workflow_id} in WORKFLOWS.md. ` +
        "Add a ```yaml scenario block immediately after the expected block.",
    );
  }
  return entry;
}

export function getAllWorkflowScenarios(): Map<number, WorkflowScenario> {
  if (!_scenarioCache) _scenarioCache = parseScenarioBlocks();
  return _scenarioCache;
}

// ---------------------------------------------------------------------------
// Parser — handles flat YAML string arrays only
// ---------------------------------------------------------------------------

function parseWorkflowsFile(): Map<number, WorkflowExpected> {
  const source = readFileSync(WORKFLOWS_MD, "utf8");
  const map = new Map<number, WorkflowExpected>();

  const lines = source.split("\n");
  let lastRowNum: number | null = null;
  let inExpectedBlock = false;
  let blockLines: string[] = [];

  for (const line of lines) {
    // Detect a Supported table data row: starts with "| <digits> |"
    const rowMatch = line.match(/^\|\s*(\d+)\s*\|/);
    if (rowMatch && !inExpectedBlock) {
      lastRowNum = parseInt(rowMatch[1], 10);
      continue;
    }

    // Detect opening fence: ```yaml expected
    if (!inExpectedBlock && /^```yaml\s+expected\s*$/.test(line.trim())) {
      inExpectedBlock = true;
      blockLines = [];
      continue;
    }

    // Detect closing fence
    if (inExpectedBlock && line.trim() === "```") {
      inExpectedBlock = false;
      if (lastRowNum !== null) {
        map.set(lastRowNum, parseYamlBlock(lastRowNum, blockLines));
      }
      blockLines = [];
      continue;
    }

    if (inExpectedBlock) {
      blockLines.push(line);
    }
  }

  return map;
}

/**
 * Minimal flat YAML parser — handles only:
 *   key:            (starts a string-array section)
 *     - value       (list item, quoted or unquoted)
 *
 * No nesting, no anchors, no multi-line scalars. Sufficient for these blocks.
 */
function parseYamlBlock(workflow_id: number, lines: string[]): WorkflowExpected {
  const result: Record<string, string[]> = {};
  let currentKey: string | null = null;

  for (const line of lines) {
    // Skip blank lines and comment lines
    if (line.trim() === "" || line.trim().startsWith("#")) continue;

    // Key line: "key:" (no value after colon)
    const keyMatch = line.match(/^([a-z_]+):\s*$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      result[currentKey] = [];
      continue;
    }

    // List item: "  - value" or '  - "quoted value"'
    const itemMatch = line.match(/^\s+-\s+(.+)$/);
    if (itemMatch && currentKey) {
      let value = itemMatch[1].trim();
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[currentKey].push(value);
    }
  }

  return {
    workflow_id,
    required_calls: result.required_calls ?? [],
    forbidden_calls: result.forbidden_calls ?? [],
    required_order: result.required_order ?? [],
    required_byproducts: result.required_byproducts ?? [],
    success_criteria: result.success_criteria ?? [],
  };
}

// ---------------------------------------------------------------------------
// Scenario block parser — handles ```yaml scenario blocks
// ---------------------------------------------------------------------------

function parseScenarioBlocks(): Map<number, WorkflowScenario> {
  const source = readFileSync(WORKFLOWS_MD, "utf8");
  const map = new Map<number, WorkflowScenario>();

  const lines = source.split("\n");
  let lastRowNum: number | null = null;
  let inExpectedBlock = false;
  let inScenarioBlock = false;
  let blockLines: string[] = [];

  for (const line of lines) {
    // Detect a Supported table data row: starts with "| <digits> |"
    const rowMatch = line.match(/^\|\s*(\d+)\s*\|/);
    if (rowMatch && !inExpectedBlock && !inScenarioBlock) {
      lastRowNum = parseInt(rowMatch[1], 10);
      continue;
    }

    // Detect opening fence for expected block (skip it, but track lastRowNum)
    if (!inExpectedBlock && !inScenarioBlock && /^```yaml\s+expected\s*$/.test(line.trim())) {
      inExpectedBlock = true;
      continue;
    }

    // Close expected block
    if (inExpectedBlock && line.trim() === "```") {
      inExpectedBlock = false;
      continue;
    }

    // Detect opening fence for scenario block
    if (!inExpectedBlock && !inScenarioBlock && /^```yaml\s+scenario\s*$/.test(line.trim())) {
      inScenarioBlock = true;
      blockLines = [];
      continue;
    }

    // Close scenario block
    if (inScenarioBlock && line.trim() === "```") {
      inScenarioBlock = false;
      if (lastRowNum !== null) {
        const scenario = parseScenarioYaml(lastRowNum, blockLines);
        if (scenario) map.set(lastRowNum, scenario);
      }
      blockLines = [];
      continue;
    }

    if (inScenarioBlock) {
      blockLines.push(line);
    }
  }

  return map;
}

function parseScenarioYaml(workflow_id: number, lines: string[]): WorkflowScenario | null {
  for (const line of lines) {
    // Match "prompt: <value>" (quoted or unquoted)
    const m = line.match(/^prompt:\s*(.+)$/);
    if (m) {
      let value = m[1].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return { workflow_id, prompt: value };
    }
  }
  return null;
}
