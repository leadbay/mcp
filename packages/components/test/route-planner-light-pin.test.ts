import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { STYLES } from "../src/styles.js";

// Seen on a dark-mode laptop: the route planner's title, lead names and map
// labels read white on its white panel. Its light pin was `:root:root:root`,
// (0,3,0), which only TIED the skin's OS dark block
// `:root:not([data-theme=light]):not([data-lb-theme=light])` and lost on
// source order, since lb.styles() appends the skin after the page's sheet.

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "../src/templates/route-planner/page.html"), "utf8");

/** Specificity of a selector made only of :root, :not([attr]) and [attr]. */
function specificity(selector: string): number {
  const roots = (selector.match(/:root/g) || []).length;
  const attrs = (selector.match(/\[[^\]]+\]/g) || []).length;
  return roots + attrs;
}

/** The declarations of the page's light pin. */
function pinBlock(): { selector: string; body: string } {
  const m = page.match(/(:root(?::root)+)\s*\{([^}]*)\}/);
  if (!m) throw new Error("no light pin in the route planner");
  return { selector: m[1], body: m[2] };
}

describe("the route planner stays light on a dark-mode OS", () => {
  it("the pin outranks the skin's OS dark block, not just ties it", () => {
    const os = STYLES.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*([^{]+)\{/);
    expect(os).not.toBeNull();
    expect(specificity(pinBlock().selector)).toBeGreaterThan(specificity(os![1].trim()));
  });

  it("the pin outranks a host's data-theme=dark block", () => {
    expect(specificity(pinBlock().selector)).toBeGreaterThan(specificity(":root[data-theme=dark]"));
  });

  it("holds every token the skin's dark blocks change that the board reads", () => {
    const { body } = pinBlock();
    for (const token of ["--lb-fg", "--lb-field", "--lb-page-bg", "--lb-btn-border", "--lb-text-blue", "--color-yellow-foreground"]) {
      expect(body, token).toContain(token + ":");
    }
  });
});
