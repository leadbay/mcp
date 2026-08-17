/**
 * Release-gated prompts emit no SKILL.md.
 *
 * A Claude skill is a static file that auto-triggers on matching requests with
 * no runtime switch, so shipping one while its tools are gated off starts a
 * workflow that fails on the first tool call. The MCP prompt is filtered at
 * runtime instead; the skill simply must not exist on disk.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { assemble } from "../src/assembler.js";
import { buildSkillFiles } from "../src/skills.js";
import { discoverRegisteredTools } from "../src/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(PKG_ROOT, "..", "..");
const CORE_SRC = resolve(REPO_ROOT, "packages", "core", "src");
const PROMPTS_DIR = resolve(PKG_ROOT, "prompts");
const SKILLS_DIR = resolve(
  REPO_ROOT,
  ".claude-plugin",
  "plugins",
  "leadbay",
  "skills",
);

const registered = discoverRegisteredTools(CORE_SRC);
const result = assemble({ root: PKG_ROOT, registeredToolNames: registered });
const gated = result.prompts.filter(
  (p) => p.frontmatter.release_gated === true,
);

describe("audit: release-gated prompts ship no skill", () => {
  it("leadbay_new_leads is currently gated", () => {
    // Guards the fixture: if this prompt is un-gated at release, this test
    // should be deleted along with the frontmatter flag — not left passing
    // vacuously over an empty set.
    expect(gated.map((p) => p.frontmatter.name)).toContain("leadbay_new_leads");
  });

  it("buildSkillFiles emits nothing for a gated prompt", () => {
    const emitted = buildSkillFiles(result.prompts).map((s) => s.name);
    for (const p of gated) {
      expect(emitted).not.toContain(p.frontmatter.name);
    }
  });

  it("no gated SKILL.md exists on disk", () => {
    for (const p of gated) {
      const path = join(SKILLS_DIR, p.frontmatter.name, "SKILL.md");
      expect(existsSync(path), `${path} must not ship while gated`).toBe(false);
    }
  });

  // The layout is what lets skills.test.ts stay untouched. That audit asserts
  // every .md.tmpl sitting DIRECTLY in prompts/ has a matching SKILL.md, and
  // reads the directory non-recursively. A gated prompt has no SKILL.md by
  // design, so the only honest way to satisfy that audit is to keep the
  // template out of the flat directory — not to weaken the audit's assertion.
  // assemble()'s findTemplates() recurses, so the subdirectory still builds.
  it("a gated prompt template lives in a subdirectory, not flat in prompts/", () => {
    const flat = new Set(
      readdirSync(PROMPTS_DIR)
        .filter((f) => f.endsWith(".md.tmpl"))
        .map((f) => f.replace(/\.md\.tmpl$/, "")),
    );
    for (const p of gated) {
      const rel = p.sourcePath.slice(p.sourcePath.indexOf("prompts/"));
      expect(
        flat.has(p.frontmatter.name),
        `${p.frontmatter.name} is flat in prompts/ but ships no SKILL.md — ` +
          `skills.test.ts would fail. Keep it under prompts/release-gated/.`,
      ).toBe(false);
      expect(rel.startsWith("prompts/release-gated/")).toBe(true);
    }
  });

  // Moving the template out of the flat directory also moves it out of reach of
  // assembler.test.ts's B23 audit, which readdirs prompts/ the same shallow way.
  // That rule still applies to this prompt — it orchestrates composites that
  // ship their own RENDERING block — so re-assert it here rather than let the
  // relocation quietly drop the coverage.
  it("a gated prompt still carries the defer-to-tool-rendering gate (B23)", () => {
    for (const p of gated) {
      const source = readFileSync(p.sourcePath, "utf8");
      expect(
        source.includes("{{include:gates/defer-to-tool-rendering}}"),
        `${p.frontmatter.name} orchestrates rendering composites and must defer to their RENDERING blocks`,
      ).toBe(true);
    }
  });
});
