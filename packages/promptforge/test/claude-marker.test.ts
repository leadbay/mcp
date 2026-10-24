// `{{claude}}` (src/claude.ts): rendering and NEXT STEPS snippets are wrapped at
// include time, kept byte-for-byte everywhere but ChatGPT, deleted there.
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isClaudeRenderingSnippet, renderClaude, validateClaudeMarkers, wrapClaude } from "../src/claude.js";
import { resolveSnippets } from "../src/snippets.js";

function root(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pf-claude-"));
  for (const [name, body] of Object.entries(files)) {
    const p = join(dir, `${name}.md`);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, body);
  }
  return dir;
}

describe("{{claude}}", () => {
  it("picks the rendering, next-steps, linking and widget-table snippets only", () => {
    expect(isClaudeRenderingSnippet("rendering/score-bar")).toBe(true);
    expect(isClaudeRenderingSnippet("next-steps/pull-leads")).toBe(true);
    expect(isClaudeRenderingSnippet("linking/contact-linkedin")).toBe(true);
    expect(isClaudeRenderingSnippet("gates/builtin-widgets")).toBe(true);
    expect(isClaudeRenderingSnippet("gates/launched-job")).toBe(false);
    expect(isClaudeRenderingSnippet("heuristics/single-country-universe")).toBe(false);
  });

  it("keeping the blocks gives back exactly the unwrapped text", () => {
    for (const content of ["C\n", "C", "C\n\nD\n"]) {
      const plain = `A\n${content}\nB\n`;
      expect(renderClaude(`A\n${wrapClaude(content)}\nB\n`, "with")).toBe(plain);
    }
  });

  it("wraps an include once, never its nested includes", () => {
    const dir = root({
      "next-steps/x": "## NEXT STEPS\n\n{{include:next-steps/routing}}\n\nrow\n",
      "next-steps/routing": "use the widget\n",
      "gates/other": "plain\n",
    });
    const body = resolveSnippets("Intro\n\n{{include:next-steps/x}}\n\n{{include:gates/other}}\n", {
      snippetsRoot: dir,
      sourcePath: "t",
    });
    expect(body.match(/\{\{claude\}\}/g)).toHaveLength(1);
    expect(validateClaudeMarkers(body)).toBeNull();
    expect(renderClaude(body, "without").trimEnd()).toBe("Intro\n\nplain");
  });

  it("deleting collapses the rules a removed section stood between", () => {
    const body = "A\n\n---\n\n{{claude}}\nX\n{{/claude}}\n\n---\n\nB\n\n---\n\n{{claude}}\nY\n{{/claude}}\n";
    expect(renderClaude(body, "without")).toBe("A\n\n---\n\nB\n");
  });
});
