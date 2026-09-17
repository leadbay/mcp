import { describe, it, expect } from "vitest";
import { STYLES } from "../src/styles.js";
import { ARTIFACT_USAGE_GUIDE as GUIDE } from "../../core/src/artifact-runtime.generated.js";

// The card's LAYOUT — its section stack and spacing scale — used to live only
// in whatever the agent hand-wrote per artifact, so every board came out with a
// different rhythm and the same mistakes were re-made: two titled blocks
// sharing one container, a section title nested inside a row, controls at three
// different widths. The skin now ships the geometry and the guide describes it,
// so a card built from the recipe is the same card every time.

const css = STYLES.replace(/\s+/g, " ");
const flat = GUIDE.replace(/\s+/g, " ");

describe("the skin ships the card's section geometry", () => {
  it("one wrapper owns the rhythm: 16px between sections", () => {
    expect(css).toMatch(/\.lb-sections\{display:flex;flex-direction:column;gap:1rem\}/);
  });

  it("a section spaces its own children at 8px", () => {
    expect(css).toMatch(/\.lb-section\{display:grid;gap:0\.5rem\}/);
  });

  it("the scale halves at each level: 16px → 8px → 4px", () => {
    // Sections 16px, a section's children 8px, and the tightest group —
    // consecutive data lines — 4px. Each step is 2x its inner one, which is
    // what makes a level read as a group instead of as noise.
    expect(css).toMatch(/\.lb-sections\{[^}]*gap:1rem\}/);
    expect(css).toMatch(/\.lb-section\{display:grid;gap:0\.5rem\}/);
    expect(css).toMatch(/\.lb-facts\{display:grid;gap:0\.25rem\}/);
  });

  it("a stack never spaces its controls wider than its section", () => {
    expect(css).toMatch(/\.lb-stack\{display:grid;gap:0\.5rem\}/);
  });

  it("section titles are uppercase and use the foreground, not the muted tone", () => {
    expect(css).toMatch(/\.lb-sec-title\{[^}]*text-transform:uppercase/);
    expect(css).toMatch(/\.lb-sec-title\{[^}]*color:var\(--lb-fg\)/);
    expect(css).toMatch(/\.lb-sec-title\{[^}]*font-weight:700/);
  });

  it("the lead title is bold and underlined, and inherits into its link", () => {
    expect(css).toMatch(/\.lb-lead-title\{[^}]*font-weight:700/);
    expect(css).toMatch(/\.lb-lead-title\{[^}]*text-decoration:underline/);
    expect(css).toMatch(/\.lb-lead-title a\{color:inherit;text-decoration:inherit\}/);
  });

  it("the header pushes trailing controls to the far edge", () => {
    expect(css).toMatch(/\.lb-card-top\{display:flex/);
    expect(css).toMatch(/\.lb-card-top>\.lb-group\{[^}]*margin-inline-start:auto/);
  });

  it("the footer separates a leading action from a trailing link", () => {
    expect(css).toMatch(/\.lb-card-foot\{display:flex/);
    expect(css).toMatch(/\.lb-card-foot \.lb-spacer\{flex:1 1 auto\}/);
  });

  it("controls in a section span it, so they share one width", () => {
    expect(css).toMatch(/\.lb-section>\.lb-select,\.lb-section>\.lb-input/);
    expect(css).toMatch(/width:100%;min-width:0\}/);
  });

  it("an empty chips row collapses instead of eating the gap below it", () => {
    expect(css).toMatch(/\.lb-chips\[hidden\]\{display:none\}/);
  });

  it("ships both tag rows, visually distinct from each other", () => {
    // Firmographic (what the company IS) and intent (what the qualifier FOUND)
    // are different axes. Rendered alike they read as one, and the rep loses
    // the reason the lead is on screen. Every board hand-rolled these before.
    expect(css).toMatch(/\.lb-tags-plain,\.lb-tags-intent\{display:flex;flex-wrap:wrap;gap:0\.5rem\}/);
    expect(css).toMatch(/\.lb-tags-plain>\*\{[^}]*color:var\(--lb-muted\)/);
    expect(css).toMatch(/\.lb-tags-intent>\*\{[^}]*color:var\(--color-teal-foreground\)/);
    expect(css).toMatch(/\.lb-tags-intent>\*\{[^}]*background-color:var\(--color-teal-background\)/);
  });

  it("an empty tag row states what is missing rather than rendering blank", () => {
    expect(css).toMatch(/\.lb-tags-empty\{[^}]*font-style:italic/);
  });

  it("teal is declared light AND flipped in both dark paths", () => {
    // A semantic pair defined only on :root keeps its light pastel on a dark
    // card — the 1.16:1 bug the dark-mode suite exists to prevent.
    expect(css).toContain("--color-teal-background:oklch(0.977 0.019 180)");
    expect(css).toContain("--color-teal-foreground:oklch(0.574 0.182 180)");
    expect(css).toContain(
      "--color-teal-border:color-mix(in oklch,var(--color-teal-foreground),transparent 65%)",
    );
    const dark = css.match(/--color-teal-background:oklch\(0\.30 0\.055 180\)/g) ?? [];
    expect(dark).toHaveLength(2);
  });

  it("font smoothing is set once on the root, not per component", () => {
    expect(css).toMatch(/:root\{[^}]*-webkit-font-smoothing:antialiased/);
    expect(css).toMatch(/:root\{[^}]*-moz-osx-font-smoothing:grayscale/);
    // Exactly one declaration each — a per-component copy is the anti-pattern.
    expect((css.match(/-webkit-font-smoothing/g) ?? []).length).toBe(1);
  });

  it("card text wraps deliberately: balance on titles, pretty on prose", () => {
    expect(css).toMatch(/\.lb-lead-title\{[^}]*text-wrap:balance/);
    expect(css).toMatch(/\.lb-sec-title\{[^}]*text-wrap:balance/);
    expect(css).toMatch(/\.lb-sub\{[^}]*text-wrap:pretty/);
  });

  it("the underlined title takes its metrics from the font", () => {
    expect(css).toMatch(/\.lb-lead-title\{[^}]*text-underline-position:from-font/);
    expect(css).toMatch(/\.lb-lead-title\{[^}]*text-decoration-thickness:from-font/);
    expect(css).toMatch(/\.lb-lead-title\{[^}]*text-decoration-skip-ink:auto/);
  });

  it("no card text falls below the 12px UI floor", () => {
    const sizes = [...css.matchAll(/font-size:([\d.]+)rem/g)].map((m) => +m[1] * 16);
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.filter((px) => px < 12)).toEqual([]);
  });

  it("every selector stays lb- scoped", () => {
    const classes = STYLES.match(/\.[a-zA-Z][\w-]*/g) ?? [];
    expect([...new Set(classes)].filter((c) => !c.startsWith(".lb-"))).toEqual([]);
  });
});

