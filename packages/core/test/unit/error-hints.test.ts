/**
 * Error-hint actionability audit (iter23).
 *
 * Static-scan drift-catcher: walks production source files, finds every
 * `hint:` string, and asserts it names a specific recovery action — a
 * tool, URL, time window, or concrete input change. This prevents future
 * error codes from shipping with vague hints like "try again later" or
 * empty strings.
 *
 * Acceptable patterns (at least one must match):
 *   - leadbay_<tool_name>     (most common; names the next tool)
 *   - https?://...            (URL pointing to docs / dashboard)
 *   - Time window             (~60s, wait Ns, >Ns, 30-day, after Ns, etc.)
 *   - Input change            (Set X:, Use X, Pass X, Drop X, Provide X, Re-call ...)
 *
 * Hints that fail this rule should either be rewritten OR added to
 * EXEMPTIONS with a one-line justification.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// File-system root: this test lives at packages/core/test/unit/...
// Walk from packages/core/src/.
const SRC_ROOT = join(__dirname, "..", "..", "src");

// Files that may contain hints (composite + tools + client).
const SCAN_DIRS = ["composite", "tools"];
const SCAN_FILES = ["client.ts"];

// Hints whose actionability is not improved by a tool-name reference and
// whose semantic is "set this exact field". Each entry needs a one-line
// justification so the exemption is explicit.
const EXEMPTIONS: Record<string, string> = {
  // None at iter-23 baseline; entries added here must justify why the
  // generic actionability rule doesn't fit.
};

const ACTIONABLE_PATTERNS: RegExp[] = [
  /\bleadbay_[a-z_]+/, // tool name
  /https?:\/\//, // URL
  /\b(\d+s|\d+\s*seconds?|\d+\s*minutes?|\d+\s*ms|\d+-day|wait\s+\w+|after\s+~?\w+|>\d+s|<\d+s|~\d+s|~\d+\s*seconds?)\b/i, // time window
  /\b(Set|Use|Pass|Provide|Drop|Re-call|Retry|Call|Replace|Verify|Check|Generate|Re-?generate)\s+\S+/i, // input change
  /LEADBAY_[A-Z_]+\s*=/, // env var assignment
  /\$LEADBAY_[A-Z_]+/, // env var reference
  /Ask\s+your\s+Leadbay\s+org\s+admin/i, // user action: org admin
  /Contact\s+Leadbay\s+support/i, // user action: support
];

interface HintMatch {
  file: string;
  hint: string;
}

function* walkFiles(dir: string): Generator<string> {
  const entries = readdirSync(dir);
  for (const e of entries) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) yield* walkFiles(p);
    else if (s.isFile() && p.endsWith(".ts")) yield p;
  }
}

function extractHints(filePath: string): string[] {
  const src = readFileSync(filePath, "utf8");
  const hints: string[] = [];
  // Match `hint: "..."` and `hint: \n "..." + "..."` forms. Capture from
  // `hint:` to the closing comma at end-of-statement, then collapse the
  // raw string-concatenation into a single normalized hint string.
  // Conservative scan — we just want every `hint:` line and its
  // continuation up to the next non-string token.
  const re = /\bhint:\s*((?:"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)(?:\s*\+\s*(?:"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`))*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    // Reduce concatenated string literals to one normalized string.
    const raw = m[1];
    // Replace template-literal interpolations with `<dynamic>` so the
    // pattern check sees stable substrings.
    const stripped = raw
      .replace(/\${[^}]*}/g, "<dynamic>")
      .replace(/[`"]/g, "")
      .replace(/\s*\+\s*/g, " ")
      .trim();
    if (stripped.length > 0) hints.push(stripped);
  }
  return hints;
}

describe("error-hint actionability audit (iter23)", () => {
  it("collects hints from every production source file", () => {
    const all: HintMatch[] = [];
    for (const dir of SCAN_DIRS) {
      const fullDir = join(SRC_ROOT, dir);
      for (const f of walkFiles(fullDir)) {
        for (const h of extractHints(f)) all.push({ file: f, hint: h });
      }
    }
    for (const f of SCAN_FILES) {
      const fullF = join(SRC_ROOT, f);
      for (const h of extractHints(fullF)) all.push({ file: fullF, hint: h });
    }
    // Sanity check: we should find at least 20 hints (the codebase has
    // many). If this assertion fails, the regex broke.
    expect(all.length).toBeGreaterThan(20);
  });

  it("every hint names a specific recovery action", () => {
    const violations: HintMatch[] = [];
    for (const dir of SCAN_DIRS) {
      const fullDir = join(SRC_ROOT, dir);
      for (const f of walkFiles(fullDir)) {
        for (const h of extractHints(f)) {
          // Skip non-error hints (e.g., outputSchema description fields
          // labelled "hint" in some places).
          // Heuristic: hints we care about are ≥10 chars. Field-description
          // strings are sometimes shorter or describe shape, not action.
          if (h.length < 10) continue;
          if (h in EXEMPTIONS) continue;
          const matches = ACTIONABLE_PATTERNS.some((re) => re.test(h));
          if (!matches) {
            violations.push({ file: f, hint: h });
          }
        }
      }
    }
    for (const f of SCAN_FILES) {
      const fullF = join(SRC_ROOT, f);
      for (const h of extractHints(fullF)) {
        if (h.length < 10) continue;
        if (h in EXEMPTIONS) continue;
        const matches = ACTIONABLE_PATTERNS.some((re) => re.test(h));
        if (!matches) violations.push({ file: fullF, hint: h });
      }
    }
    if (violations.length > 0) {
      const summary = violations
        .map((v) => `  ${v.file.replace(SRC_ROOT, "src")}\n    "${v.hint}"`)
        .join("\n");
      // Useful failure message: shows exactly which hint is too vague.
      expect(
        violations,
        `Hints lacking a specific recovery action (tool name, URL, time window, or input change):\n${summary}\n\nFix by referencing a tool (leadbay_*), URL, time, or specific action — or add to EXEMPTIONS with a one-line justification.`
      ).toEqual([]);
    }
  });

  it("EXEMPTIONS each carry a non-empty justification", () => {
    for (const [hint, reason] of Object.entries(EXEMPTIONS)) {
      expect(reason.length, `EXEMPTION '${hint}' reason is empty`).toBeGreaterThan(20);
    }
  });
});
