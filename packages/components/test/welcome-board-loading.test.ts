import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The welcome board while the account loads, and its logo.

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "../src/templates/onboarding/page.html"), "utf8");
const app = readFileSync(join(here, "../src/templates/onboarding/app.js"), "utf8");

describe("the welcome board while the account loads", () => {
  it("holds the learned card's place with a skeleton, hidden from assistive tech", () => {
    expect(page).toMatch(/<div class="lb-card skeleton" id="learned-loading" aria-hidden="true">/);
  });

  it("drops the skeleton once the account is read, or could not be", () => {
    expect(app).toMatch(/\$\("learned-loading"\)\.hidden = !!\(data \|\| failed\)/);
  });

  it("stills the skeleton's pulse under reduced motion", () => {
    expect(page).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.sk \{ animation: none; \} \}/);
  });
});

describe("the Leadbay logo", () => {
  it("is black in every theme", () => {
    expect(page).toMatch(/\.hello svg \{[^}]*color: var\(--color-black\)/);
  });

  it("sits on a white rounded tile on a dark host and on a dark OS", () => {
    expect(page).toMatch(/:root\[data-theme=dark\] \.hello svg, :root\[data-lb-theme=dark\] \.hello svg \{\s*background: var\(--color-white\)/);
    expect(page).toMatch(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme=light\]\):not\(\[data-lb-theme=light\]\) \.hello svg \{\s*background: var\(--color-white\)/);
  });
});
