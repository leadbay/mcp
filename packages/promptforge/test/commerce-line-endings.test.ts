import { describe, it, expect } from "vitest";
import { renderCommerce } from "../src/commerce.js";

// The marker-stripping regexes hardcoded `\n`. On a CRLF template the `\r` was
// left behind, so an own-line `{{commerce}}` fell through to the inline replace
// and its line collapsed to a BLANK one rather than disappearing. The emitted
// description then carried a doubled blank line that a Linux build never
// produces — enough on its own to fail CI's generated-files check, and masked
// until .gitattributes stopped the endings themselves from drifting.
//
// The rendered TEXT must not depend on the platform the build ran on. These
// normalise both outputs to LF and require them to be identical.

const withCRLF = (s: string) => s.replace(/\n/g, "\r\n");
const toLF = (s: string) => s.replace(/\r\n/g, "\n");

/** Renders the same source as LF and as CRLF; returns both, LF-normalised. */
function bothWays(src: string, mode: "with" | "without") {
  return {
    lf: renderCommerce(src, mode),
    crlf: toLF(renderCommerce(withCRLF(src), mode)),
  };
}

const OWN_LINE = [
  "Feed the matched ids straight into the campaign call.",
  "",
  "{{commerce}}",
  "On a 429 mid-scan, offer wait-for-reset OR a top-up link.",
  "{{/commerce}}",
  "",
  "**SIGNAL HONESTY** — never infer signals from freshness.",
].join("\n");

const INLINE = "The window resets{{commerce}} (or top up){{/commerce}}.";

describe("commerce rendering does not depend on line endings", () => {
  it("keeps an own-line block identical either way", () => {
    const { lf, crlf } = bothWays(OWN_LINE, "with");
    expect(crlf).toBe(lf);
  });

  it("deletes an own-line block identically either way", () => {
    const { lf, crlf } = bothWays(OWN_LINE, "without");
    expect(crlf).toBe(lf);
  });

  it("leaves no doubled blank line when a CRLF block is KEPT", () => {
    // The exact CI failure: a stripped marker line became a blank line, so the
    // paragraphs ended up two blank lines apart instead of one.
    const out = toLF(renderCommerce(withCRLF(OWN_LINE), "with"));
    expect(out).not.toMatch(/\n{3,}/);
    expect(out).toContain("campaign call.\n\nOn a 429");
    expect(out).toContain("top-up link.\n\n**SIGNAL HONESTY**");
  });

  it("leaves no doubled blank line when a CRLF block is DELETED", () => {
    const out = toLF(renderCommerce(withCRLF(OWN_LINE), "without"));
    expect(out).not.toMatch(/\n{3,}/);
    expect(out).toContain("campaign call.\n\n**SIGNAL HONESTY**");
    expect(out).not.toContain("top-up");
  });

  it("never leaks a marker, whatever the endings", () => {
    for (const mode of ["with", "without"] as const) {
      for (const src of [OWN_LINE, INLINE]) {
        const { lf, crlf } = bothWays(src, mode);
        expect(lf).not.toMatch(/\{\{\/?commerce\}\}/);
        expect(crlf).not.toMatch(/\{\{\/?commerce\}\}/);
      }
    }
  });

  it("handles an inline span the same either way", () => {
    // The leading space lives INSIDE the markers, so deleting leaves "resets."
    expect(bothWays(INLINE, "with").crlf).toBe(renderCommerce(INLINE, "with"));
    expect(renderCommerce(INLINE, "without")).toBe("The window resets.");
    expect(toLF(renderCommerce(withCRLF(INLINE), "without"))).toBe("The window resets.");
  });

  it("is a no-op on a body with no markers, either way", () => {
    const plain = "Just a paragraph.\n\nAnd another.";
    expect(renderCommerce(plain, "with")).toBe(plain);
    expect(toLF(renderCommerce(withCRLF(plain), "without"))).toBe(plain);
  });
});
