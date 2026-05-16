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
 * - Any prompt that orchestrates a composite carrying a RENDERING block
 *   MUST include the `gates/defer-to-tool-rendering` snippet (B23).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { assemble } from "../src/assembler.js";
import { discoverRegisteredTools } from "../src/registry.js";
import { listSnippetsReferenced } from "../src/snippets.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, "..");
const CORE_SRC = join(PKG_ROOT, "..", "core", "src");
const PROMPTS_DIR = join(PKG_ROOT, "prompts");
const COMPOSITE_TOOL_DIR = join(PKG_ROOT, "tool-descriptions", "composite");
const DEFER_GATE = "gates/defer-to-tool-rendering";

function compositesWithRendering(): Set<string> {
  const out = new Set<string>();
  for (const entry of readdirSync(COMPOSITE_TOOL_DIR)) {
    if (!entry.endsWith(".md.tmpl")) continue;
    const source = readFileSync(join(COMPOSITE_TOOL_DIR, entry), "utf8");
    // A composite carries a RENDERING contract if its description either
    // includes a `{{include:rendering/...}}` snippet or inlines a `RENDERING`
    // header. Either form is the structural contract the prompt must defer to.
    if (/\{\{include:rendering\//.test(source) || /^##?\s+RENDERING\b/m.test(source)) {
      const match = source.match(/^name:\s*(leadbay_[a-z0-9_]+)/m);
      if (match) out.add(match[1]);
    }
  }
  return out;
}

function transitiveIncludes(promptPath: string): Set<string> {
  // Walk the include graph from a prompt body so the gate counts whether it's
  // included directly or via another snippet.
  const snippetsRoot = join(PKG_ROOT, "snippets");
  const seen = new Set<string>();
  const queue: string[] = [];
  const body = readFileSync(promptPath, "utf8");
  for (const r of listSnippetsReferenced(body)) {
    if (!seen.has(r)) { seen.add(r); queue.push(r); }
  }
  while (queue.length) {
    const cur = queue.shift()!;
    const path = join(snippetsRoot, `${cur}.md`);
    if (!existsSync(path)) continue;
    const snippetBody = readFileSync(path, "utf8");
    for (const r of listSnippetsReferenced(snippetBody)) {
      if (!seen.has(r)) { seen.add(r); queue.push(r); }
    }
  }
  return seen;
}

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

  it("every prompt that orchestrates a composite with a RENDERING block includes gates/defer-to-tool-rendering (B23)", () => {
    const renderingComposites = compositesWithRendering();
    expect(renderingComposites.size).toBeGreaterThan(0); // sanity: at least one composite ships RENDERING
    const offenders: string[] = [];
    for (const entry of readdirSync(PROMPTS_DIR)) {
      if (!entry.endsWith(".md.tmpl")) continue;
      const promptPath = join(PROMPTS_DIR, entry);
      const source = readFileSync(promptPath, "utf8");
      const expectedCallsBlock = source.match(/^expected_calls:\s*\n((?:\s*-\s*[a-z_]+\n)+)/m);
      if (!expectedCallsBlock) continue;
      const calls = [...expectedCallsBlock[1].matchAll(/-\s*([a-z_]+)/g)].map((m) => m[1]);
      const orchestratesRendering = calls.some((c) => renderingComposites.has(c));
      if (!orchestratesRendering) continue;
      const includes = transitiveIncludes(promptPath);
      if (!includes.has(DEFER_GATE)) {
        offenders.push(`${entry} orchestrates [${calls.filter((c) => renderingComposites.has(c)).join(", ")}] but missing {{include:${DEFER_GATE}}}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
