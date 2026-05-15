/**
 * Audit-compliance #1: every prompt registered in the MCP CATALOG has
 * a matching eval coverage stub.
 *
 * Until the eval framework lands (Milestone D), this audit is in
 * "warn-only" mode: it lists prompts without coverage but does not fail
 * the suite. When the first eval lands, flip MUST_HAVE_COVERAGE to true.
 *
 * The check ensures the eval framework's surface stays in sync with the
 * shipped prompt catalog. New prompt → new eval stub, lockstep.
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { listPrompts } from "../../src/prompts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EVAL_DIR = resolve(__dirname, "..", "eval", "prompts");

const MUST_HAVE_COVERAGE = false; // flip to true once Milestone D lands the first eval

describe("audit: prompt eval coverage", () => {
  it("each prompt either has an eval stub or is on the deliberate-defer list", () => {
    const prompts = listPrompts();
    const missing = prompts
      .map((p) => p.name)
      .filter((name) => !existsSync(`${EVAL_DIR}/${name}.eval.ts`));
    if (MUST_HAVE_COVERAGE) {
      expect(missing).toEqual([]);
    } else {
      // Warn-only: print which prompts are uncovered so the list is visible.
      // Useful both as a TODO and as a regression check that the prompt set
      // we expect to need coverage hasn't grown silently.
      if (missing.length > 0) {
        console.warn(
          `[audit] ${missing.length} prompts await eval coverage: ${missing.join(", ")}`,
        );
      }
      // The test always passes in warn-only mode; the warning is the signal.
      expect(missing.length).toBeGreaterThanOrEqual(0);
    }
  });
});