describe("the recipe describes the card the skin renders", () => {
  it("names the section stack and its classes", () => {
    for (const cls of ["lb-sections", "lb-section", "lb-sec-title", "lb-card-top", "lb-lead-title", "lb-card-foot"]) {
      expect(flat).toContain(cls);
    }
  });

  it("lists the five titled sections in order", () => {
    const i = (t: string) => flat.indexOf(`lb-sec-title">${t}<`);
    expect(i("Fit")).toBeGreaterThan(-1);
    expect(i("Intent tags")).toBeGreaterThan(i("Fit"));
    expect(i("Data")).toBeGreaterThan(i("Intent tags"));
    expect(i("Status")).toBeGreaterThan(i("Data"));
    expect(i("Outreach")).toBeGreaterThan(i("Status"));
  });

  it("states the four rules a hand-built card gets wrong", () => {
    expect(flat).toMatch(/One section per titled block/i);
    expect(flat).toMatch(/A section title sits at section level/i);
    expect(flat).toMatch(/No date input/i);
    expect(flat).toMatch(/Controls stack and span their section/i);
  });

  it("tells the agent to add no spacing CSS of its own", () => {
    expect(flat).toMatch(/add no\s*spacing CSS of your own/i);
  });

  it("no longer describes the superseded two-row layout", () => {
    expect(flat).not.toMatch(/plus these controls in two rows/i);
    expect(flat).not.toMatch(/close-date `?lb-input`?/i);
    expect(flat).not.toMatch(/The date input\s*sits beside it/i);
  });
});
