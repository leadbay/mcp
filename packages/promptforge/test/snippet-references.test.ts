/**
 * Audit-compliance #10: every snippet under snippets/ is referenced by
 * at least one .md.tmpl (no orphans), and every {{include:...}} in a
 * .md.tmpl resolves to an existing snippet file (no dead refs).
 *
 * Catches the slow drift where snippets accumulate, get unused, and
 * confuse future authors about which prose is the canonical one.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { listSnippetsReferenced } from "../src/snippets.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, "..");
const SNIPPETS_ROOT = join(PKG_ROOT, "snippets");
const PROMPTS_DIR = join(PKG_ROOT, "prompts");
const TOOL_DESC_DIR = join(PKG_ROOT, "tool-descriptions");

function walk(dir: string, filter: (path: string) => boolean): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const entry of readdirSync(cur)) {
      const p = join(cur, entry);
      const s = statSync(p);
      if (s.isDirectory()) stack.push(p);
      else if (filter(p)) out.push(p);
    }
  }
  return out;
}

describe("audit: snippet references", () => {
  const allTemplates = [
    ...walk(PROMPTS_DIR, (p) => p.endsWith(".md.tmpl")),
    ...walk(TOOL_DESC_DIR, (p) => p.endsWith(".md.tmpl")),
  ];
  const allSnippets = walk(SNIPPETS_ROOT, (p) => p.endsWith(".md")).map((p) =>
    relative(SNIPPETS_ROOT, p).replace(/\.md$/, ""),
  );

  it("every {{include:...}} in a template resolves to an existing snippet", () => {
    const orphans: string[] = [];
    for (const tmpl of allTemplates) {
      const body = readFileSync(tmpl, "utf8");
      const refs = listSnippetsReferenced(body);
      for (const ref of refs) {
        if (!existsSync(join(SNIPPETS_ROOT, `${ref}.md`))) {
          orphans.push(`${relative(PKG_ROOT, tmpl)} → ${ref}`);
        }
      }
    }
    expect(orphans).toEqual([]);
  });

  it("every snippet in snippets/ is referenced by at least one template", () => {
    // Build the transitive include set: a snippet may be referenced indirectly
    // via another snippet. Walk the include graph.
    const referenced = new Set<string>();
    const queue: string[] = [];
    // This snippet is injected by assembler.ts for routed tools, not by a
    // literal {{include:...}} in a template.
    referenced.add("headers/agent-memory-pointer");
    for (const tmpl of allTemplates) {
      const body = readFileSync(tmpl, "utf8");
      for (const r of listSnippetsReferenced(body)) {
        if (!referenced.has(r)) {
          referenced.add(r);
          queue.push(r);
        }
      }
    }
    while (queue.length) {
      const cur = queue.shift()!;
      const path = join(SNIPPETS_ROOT, `${cur}.md`);
      if (!existsSync(path)) continue;
      const body = readFileSync(path, "utf8");
      for (const r of listSnippetsReferenced(body)) {
        if (!referenced.has(r)) {
          referenced.add(r);
          queue.push(r);
        }
      }
    }
    const orphans = allSnippets.filter((s) => !referenced.has(s));
    expect(orphans).toEqual([]);
  });
});
