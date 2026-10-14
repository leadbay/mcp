import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Skeleton loading on the triage board (lead cards) and the welcome board
// (the ask buttons), in place of a spinner or a blank spot.

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, "../src/templates", p), "utf8");
const triagePage = read("triage-board/page.html");
const triageApp = read("triage-board/app.js");
const welcomePage = read("onboarding/page.html");

describe("the triage board's first load", () => {
  it("shows three skeleton cards and a hidden status line, not a spinner", () => {
    expect(triageApp).toMatch(/h\("span", \{ class: "lb-vh", role: "status", text: t\("loading"\) \}\), \.\.\.\[0, 1, 2\]\.map\(skeletonCard\)/);
    expect(triageApp).not.toMatch(/deck-loading/);
  });

  it("never gives a skeleton the lead card's class", () => {
    expect(triageApp).toMatch(/h\("div", \{ class: "sk-card", "aria-hidden": "true"/);
  });

  it("swaps each settled skeleton for its card in place, contents fading, no second entrance", () => {
    expect(triageApp).toMatch(/if \(swap && i < 3\) \{ el\.classList\.add\("triage-swap"\); return \}/);
    expect(triagePage).toMatch(/\.triage-swap > \* \{ animation: triage-fade 180ms/);
  });

  it("stills the pulse under reduced motion", () => {
    expect(triagePage).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.sk \{ animation: none; \}/);
  });
});

describe("the welcome board's ask buttons", () => {
  it("hold their spot with a skeleton bar until the board knows send or copy", () => {
    expect(welcomePage).toMatch(/\.asks:not\(\[data-ready\]\) \.ask-act::before \{ content: "";/);
  });
});
