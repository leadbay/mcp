/**
 * Audit: every "Supported today" workflow in WORKFLOWS.md has at least one
 * eval test file in packages/mcp/test/eval/prompts/.
 *
 * WORKFLOWS.md is the single source of truth for what's testable. This audit
 * enforces that when someone adds a new supported workflow row they also add
 * an eval file — the two must stay in sync.
 *
 * The check works by parsing the Tests column of each Supported row and
 * asserting that at least one `packages/mcp/test/eval/...eval.ts` path
 * is cited. A row that only cites routing-block or smoke tests is considered
 * "not eval-covered" and the audit will list it.
 *
 * Why a separate file from workflows.test.ts: the no-modify-existing-tests
 * convention means new assertions go in new files.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const WORKFLOWS_MD = resolve(REPO_ROOT, "WORKFLOWS.md");

const EVAL_PATH_RE = /`(packages\/mcp\/test\/eval\/[^`\s]+\.eval\.ts)`/g;

function extractSupportedRows(source: string): Array<{ rowNum: number; raw: string }> {
  const rows: Array<{ rowNum: number; raw: string }> = [];
  const lines = source.split("\n");
  let inSupportedSection = false;
  let inTable = false;

  for (const line of lines) {
    if (line.startsWith("## Supported today")) {
      inSupportedSection = true;
      inTable = false;
      continue;
    }
    if (inSupportedSection && line.startsWith("## ")) {
      break;
    }
    if (!inSupportedSection) continue;

    if (line.trim().startsWith("|") && /^\|\s*-{3,}/.test(lines[lines.indexOf(line) + 1] ?? "")) {
      inTable = true;
      continue;
    }
    if (inTable && line.trim().startsWith("| #")) continue; // separator already consumed
    if (inTable && line.trim().startsWith("|---")) continue;
    if (inTable && line.trim().startsWith("|")) {
      const match = line.match(/^\|\s*(\d+)\s*\|/);
      if (match) {
        rows.push({ rowNum: parseInt(match[1], 10), raw: line });
      }
    }
  }
  return rows;
}

const SOURCE = readFileSync(WORKFLOWS_MD, "utf8");

describe("audit: every Supported workflow has at least one eval file", () => {
  it("each Supported row cites at least one .eval.ts path in its Tests column", () => {
    const rows = extractSupportedRows(SOURCE);
    expect(rows.length, "expected to find at least one Supported row").toBeGreaterThan(0);

    const uncovered: number[] = [];
    for (const row of rows) {
      const evalMatches = [...row.raw.matchAll(EVAL_PATH_RE)];
      if (evalMatches.length === 0) {
        uncovered.push(row.rowNum);
      }
    }

    expect(
      uncovered,
      `Supported workflows without eval coverage: rows ${JSON.stringify(uncovered)}. ` +
        `Add a .eval.ts file under packages/mcp/test/eval/prompts/ and cite it in the Tests column of WORKFLOWS.md.`,
    ).toEqual([]);
  });
});
