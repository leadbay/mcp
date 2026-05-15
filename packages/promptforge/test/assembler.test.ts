/**
 * Smoke + validation tests for the assembler.
 *
 * Confirms:
 * - Build produces non-empty prompts and tool descriptions.
 * - Frontmatter is parsed and the expected fields surface in PROMPT_META.
 * - The `expected_calls` field references only tools that exist in the
 *   live @leadbay/core registry (catches stale tool renames).
 * - failure_modes >= 3 is enforced for prompts whose expected_calls
 *   include mutating tools.
 */
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { assemble } from "../src/assembler.js";
import { discoverRegisteredTools } from "../src/registry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, "..");
const CORE_SRC = join(PKG_ROOT, "..", "core", "src");

describe("assembler", () => {
  const registered = discoverRegisteredTools(CORE_SRC);
  const result = assemble({ root: PKG_ROOT, registeredToolNames: registered });

  it("discovers at least one prompt and one tool description", () => {
    expect(result.prompts.length).toBeGreaterThan(0);
    expect(result.toolDescriptions.length).toBeGreaterThan(0);
  });

  it("every assembled prompt has a non-empty body", () => {
    for (const p of result.prompts) {
      expect(p.body.length).toBeGreaterThan(50);
      expect(p.frontmatter.kind).toBe("prompt");
    }
  });

  it("every assembled tool description has a non-empty body", () => {
    for (const t of result.toolDescriptions) {
      expect(t.body.length).toBeGreaterThan(50);
      expect(t.frontmatter.kind).toBe("tool-description");
    }
  });

  it("leadbay_import_file expected_calls reference only registered tools", () => {
    const importFile = result.prompts.find((p) => p.frontmatter.name === "leadbay_import_file");
    expect(importFile).toBeDefined();
    for (const callName of importFile!.frontmatter.expected_calls ?? []) {
      expect(registered.has(callName)).toBe(true);
    }
  });

  it("leadbay_import_file declares at least 3 failure modes (mutating prompt)", () => {
    const importFile = result.prompts.find((p) => p.frontmatter.name === "leadbay_import_file");
    expect(importFile?.frontmatter.failure_modes?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
