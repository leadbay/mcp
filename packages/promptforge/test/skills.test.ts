/**
 * Skills emission audit.
 *
 * Three guarantees:
 *
 * 1. Every prompt .md.tmpl has a corresponding SKILL.md at the expected
 *    plugin path. Renaming a prompt without updating the plugin would
 *    leave the catalog half-broken; this test catches that.
 *
 * 2. SKILL.md content matches what the assembler+emitter would produce
 *    right now. Freshness gate for `pnpm prompts:check`.
 *
 * 3. Each SKILL.md description is non-empty and looks like trigger
 *    phrasing (heuristic: front-matter short_description was non-empty
 *    in the source, so the description should be too).
 *
 * 4. PROMPT_CATALOG_INSTRUCTIONS names every prompt — UI-blind clients
 *    (Cowork) depend on this so the agent learns the prompt set from
 *    the initialize payload rather than from a list it never sees.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { assemble } from "../src/assembler.js";
import { buildSkillFiles } from "../src/skills.js";
import { discoverRegisteredTools } from "../src/registry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(PKG_ROOT, "..", "..");
const PROMPTS_DIR = join(PKG_ROOT, "prompts");
const SKILLS_DIR = join(
  REPO_ROOT,
  ".claude-plugin",
  "plugins",
  "leadbay",
  "skills",
);
const CORE_SRC = join(REPO_ROOT, "packages", "core", "src");
const PROMPTS_GENERATED = join(
  REPO_ROOT,
  "packages",
  "mcp",
  "src",
  "prompts.generated.ts",
);

describe("audit: SKILL.md files", () => {
  const registered = discoverRegisteredTools(CORE_SRC);
  const result = assemble({ root: PKG_ROOT, registeredToolNames: registered });
  const skillFiles = buildSkillFiles(result.prompts);

  it("every prompt .md.tmpl has a matching SKILL.md", () => {
    const templates = readdirSync(PROMPTS_DIR)
      .filter((f) => f.endsWith(".md.tmpl"))
      .map((f) => f.replace(/\.md\.tmpl$/, ""));
    for (const name of templates) {
      const path = join(SKILLS_DIR, name, "SKILL.md");
      expect(existsSync(path), `expected ${path}`).toBe(true);
    }
  });

  it("every emitted SKILL.md is in sync with .md.tmpl source", () => {
    for (const skill of skillFiles) {
      const path = join(SKILLS_DIR, skill.relativePath);
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, "utf8")).toBe(skill.content);
    }
  });

  it("every SKILL.md description is non-empty (carries trigger phrasing)", () => {
    for (const skill of skillFiles) {
      const path = join(SKILLS_DIR, skill.relativePath);
      const text = readFileSync(path, "utf8");
      const match = text.match(/^description: "((?:\\"|[^"])*)"$/m);
      expect(match, `description line missing in ${path}`).not.toBeNull();
      const description = match![1].trim();
      expect(description.length).toBeGreaterThan(20);
    }
  });

  it("emitted body has no remaining {{arg:NAME}} placeholders", () => {
    // Skills surface to Claude Code agents that don't understand MCP-style
    // structured arguments. Any leftover {{arg:…}} would land in the user's
    // session prompt unrewritten.
    for (const skill of skillFiles) {
      expect(skill.content, `${skill.name} still has {{arg:…}}`).not.toMatch(
        /\{\{arg:[a-z_][a-z0-9_]*\}\}/,
      );
    }
  });
});

/**
 * Pull the PROMPT_CATALOG_INSTRUCTIONS string out of the generated source.
 * Reads the file rather than importing it because the generated file lives
 * inside @leadbay/mcp and isn't a public export of the package. Unescaping
 * mirrors the emitter's `escapeBacktick` so we round-trip exactly.
 */
function extractCatalogFromGenerated(): string {
  const source = readFileSync(PROMPTS_GENERATED, "utf8");
  const match = source.match(
    /PROMPT_CATALOG_INSTRUCTIONS: string = `([\s\S]*?)`;\s*$/m,
  );
  if (!match) {
    throw new Error("PROMPT_CATALOG_INSTRUCTIONS export not found in generated file");
  }
  return match[1]
    .replace(/\\\$\{/g, "${")
    .replace(/\\`/g, "`")
    .replace(/\\\\/g, "\\");
}

describe("audit: PROMPT_CATALOG_INSTRUCTIONS", () => {
  const registered = discoverRegisteredTools(CORE_SRC);
  const result = assemble({ root: PKG_ROOT, registeredToolNames: registered });
  const catalog = extractCatalogFromGenerated();

  it("catalog string names every prompt by backticked identifier", () => {
    for (const p of result.prompts) {
      expect(
        catalog,
        `PROMPT_CATALOG_INSTRUCTIONS missing \`${p.frontmatter.name}\``,
      ).toMatch(new RegExp("`" + p.frontmatter.name + "`"));
    }
  });

  it("catalog string explains the direct-invoke fallback for UI-blind clients", () => {
    expect(catalog).toMatch(/prompts\/get/);
  });
});
