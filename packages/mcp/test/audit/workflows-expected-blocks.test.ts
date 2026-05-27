/**
 * Audit: every "Supported today" workflow in WORKFLOWS.md has a valid
 * ```yaml expected block immediately after its row.
 *
 * These blocks are the single source of truth for eval contracts
 * (required_calls, forbidden_calls, success_criteria). If a row lacks one,
 * the eval runner will throw at runtime — catch it here in CI instead.
 *
 * Why a separate file: the no-modify-existing-tests convention means new
 * assertions go in new files.
 */
import { describe, it, expect } from "vitest";
import { getAllWorkflowExpected } from "../eval/helpers/workflows-parser.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const WORKFLOWS_MD = resolve(REPO_ROOT, "WORKFLOWS.md");

function extractSupportedWorkflowIds(source: string): number[] {
  const ids: number[] = [];
  const lines = source.split("\n");
  let inSupportedSection = false;
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## Supported today")) {
      inSupportedSection = true;
      inTable = false;
      continue;
    }
    if (inSupportedSection && line.startsWith("## ")) break;
    if (!inSupportedSection) continue;

    if (line.trim().startsWith("|") && /^\|\s*-{3,}/.test(lines[i + 1] ?? "")) {
      inTable = true;
      continue;
    }
    if (inTable && line.trim().startsWith("|---")) continue;
    if (inTable && line.trim().startsWith("| #")) continue;
    if (inTable && line.trim().startsWith("|")) {
      const match = line.match(/^\|\s*(\d+)\s*\|/);
      if (match) ids.push(parseInt(match[1], 10));
    }
  }
  return ids;
}

const SOURCE = readFileSync(WORKFLOWS_MD, "utf8");

describe("audit: every Supported workflow has a valid expected block", () => {
  it("each Supported row has a parseable ```yaml expected block with required_calls and success_criteria", () => {
    const ids = extractSupportedWorkflowIds(SOURCE);
    expect(ids.length, "expected to find at least one Supported row").toBeGreaterThan(0);

    const allExpected = getAllWorkflowExpected();
    const missing: number[] = [];
    const empty: number[] = [];

    for (const id of ids) {
      const entry = allExpected.get(id);
      if (!entry) {
        missing.push(id);
      } else if (entry.required_calls.length === 0 || entry.success_criteria.length === 0) {
        empty.push(id);
      }
    }

    expect(
      missing,
      `Supported workflows missing a \`\`\`yaml expected block: rows ${JSON.stringify(missing)}. ` +
        "Add a block immediately after the row in WORKFLOWS.md.",
    ).toEqual([]);

    expect(
      empty,
      `Supported workflows with empty required_calls or success_criteria: rows ${JSON.stringify(empty)}. ` +
        "Each expected block must have at least one required_call and one success criterion.",
    ).toEqual([]);
  });
});
