import { describe, it, expect } from "vitest";
import { STYLES } from "../src/styles.js";

// Yellow is the web app's "Could not reach" prospecting action colour
// (ProspectionCell.tsx). Boards built on the kit show the same four actions,
// so the kit must carry the same yellow — value for value, from the web app's
// packages/style/color.css — or "Could not reach" reads as a different state
// on a board than it does in the product.

const flat = STYLES.replace(/\s+/g, "");

describe("the kit carries the web app's yellow", () => {
  it("has the light pair at the web app's exact values", () => {
    expect(flat).toContain("--color-yellow-background:oklch(0.9720.05491)");
    expect(flat).toContain("--color-yellow-foreground:oklch(0.8640.18191)");
  });

  it("derives the border at 65% transparency, like every *-border token", () => {
    expect(flat).toContain("--color-yellow-border:color-mix(inoklch,var(--color-yellow-foreground),transparent65%)");
  });

  it("flips in BOTH dark blocks, not just one", () => {
    // The skin has an explicit data-theme block and a prefers-color-scheme
    // block. A colour that flips in only one of them looks right on one
    // machine and wrong on the next.
    const darkPairs = STYLES.match(/--color-yellow-background:oklch\(0\.30 /g) ?? [];
    expect(darkPairs).toHaveLength(2);
  });

  it("keeps the other three action colours the web app uses", () => {
    for (const hue of ["blue", "green", "red"]) {
      expect(STYLES).toContain(`--color-${hue}-background:`);
      expect(STYLES).toContain(`--color-${hue}-foreground:`);
    }
  });
});
