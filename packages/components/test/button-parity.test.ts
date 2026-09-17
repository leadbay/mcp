import { describe, it, expect } from "vitest";
import { STYLES } from "../src/styles.js";

// `.lb-btn` is the artifact's version of the product's Button
// (frontend/packages/ui/components/Button/Button.tsx). The two are seen side by
// side — an artifact opens next to the app — so a button that is a few pixels
// off, or rounds differently, reads as a knock-off.
//
// MUI spacing is 8px per unit, so Button.tsx's numbers convert as:
//   medium: py .875  px .875  radius .875  →  7px / 7px / 7px   (0.4375rem)
//   large:  py 1.75  px 2     radius 1.25  → 14px / 16px / 10px (0.875/1/0.625rem)
// These assertions pin the conversion, not the look, so a change to either side
// has to be deliberate.

const css = STYLES.replace(/\s+/g, " ");

describe("lb-btn parity with the product Button", () => {
  it("uses the medium geometry by default (7px padding, 7px radius)", () => {
    expect(css).toMatch(/\.lb-btn\{[^}]*border-radius:0\.4375rem/);
    expect(css).toMatch(/\.lb-btn\{[^}]*padding:0\.4375rem 0\.4375rem/);
  });

  it("offers the large size as an opt-in (14/16px padding, 10px radius)", () => {
    expect(css).toMatch(/\.lb-btn-lg\{[^}]*border-radius:0\.625rem/);
    expect(css).toMatch(/\.lb-btn-lg\{[^}]*padding:0\.875rem 1rem/);
  });

  it("carries the app's transition list, press-scale and disabled opacity", () => {
    expect(css).toContain("transform .16s cubic-bezier(0.23,1,0.32,1)");
    expect(css).toMatch(/\.lb-btn:active[^{]*\{transform:scale\(0\.97\)\}/);
    expect(css).toMatch(/\.lb-btn\[disabled\]\{opacity:\.4;cursor:default\}/);
  });

  it("hovers the ground to gray-2, as `secondary` does — not the border", () => {
    expect(css).toMatch(
      /\.lb-btn:hover[^{]*\{ background-color:var\(--color-gray-2\)\}/,
    );
    // The old rule moved the border instead; it must be gone.
    expect(css).not.toMatch(/\.lb-btn:hover:not\(\[disabled\]\)\{border-color:var\(--color-gray-7\)\}/);
  });

  it("guards every hover behind @media (hover:hover), as the app does", () => {
    // A touch device otherwise keeps the hover ground stuck after a tap.
    const hovers = css.match(/\.lb-btn[a-z-]*:hover/g) ?? [];
    expect(hovers.length).toBeGreaterThan(0);
    for (const block of ["@media (hover:hover){ .lb-btn:hover"]) {
      expect(css).toContain(block);
    }
  });

  it("gives lb-btn-submit the app's `primary` hover mix, not an opacity fade", () => {
    expect(css).toMatch(
      /color-mix\(in oklch,var\(--lb-fg\),var\(--color-gray-8\) 32%\)/,
    );
  });

  it("gives lb-btn-ai the app's `ai` variant tokens", () => {
    expect(css).toMatch(
      /\.lb-btn-ai\{background-color:var\(--color-purple-background\)/,
    );
    expect(css).toContain("border-color:var(--color-purple-border)");
    expect(css).toContain("color:var(--color-purple-foreground)");
    expect(css).toMatch(
      /color-mix\(in oklch,var\(--color-purple-background\),black 7%\)/,
    );
  });
});

describe("purple tokens", () => {
  it("defines the light triple, with the border derived at 65% transparency", () => {
    expect(css).toContain("--color-purple-background:oklch(0.947 0.029 288)");
    expect(css).toContain("--color-purple-foreground:oklch(0.464 0.181 288)");
    expect(css).toContain(
      "--color-purple-border:color-mix(in oklch,var(--color-purple-foreground),transparent 65%)",
    );
  });

  it("flips purple in BOTH dark paths, like every other semantic pair", () => {
    // [data-theme=dark] and the prefers-color-scheme query. Defining it in only
    // one leaves the other rendering light purple on a dark card.
    const dark = css.match(/--color-purple-background:oklch\(0\.30 0\.055 288\)/g) ?? [];
    expect(dark).toHaveLength(2);
  });
});
