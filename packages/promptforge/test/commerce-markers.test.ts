/**
 * `{{commerce}}` — the marker that deletes purchase-promoting prose on a host
 * that forbids promoting it.
 *
 * The load-bearing property is that the DEFAULT rendering is byte-identical to
 * the template with the marker lines simply removed. Claude's prompts must not
 * shift because a template learned that one of its paragraphs is optional. The
 * marker only ever deletes — there is no second, softened wording to drift.
 *
 * New file — does not modify assembler.test.ts.
 */

import { describe, it, expect } from "vitest";
import {
  hasCommerceMarkers,
  renderCommerce,
  validateCommerceMarkers,
} from "../src/commerce.js";

describe("renderCommerce — paragraph blocks", () => {
  const body = [
    "Intro paragraph.",
    "",
    "{{commerce}}",
    "Offer the top-up link.",
    "",
    "A second selling paragraph.",
    "{{/commerce}}",
    "",
    "Closing paragraph.",
    "",
  ].join("\n");

  it('"with" reads exactly as if the markers were never written', () => {
    expect(renderCommerce(body, "with")).toBe(
      [
        "Intro paragraph.",
        "",
        "Offer the top-up link.",
        "",
        "A second selling paragraph.",
        "",
        "Closing paragraph.",
        "",
      ].join("\n")
    );
  });

  it('"without" deletes the block and leaves no blank-line crater', () => {
    expect(renderCommerce(body, "without")).toBe(
      ["Intro paragraph.", "", "Closing paragraph.", ""].join("\n")
    );
  });
});

describe("renderCommerce — inline spans", () => {
  // The leading space lives INSIDE the markers so deleting the span does not
  // leave "resets , and".
  const body = "…when it resets{{commerce}} (and to offer the top-up){{/commerce}}, and after that.";

  it('"with" keeps the span and its authored spacing', () => {
    expect(renderCommerce(body, "with")).toBe(
      "…when it resets (and to offer the top-up), and after that."
    );
  });

  it('"without" leaves clean prose', () => {
    expect(renderCommerce(body, "without")).toBe("…when it resets, and after that.");
  });
});

describe("renderCommerce — table rows", () => {
  const body = [
    "| a | b |",
    "{{commerce}}",
    "| top up | leadbay_create_topup_link |",
    "{{/commerce}}",
    "| other | leadbay_account_status |",
    "",
  ].join("\n");

  it("keeps the table contiguous in both renderings", () => {
    expect(renderCommerce(body, "with")).toBe(
      ["| a | b |", "| top up | leadbay_create_topup_link |", "| other | leadbay_account_status |", ""].join("\n")
    );
    expect(renderCommerce(body, "without")).toBe(
      ["| a | b |", "| other | leadbay_account_status |", ""].join("\n")
    );
  });
});

describe("renderCommerce — it only ever deletes", () => {
  it("the commerce-free output is always a subsequence of the default one", () => {
    const bodies = [
      "a\n\n{{commerce}}\nb\n{{/commerce}}\n\nc\n",
      "x{{commerce}} y{{/commerce}} z",
      "| r |\n{{commerce}}\n| s |\n{{/commerce}}\n",
    ];
    for (const body of bodies) {
      const full = renderCommerce(body, "with");
      const gated = renderCommerce(body, "without");
      let i = 0;
      for (let j = 0; j < full.length && i < gated.length; j++) {
        if (gated[i] === full[j]) i++;
      }
      expect(i, `not a pure deletion: ${JSON.stringify(body)}`).toBe(gated.length);
    }
  });

  it("a body with no markers is returned verbatim, blank-line runs included", () => {
    const body = "One.\n\n\n\nTwo.\n";
    expect(renderCommerce(body, "with")).toBe(body);
    expect(renderCommerce(body, "without")).toBe(body);
    expect(hasCommerceMarkers(body)).toBe(false);
  });
});

describe("validateCommerceMarkers", () => {
  it("accepts balanced markers", () => {
    expect(validateCommerceMarkers("a{{commerce}}b{{/commerce}}c")).toBeNull();
    expect(validateCommerceMarkers("no markers here")).toBeNull();
  });

  it("rejects an unclosed block", () => {
    expect(validateCommerceMarkers("a{{commerce}}b")).toMatch(/unbalanced/);
  });

  it("rejects an unopened block", () => {
    expect(validateCommerceMarkers("a{{/commerce}}b")).toMatch(/unbalanced/);
  });

  it("rejects a nested pair, which balances but leaks a marker", () => {
    // Counts pair up (2 open, 2 close) so the arithmetic check passes; only
    // rendering exposes the stray {{/commerce}} left behind.
    expect(
      validateCommerceMarkers("{{commerce}}a{{commerce}}b{{/commerce}}c{{/commerce}}")
    ).toMatch(/survive the "without" rendering/);
  });
});
