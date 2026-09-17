import { describe, it, expect } from "vitest";
import { STYLES } from "../src/styles.js";

// A select is border-box by UA default and a text input is content-box. Given
// identical width, padding and border they render ~2rem apart — the padding
// sits outside the input's box and inside the select's. An earlier pass gave
// both width:100% to make a toolbar's fields match, which made the gap MORE
// visible rather than less, because the two boxes still measured differently.
//
// The page cannot fix this for itself: a host page setting box-sizing on :root
// does not inherit it to descendants, so the kit has to own it.

const css = STYLES.replace(/\s+/g, " ");

describe("kit controls measure the same way", () => {
  it("declares border-box on every sized control", () => {
    expect(css).toMatch(/\.lb-btn,\.lb-select,\.lb-input\{box-sizing:border-box\}/);
  });

  it("sets it BEFORE the width rules that depend on it", () => {
    // Order is not correctness here — box-sizing does not cascade-conflict —
    // but a reader who meets width:100% first has no way to know which box it
    // means. Keep the declaration ahead of its consequences.
    const box = css.indexOf("box-sizing:border-box");
    expect(box).toBeGreaterThan(-1);
    expect(css.indexOf("padding:0.4rem 0.55rem")).toBeGreaterThan(box);
  });

  it("covers the controls that actually take a width", () => {
    // .lb-field>.lb-select and .lb-field>.lb-input are given width:100%, and
    // .lb-stack>.lb-btn too. All three must be border-box or the stack's
    // controls come out at three widths from one declaration.
    for (const sel of [".lb-btn", ".lb-select", ".lb-input"]) {
      expect(css).toContain(sel + ",");
    }
    expect(css).toMatch(/\.lb-stack>\.lb-select,\.lb-stack>\.lb-input,\.lb-stack>\.lb-btn\{width:100%/);
  });

  it("every selector stays lb- scoped", () => {
    const classes = STYLES.match(/\.[a-zA-Z][\w-]*/g) ?? [];
    expect([...new Set(classes)].filter((c) => !c.startsWith(".lb-"))).toEqual([]);
  });
});
