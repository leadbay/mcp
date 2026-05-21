/**
 * Audit: the repo-root WORKFLOWS.md table is normative.
 *
 * Every backtick-wrapped `leadbay_*` identifier must resolve to a real
 * registered tool name (from @leadbay/core) or a real registered prompt
 * (from listPrompts()). Every path in a Tests column must exist on
 * disk. Catches renames, deleted tests, and silent drift between the
 * triage doc and the shipped MCP surface.
 *
 * Why this matters: the table is the canonical lens for triaging
 * incoming enterprise demo asks (e.g. product#3630). If it claims a
 * workflow uses `leadbay_pull_leads` after we rename to
 * `leadbay_pull_lead`, the answer to "is this covered?" becomes a lie.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  compositeReadTools,
  compositeWriteTools,
  granularReadTools,
  granularWriteTools,
} from "@leadbay/core";
import { listPrompts } from "../../src/prompts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const WORKFLOWS_MD = resolve(REPO_ROOT, "WORKFLOWS.md");

const KNOWN_TOOLS = new Set(
  [
    ...compositeReadTools,
    ...compositeWriteTools,
    ...granularReadTools,
    ...granularWriteTools,
  ].map((t) => t.name),
);
const KNOWN_PROMPTS = new Set(listPrompts().map((p) => p.name));

// Skills shipped via the Claude Code plugin marketplace. Each is a
// directory under .claude-plugin/plugins/leadbay/skills/<name>/SKILL.md;
// some are also registered as MCP prompts, others are skills-only
// (e.g. leadbay_followup_check_in). WORKFLOWS.md can cite either.
const SKILLS_DIR = resolve(
  REPO_ROOT,
  ".claude-plugin",
  "plugins",
  "leadbay",
  "skills",
);
const KNOWN_SKILLS = new Set(
  existsSync(SKILLS_DIR)
    ? readdirSync(SKILLS_DIR).filter((name) =>
        statSync(resolve(SKILLS_DIR, name)).isDirectory(),
      )
    : [],
);

// Anything backtick'd that starts with `leadbay_` MUST be a real tool or
// prompt. Other backtick'd identifiers (host widgets like
// `places_map_display_v0`, `message_compose_v1`; JSON keys; gap-kind
// tokens like `mcp` / `backend`) pass through untouched.
const LEADBAY_IDENT_RE = /`(leadbay_[a-z0-9_]+)`/g;

// Test paths in the Tests column are written as inline-code: e.g.
// `packages/mcp/test/smoke/live.test.ts`. We treat anything that looks
// like a path under packages/ as a test pointer and assert existence.
const PATH_LIKE_RE = /`(packages\/[^`\s]+\.test\.ts)`/g;

const SOURCE = readFileSync(WORKFLOWS_MD, "utf8");

describe("audit: WORKFLOWS.md is normative", () => {
  it("WORKFLOWS.md exists at repo root", () => {
    expect(existsSync(WORKFLOWS_MD)).toBe(true);
  });

  it("every backtick'd leadbay_* identifier resolves to a registered tool or prompt", () => {
    const offenders: string[] = [];
    const seen = new Set<string>();
    for (const match of SOURCE.matchAll(LEADBAY_IDENT_RE)) {
      const ident = match[1];
      if (seen.has(ident)) continue;
      seen.add(ident);
      if (KNOWN_TOOLS.has(ident)) continue;
      if (KNOWN_PROMPTS.has(ident)) continue;
      if (KNOWN_SKILLS.has(ident)) continue;
      offenders.push(ident);
    }
    expect(
      offenders,
      `WORKFLOWS.md references identifiers that aren't registered tools, prompts, or skills: ${JSON.stringify(offenders)}. Likely a rename, typo, or planned-but-not-yet-shipped tool that should live in a Planned row's "proposed" prose (not backtick'd as if it existed).`,
    ).toEqual([]);
  });

  it("every Tests-column path exists on disk", () => {
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const match of SOURCE.matchAll(PATH_LIKE_RE)) {
      const relPath = match[1];
      if (seen.has(relPath)) continue;
      seen.add(relPath);
      const abs = resolve(REPO_ROOT, relPath);
      if (!existsSync(abs)) missing.push(relPath);
    }
    expect(
      missing,
      `WORKFLOWS.md cites test files that don't exist: ${JSON.stringify(missing)}. Either the test was moved/deleted, or the row should be moved out of "Supported" — a row claims "covered" only if a real test backs it.`,
    ).toEqual([]);
  });

  it("every table data row has the same column count as its header", () => {
    // Lightweight markdown-table validity check: scan section-by-section,
    // find headers (lines starting with "|" followed by a separator row of
    // "|---|"), then assert every subsequent data row matches the column
    // count until the next blank line / heading. A drift here usually
    // means a row was edited without matching the header — silent visual
    // breakage in rendered markdown.
    const lines = SOURCE.split("\n");
    const offenders: string[] = [];
    let headerCols: number | null = null;
    let headerLineNo: number | null = null;
    const countCols = (row: string) => {
      const trimmed = row.trim().replace(/^\|/, "").replace(/\|$/, "");
      return trimmed.split("|").length;
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const next = lines[i + 1] ?? "";
      if (line.trim().startsWith("|") && /^\|\s*-{3,}/.test(next.trim())) {
        headerCols = countCols(line);
        headerLineNo = i + 1; // 1-indexed
        i++; // skip the separator
        continue;
      }
      if (headerCols !== null && line.trim().startsWith("|")) {
        const cols = countCols(line);
        if (cols !== headerCols) {
          offenders.push(
            `line ${i + 1}: ${cols} cols vs header at line ${headerLineNo} (${headerCols} cols)`,
          );
        }
        continue;
      }
      // Blank line or non-table line resets the active header.
      if (line.trim() === "" || line.startsWith("#")) {
        headerCols = null;
        headerLineNo = null;
      }
    }
    expect(
      offenders,
      `WORKFLOWS.md has malformed table rows (column-count mismatch): ${JSON.stringify(offenders)}`,
    ).toEqual([]);
  });
});
