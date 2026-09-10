/**
 * The release_gated mechanism, kept honest with no gated prompt in the tree.
 *
 * A Claude skill is a static file that auto-triggers on matching requests with
 * no runtime switch, so shipping one while its tools are gated off starts a
 * workflow that fails on the first tool call. `release_gated: true` suppresses
 * the SKILL.md; the MCP prompt is filtered at runtime instead.
 *
 * `leadbay_new_leads` was the only user of that flag, and it is un-gated now
 * that the /1.6/mcp/* routes shipped in backend v3.22.0. The original version
 * of this file asserted that prompt was gated and warned it "should be deleted
 * along with the frontmatter flag — not left passing vacuously over an empty
 * set". The flag itself stays in promptforge for the next rollout, so rather
 * than delete the coverage, the mechanism is now exercised directly on
 * synthetic artifacts, and the real tree is asserted to contain no gated
 * prompt — which is what makes the vacuity impossible to hide.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
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

/** A minimal artifact shaped like an assembled prompt — enough for the filter
 *  in buildSkillFiles, which reads only frontmatter.name and the body. */
const artifact = (name: string, releaseGated?: boolean) =>
  ({
    frontmatter: {
      name,
      kind: "prompt",
      short_description: `${name} description`,
      arguments: [],
      ...(releaseGated === undefined ? {} : { release_gated: releaseGated }),
    },
    body: `Body of ${name}.`,
    sourcePath: `${PROMPTS_DIR}/${name}.md.tmpl`,
  }) as unknown as Parameters<typeof buildSkillFiles>[0][number];

describe("audit: the release_gated mechanism", () => {
  it("buildSkillFiles drops a gated prompt and keeps its siblings", () => {
    const emitted = buildSkillFiles([
      artifact("ungated_absent_flag"),
      artifact("ungated_explicit_false", false),
      artifact("gated_prompt", true),
    ]).map((s) => s.name);

    expect(emitted).toEqual(["ungated_absent_flag", "ungated_explicit_false"]);
  });

  it("only the literal `true` gates — a truthy string does not", () => {
    // frontmatter.ts types the field as a boolean, but the filter is
    // `!== true`, so pin that a YAML slip cannot silently suppress a skill.
    const loose = artifact("loose_flag");
    (loose.frontmatter as Record<string, unknown>).release_gated = "true";
    expect(buildSkillFiles([loose]).map((s) => s.name)).toEqual(["loose_flag"]);
  });
});

describe("audit: no prompt in the tree is release-gated today", () => {
  const gated = result.prompts.filter(
    (p) => p.frontmatter.release_gated === true,
  );

  it("the gated set is empty", () => {
    // If a future rollout re-arms the flag, this fails and whoever added it
    // gets the reminder that the cases below stop being vacuous.
    expect(gated.map((p) => p.frontmatter.name)).toEqual([]);
  });

  it("prompts/release-gated/ no longer exists", () => {
    expect(existsSync(join(PROMPTS_DIR, "release-gated"))).toBe(false);
  });

  it("leadbay_new_leads is flat in prompts/ and ships its SKILL.md", () => {
    // The inverse of what the gated layout required: skills.test.ts asserts
    // every .md.tmpl sitting DIRECTLY in prompts/ has a matching SKILL.md, and
    // reads the directory non-recursively — so being flat and having the file
    // are one fact, not two.
    const flat = readdirSync(PROMPTS_DIR)
      .filter((f) => f.endsWith(".md.tmpl"))
      .map((f) => f.replace(/\.md\.tmpl$/, ""));
    expect(flat).toContain("leadbay_new_leads");
    expect(existsSync(join(SKILLS_DIR, "leadbay_new_leads", "SKILL.md"))).toBe(
      true,
    );
  });
});
