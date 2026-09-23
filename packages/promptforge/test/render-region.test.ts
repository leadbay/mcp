/**
 * `{{render}}` — the marker that moves a description's presentation half onto
 * the tool result (product: description size versus host truncation).
 *
 * Claude Code truncates every MCP tool description at 2,048 characters, so a
 * rendering algorithm placed further down is read by nobody. These tests pin
 * the split itself: what leaves the description, what arrives in the render
 * block, and that the ChatGPT commerce rules survive the move.
 */
import { describe, it, expect } from "vitest";
import {
  hasRenderRegion,
  splitRenderRegion,
  validateRenderMarkers,
} from "../src/render-region.js";
import { renderCommerce } from "../src/commerce.js";

describe("{{render}} region", () => {
  it("cuts the region out of the description and returns it separately", () => {
    const body = [
      "What the tool does.",
      "",
      "{{render}}",
      "## RENDERING",
      "",
      "Three columns, in the order returned.",
      "{{/render}}",
    ].join("\n");

    const { description, renderBlock } = splitRenderRegion(body);

    expect(description).toContain("What the tool does.");
    expect(description).not.toContain("RENDERING");
    expect(description).not.toContain("{{render}}");
    expect(renderBlock).toContain("## RENDERING");
    expect(renderBlock).toContain("Three columns, in the order returned.");
  });

  it("leaves a body without the marker byte-for-byte alone", () => {
    const body = "Just a description.\n\nWith two paragraphs.\n";
    expect(hasRenderRegion(body)).toBe(false);
    expect(splitRenderRegion(body).description).toBe(body);
    expect(splitRenderRegion(body).renderBlock).toBe("");
  });

  it("joins several regions in source order", () => {
    const body = "A\n\n{{render}}first{{/render}}\n\nB\n\n{{render}}second{{/render}}\n";
    const { description, renderBlock } = splitRenderRegion(body);
    expect(renderBlock).toBe("first\n\nsecond");
    expect(description).toContain("A");
    expect(description).toContain("B");
  });

  it("does not leave a blank hole where the region was", () => {
    const body = "Paragraph one.\n\n{{render}}\nlayout\n{{/render}}\n\nParagraph two.\n";
    const { description } = splitRenderRegion(body);
    expect(description).not.toMatch(/\n{3,}/);
  });

  it("rejects unbalanced markers", () => {
    expect(validateRenderMarkers("{{render}}only an opener")).toMatch(/unbalanced/);
    expect(validateRenderMarkers("a closer{{/render}}")).toMatch(/unbalanced/);
    expect(validateRenderMarkers("{{render}}paired{{/render}}")).toBeNull();
  });

  it("keeps a commerce block out of the commerce-free render block", () => {
    // Five rendering / next-steps snippets carry {{commerce}}. The render block
    // travels the same commerce path as the description it came from, or the
    // ChatGPT surface would receive purchase prose through the back door.
    const body = [
      "What it does.",
      "",
      "{{render}}",
      "Render the quota gauge.",
      "{{commerce}}",
      "Offer a top-up when the window is exhausted.",
      "{{/commerce}}",
      "{{/render}}",
    ].join("\n");

    const { renderBlock } = splitRenderRegion(body);
    expect(renderCommerce(renderBlock, "with")).toContain("Offer a top-up");
    expect(renderCommerce(renderBlock, "without")).not.toContain("Offer a top-up");
    expect(renderCommerce(renderBlock, "without")).toContain("Render the quota gauge.");
  });
});
