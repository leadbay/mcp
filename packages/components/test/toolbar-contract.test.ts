import { describe, it, expect } from "vitest";
import { STYLES } from "../src/styles.js";
import { ARTIFACT_USAGE_GUIDE as GUIDE } from "../../core/src/artifact-runtime.generated.js";

// The bar above a deck of cards was hand-rolled per artifact, so each one
// invented its own grouping, radius and label treatment — and each re-made the
// same mistakes: one flat gap that let a bulk commit read as a filter, a radius
// copied from the card rather than computed from the bar's own padding, and a
// connection dot distinguished only by colour. The skin ships it now.

const css = STYLES.replace(/\s+/g, " ");
const flat = GUIDE.replace(/\s+/g, " ");

describe("the skin ships the toolbar", () => {
  it("spaces groups 2x wider than the controls inside one", () => {
    // 0.5rem within, 1.5rem between. Flat, the three jobs read as one row.
    expect(css).toMatch(/\.lb-toolbar\{[^}]*gap:0\.75rem 1\.5rem/);
    expect(css).toMatch(/\.lb-toolbar \.lb-group\{gap:0\.5rem\}/);
  });

  it("is concentric with its own padding, not the card's", () => {
    // 0.625rem control radius + 0.75rem padding = 1.375rem. Borrowing the
    // card's 1.5rem ignores that the bar pads less.
    expect(css).toMatch(/\.lb-toolbar\{[^}]*padding:0\.75rem 1rem/);
    expect(css).toMatch(/\.lb-toolbar\{[^}]*border-radius:1\.375rem/);
  });

  it("stacks a control's caption above it, as a card section does", () => {
    expect(css).toMatch(/\.lb-field\{display:inline-flex;flex-direction:column/);
    expect(css).toMatch(/\.lb-field\{[^}]*gap:0\.25rem/);
  });

  it("keeps a checkbox beside its words rather than under them", () => {
    expect(css).toMatch(/\.lb-field-inline\{flex-direction:row;align-items:center/);
  });

  it("sizes a labelled field, not the control inside it", () => {
    // width:100% on the control resolves against the FIELD, which is itself
    // content-sized — so the Sector field sized to its longest option and the
    // City field to the word "City", and the controls inside just filled two
    // different widths. The shared basis has to live on the field.
    expect(css).toMatch(/\.lb-field\{flex:1 1 9rem;min-width:9rem;max-width:16rem\}/);
    expect(css).toMatch(/\.lb-field\>\.lb-select,\.lb-field\>\.lb-input\{width:100%;min-width:0\}/);
  });

  it("exempts an inline field, which holds a checkbox not a sized control", () => {
    // Without this the checkbox field claims an equal share of the row and the
    // box stretches to 16rem.
    expect(css).toMatch(/\.lb-field-inline\{flex:0 0 auto;min-width:0;max-width:none\}/);
    expect(css).toMatch(/\.lb-field-inline\>\*\{min-width:0;width:auto;flex:0 0 auto\}/);
  });

  it("gives control captions the same treatment as a section title", () => {
    expect(css).toMatch(/\.lb-field-label\{[^}]*text-transform:uppercase/);
    expect(css).toMatch(/\.lb-field-label\{[^}]*font-weight:700/);
    expect(css).toMatch(/\.lb-field-label\{[^}]*color:var\(--lb-fg\)/);
  });

  it("aligns readouts on the control baseline, not the caption's", () => {
    // Without this the tally floats high once the labelled controls grow taller.
    expect(css).toMatch(/\.lb-toolbar \.lb-tally,\.lb-toolbar \.lb-status\{align-self:center\}/);
  });

  it("makes the row count tabular so it does not jitter as filters change", () => {
    expect(css).toMatch(/\.lb-tally\{[^}]*font-variant-numeric:tabular-nums/);
  });

  it("distinguishes connection state by SHAPE, not colour alone", () => {
    // A red dot and a green dot are the same dot to a colour-blind reader and
    // identical under forced colours. Live fills; dead is a hollow ring.
    expect(css).toMatch(/\.lb-status\[data-live=yes\] \.lb-status-dot\{background-color:var\(--color-green-foreground\)\}/);
    expect(css).toMatch(
      /\.lb-status\[data-live=no\] \.lb-status-dot\{background-color:transparent;\s*border-color:var\(--color-red-foreground\)\}/,
    );
  });

  it("no toolbar text falls below the 12px UI floor", () => {
    for (const sel of [".lb-field", ".lb-field-label", ".lb-tally", ".lb-status"]) {
      const body = css.match(new RegExp(`\\${sel}\\{([^}]*)\\}`))?.[1] ?? "";
      const size = body.match(/font-size:([\d.]+)rem/)?.[1];
      if (size) expect(+size * 16).toBeGreaterThanOrEqual(12);
    }
  });

  it("every toolbar selector stays lb- scoped", () => {
    const classes = STYLES.match(/\.[a-zA-Z][\w-]*/g) ?? [];
    expect([...new Set(classes)].filter((c) => !c.startsWith(".lb-"))).toEqual([]);
  });
});

describe("the recipe documents the toolbar", () => {
  it("names the classes an agent needs", () => {
    for (const cls of ["lb-toolbar", "lb-field", "lb-field-label", "lb-field-inline", "lb-tally", "lb-status-dot"]) {
      expect(flat).toContain(cls);
    }
  });

  it("states why the bar is three groups", () => {
    expect(flat).toMatch(/because the bar does three things — report, narrow, act/i);
    expect(flat).toMatch(/the\s*bulk commit reads as one more filter/i);
  });

  it("warns that sort costs a round trip the filters do not", () => {
    expect(flat).toMatch(/costs\s*a round trip the others do not/i);
  });
});
