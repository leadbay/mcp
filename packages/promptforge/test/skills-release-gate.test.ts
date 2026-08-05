/**
 * Release-gated prompts emit no SKILL.md.
 *
 * A Claude skill is a static file that auto-triggers on matching requests with
 * no runtime switch, so shipping one while its tools are gated off starts a
 * workflow that fails on the first tool call. The MCP prompt is filtered at
 * runtime instead; the skill simply must not exist on disk.
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { assemble } from "../src/assembler.js";
import { buildSkillFiles } from "../src/skills.js";
import { discoverRegisteredTools } from "../src/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(PKG_ROOT, "..", "..");
const CORE_SRC = resolve(REPO_ROOT, "packages", "core", "src");
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
});
